import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { createJiti } from 'jiti'

/**
 * User-facing configuration for the Blockbench test framework.
 *
 * Place a `blockbench.config.{ts,js,mjs,cjs,json}` file in your project root, or
 * point Jest at one with the `BLOCKBENCH_CONFIG` environment variable.
 */
export interface BlockbenchTestConfig {
	/**
	 * Name of the envbench environment to run tests in. envbench keeps every
	 * environment's `userData` folder isolated, so tests never touch your real
	 * Blockbench install. Created automatically if it does not exist.
	 *
	 * @default "blockbench-plugin-test"
	 */
	environment?: string
	/**
	 * Blockbench version to test against. Handed to envbench when it creates the
	 * environment. Accepts `"latest"`, `"beta"` or an exact `"x.y.z"`. Pinning an
	 * exact version keeps CI runs reproducible.
	 *
	 * @default "latest"
	 */
	blockbenchVersion?: string
	/**
	 * Plugin files to install into the environment before Blockbench starts,
	 * so they are loaded exactly like a user-installed plugin. Paths are
	 * resolved relative to the config file. Globs are not expanded; list files
	 * explicitly, or load them at runtime with `loadPlugin()`.
	 */
	plugins?: string[]
	/**
	 * Run Blockbench through `xvfb-run` with no visible window (Linux only).
	 * Set to `false` to watch the tests drive a real Blockbench window.
	 *
	 * @default true
	 */
	headless?: boolean
	/**
	 * Fixed Chrome DevTools Protocol port. `0` picks a free port automatically.
	 *
	 * @default 0
	 */
	debugPort?: number
	/**
	 * How long to wait (ms) for Blockbench to boot and report ready.
	 *
	 * @default 60000
	 */
	launchTimeout?: number
	/**
	 * JS expression evaluated in the renderer to decide when Blockbench is
	 * ready. The default waits for the boot loader to finish.
	 *
	 * @default "window.Blockbench && Blockbench.setup_successful === true"
	 */
	readyExpression?: string
	/** Extra command-line arguments to pass to the Blockbench executable. */
	launchArgs?: string[]
	/**
	 * Connect to an already-running Blockbench instead of launching one. When
	 * set, `environment` / `blockbenchVersion` / `plugins` are ignored. The
	 * value is a CDP websocket endpoint (`ws://127.0.0.1:9223/devtools/...`) or
	 * an HTTP origin (`http://127.0.0.1:9223`).
	 */
	connect?: string
	/**
	 * Leave Blockbench running after the test run finishes. Useful with
	 * `headless: false` for debugging a failing suite.
	 *
	 * @default false
	 */
	keepAlive?: boolean
	/**
	 * After each test, unload any plugins that the test loaded with
	 * `loadPlugin()` and close the active project, so tests stay independent.
	 *
	 * @default true
	 */
	isolateTests?: boolean
	/** Print Blockbench's stdout/stderr to the terminal. @default false */
	verbose?: boolean
}

export type ResolvedConfig = Required<Omit<BlockbenchTestConfig, 'connect' | 'plugins'>> & {
	connect: string | undefined
	plugins: string[]
	/** Absolute path of the loaded config file, or `undefined` if defaults were used. */
	configPath: string | undefined
}

const DEFAULTS: Omit<ResolvedConfig, 'configPath' | 'plugins' | 'connect'> = {
	environment: 'blockbench-plugin-test',
	blockbenchVersion: 'latest',
	headless: true,
	debugPort: 0,
	launchTimeout: 60_000,
	readyExpression: 'window.Blockbench && Blockbench.setup_successful === true',
	launchArgs: [],
	keepAlive: false,
	isolateTests: true,
	verbose: false,
}

const CONFIG_BASENAMES = [
	'blockbench.config.ts',
	'blockbench.config.mjs',
	'blockbench.config.cjs',
	'blockbench.config.js',
	'blockbench.config.json',
]

/** Identity helper that gives you autocomplete and type-checking in a config file. */
export function defineConfig(config: BlockbenchTestConfig): BlockbenchTestConfig {
	return config
}

function findConfigFile(fromDir: string): string | undefined {
	if (process.env.BLOCKBENCH_CONFIG) {
		const explicit = resolve(fromDir, process.env.BLOCKBENCH_CONFIG)
		if (!existsSync(explicit)) {
			throw new Error(`BLOCKBENCH_CONFIG points at a file that does not exist: ${explicit}`)
		}
		return explicit
	}
	for (const name of CONFIG_BASENAMES) {
		const candidate = resolve(fromDir, name)
		if (existsSync(candidate)) return candidate
	}
	return undefined
}

async function importConfigModule(file: string): Promise<BlockbenchTestConfig> {
	if (file.endsWith('.json')) {
		return JSON.parse(readFileSync(file, 'utf-8')) as BlockbenchTestConfig
	}
	// jiti handles .ts/.mjs/.cjs/.js and ESM/CJS interop, which matters because
	// this file runs as CommonJS inside Jest's globalSetup.
	const jiti = createJiti(pathToFileURL(file).href)
	const mod = (await jiti.import(file)) as {
		default?: BlockbenchTestConfig
	} & BlockbenchTestConfig
	return (mod?.default ?? mod) as BlockbenchTestConfig
}

/**
 * Load and normalise the framework config. Called once from Jest's
 * `globalSetup`; the result is passed to workers through a small state file.
 */
export async function loadConfig(cwd: string = process.cwd()): Promise<ResolvedConfig> {
	const configPath = findConfigFile(cwd)
	const user = configPath ? await importConfigModule(configPath) : {}
	const baseDir = configPath ? resolve(configPath, '..') : cwd

	const plugins = (user.plugins ?? []).map(p => (isAbsolute(p) ? p : resolve(baseDir, p)))

	return {
		...DEFAULTS,
		...stripUndefined(user),
		plugins,
		connect: user.connect,
		configPath,
	}
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
	return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>
}
