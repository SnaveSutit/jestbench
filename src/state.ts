import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ResolvedConfig } from './config'

/**
 * Jest runs `globalSetup` in the main process and every test file in a separate
 * worker process. They cannot share objects, so the launch details are written
 * to a small JSON file whose path is passed in an environment variable. Jest
 * propagates those to workers.
 */

const ENV_KEY = 'BLOCKBENCH_TEST_STATE'

export interface SharedState {
	wsEndpoint: string
	config: ResolvedConfig
	/** PID of the Blockbench process group, if we launched it. */
	pid: number | undefined
	/** The launched instance's `userData` dir, used to find leftover processes on teardown. */
	userDataDir: string | undefined
	/** Directory owned by this run; removed on teardown. */
	stateDir: string
}

export function writeState(state: Omit<SharedState, 'stateDir'>): string {
	const stateDir = mkdtempSync(join(tmpdir(), 'blockbench-test-'))
	const file = join(stateDir, 'state.json')
	writeFileSync(file, JSON.stringify({ ...state, stateDir }))
	process.env[ENV_KEY] = file
	return file
}

export function readState(): SharedState {
	const file = process.env[ENV_KEY]
	if (!file) {
		throw new Error(
			'Jestbench state not found. Make sure your Jest config extends ' +
				'the "@snavesutit/jestbench" preset (or wires up its globalSetup).',
		)
	}
	return JSON.parse(readFileSync(file, 'utf-8')) as SharedState
}

export function clearState(): void {
	const file = process.env[ENV_KEY]
	if (!file) return
	try {
		const { stateDir } = JSON.parse(readFileSync(file, 'utf-8')) as SharedState
		rmSync(stateDir, { recursive: true, force: true })
	} catch {
		/* already gone */
	}
	delete process.env[ENV_KEY]
}
