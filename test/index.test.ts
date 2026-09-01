import { afterEach, describe, expect, it } from 'bun:test'

import { BlockbenchAPI } from '../src/api'
import * as pkg from '../src/index'
import { FakeBridge } from './helpers'

const g = globalThis as Record<string, unknown>

afterEach(() => {
	delete g.__BLOCKBENCH_API__
})

function install() {
	const bridge = new FakeBridge(() => {
		// action('x').exists() etc. all funnel through evaluate; default false.
		return undefined
	})
	const api = new BlockbenchAPI(bridge as never)
	g.__BLOCKBENCH_API__ = api
	return { api, bridge }
}

describe('package entry', () => {
	it('exports defineConfig and the GUI helpers', () => {
		expect(typeof pkg.defineConfig).toBe('function')
		expect(typeof pkg.loadPlugin).toBe('function')
		expect(typeof pkg.newProject).toBe('function')
		expect(pkg.gui).toEqual(expect.objectContaining({ action: expect.any(Function) }))
	})

	it('throws a helpful error when used before the environment is set up', () => {
		expect(() => pkg.blockbench.version()).toThrow(/not available/i)
		expect(() => pkg.gui.action('x')).toThrow(/not available/i)
		expect(() => pkg.newProject()).toThrow(/not available/i)
	})

	it('the `blockbench` proxy forwards to the live API with correct `this`', () => {
		const { api } = install()
		const handle = pkg.blockbench.action('my_action')
		expect(handle.id).toBe('my_action')
		expect(handle.__bbHandle).toBe('action')
		// method that reads private state via `this`
		expect(pkg.blockbench._testLoaded).toBe(api._testLoaded)
	})

	it('gui.* and flat helpers delegate to the same API instance', () => {
		const { api } = install()
		expect(pkg.gui.menu('filter').id).toBe('filter')
		expect(pkg.menu('filter').id).toBe('filter')
		expect(pkg.plugin('p')).toEqual(api.plugin('p'))
		expect(pkg.dialog().__bbHandle).toBe('dialog')
	})
})
