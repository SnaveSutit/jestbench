import { afterEach, describe, expect, it } from 'bun:test'

import {
	ActionHandle,
	BlockbenchAPI,
	DialogHandle,
	MenuHandle,
	PanelHandle,
	PluginHandle,
	pluginIdFromPath,
} from '../src/api'
import { FakeBridge } from './helpers'

function api(responder?: (fn: unknown, args: unknown[]) => unknown) {
	const bridge = new FakeBridge(responder)
	return { bridge, api: new BlockbenchAPI(bridge as never) }
}

describe('pluginIdFromPath', () => {
	it('takes the basename without the .js extension', () => {
		expect(pluginIdFromPath('/a/b/my_plugin.js')).toBe('my_plugin')
		expect(pluginIdFromPath('my_plugin.js')).toBe('my_plugin')
		expect(pluginIdFromPath('/x/animated_java.js')).toBe('animated_java')
	})
})

describe('handle factories', () => {
	it('produce correctly tagged handles', () => {
		const { api: a } = api()
		expect(a.action('x')).toBeInstanceOf(ActionHandle)
		expect(a.menu('x')).toBeInstanceOf(MenuHandle)
		expect(a.dialog()).toBeInstanceOf(DialogHandle)
		expect(a.panel('x')).toBeInstanceOf(PanelHandle)
		expect(a.plugin('x')).toBeInstanceOf(PluginHandle)

		expect(a.action('act').__bbHandle).toBe('action')
		expect(a.action('act').label).toBe('action "act"')
		expect(a.dialog().__bbHandle).toBe('dialog')
		expect(a.panel('p').label).toBe('panel "p"')
	})
})

describe('ActionHandle.trigger', () => {
	it('resolves when the renderer confirms the action fired', async () => {
		const { api: a, bridge } = api(() => true)
		await a.action('do_thing').trigger()
		expect(bridge.calls).toHaveLength(1)
	})

	it('throws a clear error when the action is missing', async () => {
		const { api: a } = api(() => false)
		await expect(a.action('ghost').trigger()).rejects.toThrow(/No action with id "ghost"/)
	})
})

describe('BlockbenchAPI.loadPlugin', () => {
	it('tracks the plugin id and returns a handle on success', async () => {
		const { api: a } = api(() => ({ ok: true, error: null }))
		const handle = await a.loadPlugin('/some/where/cool_plugin.js')
		expect(handle).toBeInstanceOf(PluginHandle)
		expect(handle.id).toBe('cool_plugin')
		expect(handle.path).toBe('/some/where/cool_plugin.js')
		expect([...a._testLoaded]).toEqual(['cool_plugin'])
	})

	it('throws (and does not track) when the renderer reports failure', async () => {
		const { api: a } = api(() => ({ ok: false, error: 'did not register' }))
		await expect(a.loadPlugin('/x/bad.js')).rejects.toThrow(
			/Failed to load plugin.*did not register/,
		)
		expect([...a._testLoaded]).toEqual([])
	})
})

describe('BlockbenchAPI.resetForNextTest', () => {
	it('clears the set of test-loaded plugin ids', async () => {
		const { api: a } = api((fn, args) => {
			// loadPlugin -> {ok:true}; resetForNextTest -> undefined
			return Array.isArray(args) &&
				typeof args[0] === 'string' &&
				String(args[0]).endsWith('.js')
				? { ok: true }
				: undefined
		})
		await a.loadPlugin('/x/p.js')
		expect([...a._testLoaded]).toEqual(['p'])
		await a.resetForNextTest()
		expect([...a._testLoaded]).toEqual([])
	})
})

describe('menu handles run the real page functions through the bridge', () => {
	const g = globalThis as any
	afterEach(() => {
		delete g.MenuBar
		delete g.BarItems
		delete g.tl
	})

	it('menu().has() and item().isVisible() reflect the menu structure', async () => {
		g.tl = (s: string) => s
		g.BarItems = { greet: { name: 'Greet', condition: undefined } }
		g.MenuBar = { menus: { filter: { structure: ['greet'] } } }

		const { api: a } = api((fn, args) => (fn as (...x: unknown[]) => unknown)(...args))

		expect(await a.menu('filter').has('Greet')).toBe(true)
		expect(await a.menu('filter').has('Nope')).toBe(false)
		expect(await a.menu('filter').item('Greet').isVisible()).toBe(true)
		expect(await a.menu('filter').items()).toEqual(['Greet'])
	})
})

describe('inspect() output', () => {
	it('ActionHandle.inspect reports existence and enabled state', async () => {
		const { api: a } = api(() => ({ name: 'X', enabled: false }))
		expect(await a.action('x').inspect()).toMatchObject({
			kind: 'action',
			exists: true,
			enabled: false,
			visible: true,
		})
	})

	it('DialogHandle.inspect reports closed when no dialog is open', async () => {
		const { api: a } = api(() => null)
		expect(await a.dialog().inspect()).toMatchObject({
			kind: 'dialog',
			exists: false,
			open: false,
		})
	})
})
