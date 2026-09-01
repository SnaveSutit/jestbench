import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { platform } from 'node:os'
import { join } from 'node:path'

import type { ResolvedConfig } from './config'

export interface RunningBlockbench {
	/** CDP websocket endpoint for `puppeteer.connect`. */
	wsEndpoint: string
	/** HTTP origin of the DevTools endpoint. */
	httpEndpoint: string
	/** PID of the spawned process group leader, or `undefined` when we connected to an existing instance. */
	pid: number | undefined
	/** Recent stdout/stderr, for surfacing on failure. */
	readLog(): string
	/** Stop Blockbench (no-op when we connected to an existing instance). */
	kill(): Promise<void>
}

export function getFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const srv = createServer()
		srv.unref()
		srv.on('error', reject)
		srv.listen(0, '127.0.0.1', () => {
			const port = (srv.address() as { port: number }).port
			srv.close(() => resolve(port))
		})
	})
}

async function fetchWsEndpoint(httpEndpoint: string): Promise<string | undefined> {
	try {
		const res = await fetch(`${httpEndpoint}/json/version`)
		if (!res.ok) return undefined
		const json = (await res.json()) as { webSocketDebuggerUrl?: string }
		return json.webSocketDebuggerUrl
	} catch {
		return undefined
	}
}

const RING_BUFFER_LIMIT = 64 * 1024

/** Connect to an already-running Blockbench rather than launching one. */
export async function connectExisting(target: string): Promise<RunningBlockbench> {
	let wsEndpoint: string | undefined
	let httpEndpoint = ''
	if (target.startsWith('ws://') || target.startsWith('wss://')) {
		wsEndpoint = target
		httpEndpoint = target.replace(/^ws/, 'http').replace(/\/devtools\/.*$/, '')
	} else {
		httpEndpoint = target.replace(/\/$/, '')
		wsEndpoint = await fetchWsEndpoint(httpEndpoint)
	}
	if (!wsEndpoint) {
		throw new Error(`Could not reach a Blockbench DevTools endpoint at ${target}`)
	}
	return {
		wsEndpoint,
		httpEndpoint,
		pid: undefined,
		readLog: () => '',
		kill: async () => {},
	}
}

/**
 * Spawn Blockbench with the Chrome DevTools Protocol enabled and wait until the
 * endpoint answers. On Linux headless runs the process is wrapped in
 * `xvfb-run` so no window appears.
 */
export async function launchBlockbench(
	executable: string,
	userDataDir: string,
	config: ResolvedConfig,
): Promise<RunningBlockbench> {
	// Kill any Blockbench a previously hard-killed run left bound to this userData
	// dir; two Electron apps sharing one Chromium profile makes startup flaky.
	// Also clear the stale singleton lock it leaves behind.
	await killBlockbench(undefined, userDataDir)
	for (const lock of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
		try {
			rmSync(join(userDataDir, lock), { force: true })
		} catch {
			/* nothing to clear */
		}
	}

	const port = config.debugPort || (await getFreePort())

	const bbArgs = [
		`--remote-debugging-port=${port}`,
		'--remote-allow-origins=*',
		`--userData=${userDataDir}`,
		// The AppImage re-execs itself for sandboxed child processes, which many
		// CI sandboxes disallow; --no-sandbox keeps it to one process tree.
		// Do not add --disable-gpu: Blockbench needs a working WebGL context to
		// finish booting, and xvfb + swiftshader provides one.
		'--no-sandbox',
		'--disable-dev-shm-usage',
		...config.launchArgs,
	]

	let command = executable
	let args = bbArgs
	const useXvfb = config.headless && platform() === 'linux'
	if (useXvfb) {
		command = 'xvfb-run'
		args = ['-a', executable, ...bbArgs]
	}

	const child: ChildProcess = spawn(command, args, {
		stdio: ['ignore', 'pipe', 'pipe'],
		detached: true,
	})

	let log = ''
	const append = (chunk: Buffer) => {
		log = (log + chunk.toString()).slice(-RING_BUFFER_LIMIT)
		if (config.verbose) process.stderr.write(chunk)
	}
	child.stdout?.on('data', append)
	child.stderr?.on('data', append)

	const running: RunningBlockbench = {
		wsEndpoint: '',
		httpEndpoint: `http://127.0.0.1:${port}`,
		pid: child.pid,
		readLog: () => log,
		kill: () => killBlockbench(child.pid, userDataDir),
	}

	let exited = false
	child.on('exit', () => {
		exited = true
	})

	const deadline = Date.now() + config.launchTimeout
	while (Date.now() < deadline) {
		if (exited) {
			throw new Error(`Blockbench exited before the DevTools endpoint came up.\n${tail(log)}`)
		}
		const ws = await fetchWsEndpoint(running.httpEndpoint)
		if (ws) {
			running.wsEndpoint = ws
			return running
		}
		await delay(250)
	}

	await killBlockbench(child.pid, userDataDir)
	throw new Error(
		`Timed out after ${config.launchTimeout}ms waiting for Blockbench to start.\n` +
			`Command: ${command} ${args.join(' ')}\n${tail(log)}`,
	)
}

function tail(text: string, lines = 20): string {
	return text.split('\n').slice(-lines).join('\n')
}

function delay(ms: number): Promise<void> {
	return new Promise(r => setTimeout(r, ms))
}

export function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch (err) {
		return (err as NodeJS.ErrnoException).code === 'EPERM'
	}
}

/** PIDs of processes whose command line contains `needle`. Linux/macOS only. */
function pgrep(needle: string): number[] {
	try {
		const out = spawnSync('pgrep', ['-f', '--', needle], { encoding: 'utf-8' })
		return (out.stdout ?? '')
			.split('\n')
			.map(s => Number(s.trim()))
			.filter(n => Number.isInteger(n) && n > 0 && n !== process.pid)
	} catch {
		return []
	}
}

/**
 * Stop a Blockbench instance we launched. Works from a process that only knows
 * the pid (e.g. `globalTeardown`), so it does not need the ChildProcess object.
 *
 * The portable AppImage mounts itself and re-execs, and the inner `blockbench`
 * process often escapes the launcher's process group, so we also search by
 * command line for anything bound to this run's unique userData dir.
 */
export async function killBlockbench(
	pid: number | undefined,
	userDataDir: string | undefined,
): Promise<void> {
	const signal = (target: number, sig: NodeJS.Signals) => {
		try {
			process.kill(target, sig)
		} catch {
			/* already gone */
		}
	}

	const targets = (): number[] => {
		const set = new Set<number>()
		if (pid && isAlive(pid)) set.add(pid)
		if (userDataDir) for (const p of pgrep(userDataDir)) set.add(p)
		return [...set]
	}

	const sweep = (sig: NodeJS.Signals) => {
		for (const p of targets()) {
			signal(-p, sig) // the process group, if it leads one
			signal(p, sig)
		}
	}

	if (targets().length === 0) return

	sweep('SIGTERM')
	const deadline = Date.now() + 4000
	while (Date.now() < deadline) {
		await delay(150)
		if (targets().length === 0) return
	}
	sweep('SIGKILL')
	await delay(300)
}
