import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'

import type { ResolvedConfig } from '../src/config'
import { clearState, readState, writeState } from '../src/state'
import { withEnv } from './helpers'

const env = withEnv(['BLOCKBENCH_TEST_STATE'])

const fakeConfig = { keepAlive: false, isolateTests: true } as unknown as ResolvedConfig

beforeEach(() => delete process.env.BLOCKBENCH_TEST_STATE)
afterEach(() => {
	clearState()
	env.restore()
})

describe('state', () => {
	it('round-trips launch details through the state file', () => {
		const file = writeState({
			wsEndpoint: 'ws://127.0.0.1:9222/devtools/browser/abc',
			pid: 4242,
			userDataDir: '/tmp/x',
			config: fakeConfig,
		})
		expect(existsSync(file)).toBe(true)
		expect(process.env.BLOCKBENCH_TEST_STATE).toBe(file)

		const state = readState()
		expect(state.wsEndpoint).toBe('ws://127.0.0.1:9222/devtools/browser/abc')
		expect(state.pid).toBe(4242)
		expect(state.userDataDir).toBe('/tmp/x')
		expect(state.stateDir).toBeTruthy()
	})

	it('throws a helpful error when no state has been written', () => {
		expect(() => readState()).toThrow(/preset/i)
	})

	it('clearState removes the directory and unsets the env var', () => {
		const file = writeState({
			wsEndpoint: 'ws://x',
			pid: undefined,
			userDataDir: undefined,
			config: fakeConfig,
		})
		clearState()
		expect(existsSync(file)).toBe(false)
		expect(process.env.BLOCKBENCH_TEST_STATE).toBeUndefined()
	})

	it('clearState is a no-op when nothing was written', () => {
		expect(() => clearState()).not.toThrow()
	})
})
