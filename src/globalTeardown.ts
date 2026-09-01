import { killBlockbench } from './launcher'
import { clearState, readState } from './state'

export default async function globalTeardown(): Promise<void> {
	let state
	try {
		state = readState()
	} catch {
		// globalSetup never got far enough to launch anything.
		return
	}

	if (!state.config.keepAlive && state.pid) {
		await killBlockbench(state.pid, state.userDataDir)
	}

	// Also shut down the in-process handle, when globalSetup ran in this process.
	if (globalThis.__BLOCKBENCH_RUNNING__ && !state.config.keepAlive) {
		await globalThis.__BLOCKBENCH_RUNNING__.kill().catch(() => {})
	}
	globalThis.__BLOCKBENCH_RUNNING__ = undefined

	if (!state.config.keepAlive) clearState()
}
