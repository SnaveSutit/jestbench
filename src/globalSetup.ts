import { BlockbenchAPI } from './api'
import { Bridge } from './bridge'
import { loadConfig, type ResolvedConfig } from './config'
import { connectExisting, launchBlockbench, type RunningBlockbench } from './launcher'
import { createEnvbench, ensureEnvironment, environmentDir, resolvePortablePath } from './envbench'
import { writeState } from './state'

// Kept on the module so globalTeardown (same process) can reach it.
declare global {
	// `var` is the only declaration form allowed in a global augmentation.
	var __BLOCKBENCH_RUNNING__: RunningBlockbench | undefined
}

/**
 * Blockbench only auto-loads plugins that are registered in its (per-user)
 * installed-plugins list, so instead we load each configured plugin over the
 * DevTools bridge once Blockbench is up, the same way `loadPlugin()` does.
 */
async function preloadPlugins(running: RunningBlockbench, config: ResolvedConfig): Promise<void> {
	if (!config.plugins.length) return
	const bridge = await Bridge.connect(running.wsEndpoint, config)
	try {
		const api = new BlockbenchAPI(bridge)
		for (const path of config.plugins) {
			await api.loadPlugin(path)
		}
	} finally {
		await bridge.dispose()
	}
}

interface JestProjectConfig {
	rootDir?: string
	cwd?: string
}

export default async function globalSetup(
	_globalConfig: unknown,
	projectConfig?: JestProjectConfig,
): Promise<void> {
	const config = await loadConfig(projectConfig?.rootDir ?? process.cwd())

	let running: RunningBlockbench
	let userDataDir: string | undefined
	if (config.connect) {
		running = await connectExisting(config.connect)
	} else {
		const eb = createEnvbench()
		await ensureEnvironment(eb, config.environment, config.blockbenchVersion)
		userDataDir = environmentDir(eb, config.environment)
		const executable = await resolvePortablePath(eb, config.environment)
		running = await launchBlockbench(executable, userDataDir, config)
	}

	await preloadPlugins(running, config)

	globalThis.__BLOCKBENCH_RUNNING__ = running
	writeState({ wsEndpoint: running.wsEndpoint, pid: running.pid, userDataDir, config })

	if (config.verbose) {
		console.log(`[jestbench] connected at ${running.wsEndpoint}`)
	}
}
