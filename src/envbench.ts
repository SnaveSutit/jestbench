import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import { join, normalize } from 'node:path'

/**
 * Thin wrapper around the `envbench` CLI (https://github.com/SnaveSutit/envbench).
 *
 * envbench handles provisioning a Blockbench instance: which version to
 * download, and an isolated `userData` folder per environment. This module
 * drives it non-interactively, then locates the portable binary so the
 * launcher can start it with instrumentation flags.
 */

export interface EnvbenchOptions {
	/** Path/command for the CLI. */
	bin: string
	verbose: boolean
}

function storageFolder(): string {
	return process.env.ENVBENCH_STORAGE_FOLDER ?? normalize(join(homedir(), '.envbench'))
}

function portablesCache(): string {
	return process.env.BLOCKBENCH_PORTABLES_CACHE ?? join(storageFolder(), '.portables')
}

/** Absolute path to an environment's folder, which doubles as its `userData` dir. */
export function environmentDir(name: string): string {
	return join(storageFolder(), name)
}

export function environmentExists(name: string): boolean {
	return existsSync(join(environmentDir(name), '.envbench.json'))
}

interface EnvbenchRunResult {
	code: number
	stdout: string
	stderr: string
}

function run(bin: string, args: string[], verbose: boolean): Promise<EnvbenchRunResult> {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
		let stdout = ''
		let stderr = ''
		child.stdout.on('data', d => {
			stdout += d
			if (verbose) process.stdout.write(d)
		})
		child.stderr.on('data', d => {
			stderr += d
			if (verbose) process.stderr.write(d)
		})
		child.on('error', err => {
			if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
				reject(
					new Error(
						`Could not run "${bin}". Install envbench with \`npm i -g envbench\`, ` +
							`or set \`envbenchBin\` in your blockbench.config.`,
					),
				)
			} else {
				reject(err)
			}
		})
		child.on('close', code => resolvePromise({ code: code ?? 0, stdout, stderr }))
	})
}

/** Create the environment if it is missing. Downloads Blockbench on first use. */
export async function ensureEnvironment(
	name: string,
	blockbenchVersion: string,
	opts: EnvbenchOptions,
): Promise<void> {
	if (environmentExists(name)) return

	const result = await run(
		opts.bin,
		['create', name, '--confirm', '--version', blockbenchVersion],
		// Creation downloads ~120 MB with a progress bar; always show it.
		true,
	)
	if (result.code !== 0 || !environmentExists(name)) {
		throw new Error(
			`envbench failed to create environment "${name}" (exit ${result.code}).\n` +
				`${result.stderr || result.stdout}`,
		)
	}
}

async function githubTag(url: string): Promise<string> {
	const res = await fetch(url)
	if (!res.ok) throw new Error(`GitHub API request failed: ${res.status} ${res.statusText}`)
	const json = (await res.json()) as
		Array<{ tag_name?: string; prerelease?: boolean }> | { tag_name?: string }
	if (Array.isArray(json)) {
		const beta = json.find(r => r.prerelease)
		if (!beta?.tag_name) throw new Error('No Blockbench beta release found')
		return beta.tag_name
	}
	if (!json.tag_name) throw new Error('Unexpected GitHub API response')
	return json.tag_name
}

const RELEASES = 'https://api.github.com/repos/JannisX11/Blockbench/releases'

/** Turn `"latest"` / `"beta"` / `"v5.1.6"` into a bare `"5.1.6"`. */
export async function resolveVersion(version: string): Promise<string> {
	let v = version
	if (v === 'latest') v = await githubTag(`${RELEASES}/latest`)
	else if (v === 'beta') v = await githubTag(RELEASES)
	return v.replace(/^v/, '')
}

function portableName(version: string): string {
	switch (platform()) {
		case 'win32':
			return `blockbench-${version}.exe`
		case 'darwin':
			return `blockbench-${version}.dmg`
		default:
			return `blockbench-${version}.AppImage`
	}
}

/** Newest portable already downloaded by envbench, as a bare version string. */
async function newestLocalPortable(): Promise<string | undefined> {
	let files: string[]
	try {
		files = await readdir(portablesCache())
	} catch {
		return undefined
	}
	const versions = files
		.map(f => /(\d+\.\d+\.\d+)/.exec(f)?.[1])
		.filter((v): v is string => Boolean(v))
		.sort(compareSemver)
	return versions.at(-1)
}

export function compareSemver(a: string, b: string): number {
	const pa = a.split('.').map(Number)
	const pb = b.split('.').map(Number)
	for (let i = 0; i < 3; i++) {
		if (pa[i] !== pb[i]) return (pa[i] ?? 0) - (pb[i] ?? 0)
	}
	return 0
}

/**
 * Locate the Blockbench executable envbench downloaded for this environment.
 * Falls back to the newest local portable when the network is unavailable.
 */
export async function resolvePortablePath(environmentName: string): Promise<string> {
	const envFile = join(environmentDir(environmentName), '.envbench.json')
	let requested = 'latest'
	try {
		requested = JSON.parse(await readFile(envFile, 'utf-8')).blockbench_version ?? 'latest'
	} catch {
		/* use default */
	}

	let resolved: string | undefined
	try {
		resolved = await resolveVersion(requested)
	} catch {
		resolved = await newestLocalPortable()
	}
	if (!resolved) {
		throw new Error(
			`Could not determine which Blockbench version to launch for "${environmentName}". ` +
				`Check your network connection or pin \`blockbenchVersion\` in the config.`,
		)
	}

	const candidates = [
		join(portablesCache(), portableName(resolved)),
		// envbench <=3.1 used a capitalised name on some platforms
		join(portablesCache(), portableName(resolved).replace('blockbench-', 'Blockbench_')),
	]
	const found = candidates.find(p => existsSync(p))
	if (!found) {
		throw new Error(
			`Blockbench ${resolved} portable not found in ${portablesCache()}. ` +
				`Run \`envbench create ${environmentName} --version ${requested}\` to download it.`,
		)
	}
	return found
}
