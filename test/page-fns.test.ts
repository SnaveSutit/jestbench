import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'

import { pageFindMenuItem, pageListMenuItems, pageUnloadPlugin } from '../src/api'

/**
 * These functions are serialised and run inside the Blockbench renderer. Here we
 * test their logic directly against a hand-built stand-in for Blockbench's
 * globals.
 */

const g = globalThis as any

beforeAll(() => {
	// Blockbench augments Array with `.remove()`; mirror that for the fixtures.
	if (!(Array.prototype as { remove?: unknown }).remove) {
		Object.defineProperty(Array.prototype, 'remove', {
			configurable: true,
			value(this: unknown[], ...items: unknown[]) {
				for (const item of items) {
					const i = this.indexOf(item)
					if (i > -1) this.splice(i, 1)
				}
			},
		})
	}
	g.tl = (s: string) => `tl:${s}`
	g.Condition = (c: unknown) => (typeof c === 'function' ? (c as () => unknown)() : c)
})

afterAll(() => {
	delete (Array.prototype as any).remove
	delete g.tl
	delete g.Condition
	delete g.MenuBar
	delete g.BarItems
	delete g.Plugins
	delete g.StateMemory
})

afterEach(() => {
	delete g.MenuBar
	delete g.BarItems
	delete g.Plugins
	delete g.StateMemory
})

describe('pageFindMenuItem', () => {
	beforeEach(() => {
		g.BarItems = {
			my_action: { name: 'My Action', condition: undefined },
			disabled_action: { name: 'Disabled Action', condition: () => false },
		}
		g.MenuBar = {
			menus: {
				filter: {
					structure: [
						'my_action',
						'_',
						{ name: 'menu.group', children: ['disabled_action'] },
						{ id: 'raw_id_item', name: undefined },
					],
				},
			},
		}
	})

	it('reports a missing menu', () => {
		expect(pageFindMenuItem('nope', 'x')).toEqual({
			menuExists: false,
			found: false,
			enabled: false,
			path: [],
		})
	})

	it('finds a top-level action by its display name (case-insensitive)', () => {
		const r = pageFindMenuItem('filter', 'my action')
		expect(r.found).toBe(true)
		expect(r.enabled).toBe(true)
		expect(r.path).toEqual(['My Action'])
	})

	it('finds a nested item and records its path, and reflects a false condition', () => {
		const r = pageFindMenuItem('filter', 'Disabled Action')
		expect(r.found).toBe(true)
		expect(r.enabled).toBe(false)
		expect(r.path).toEqual(['tl:menu.group', 'Disabled Action'])
	})

	it('matches a custom entry by its id', () => {
		expect(pageFindMenuItem('filter', 'raw_id_item').found).toBe(true)
	})

	it('does not match anything that is not there', () => {
		expect(pageFindMenuItem('filter', 'ghost').found).toBe(false)
	})

	it('handles a function-valued structure', () => {
		g.MenuBar.menus.dynamic = { structure: () => ['my_action'] }
		expect(pageFindMenuItem('dynamic', 'My Action').found).toBe(true)
	})
})

describe('pageListMenuItems', () => {
	it('flattens names across nesting and skips separators', () => {
		g.BarItems = { a: { name: 'Action A' } }
		g.MenuBar = {
			menus: {
				m: {
					structure: ['a', '_', { name: 'group', children: [{ name: 'child' }] }],
				},
			},
		}
		expect(pageListMenuItems('m')).toEqual(['Action A', 'tl:group', 'tl:child'])
	})

	it('returns [] for an unknown menu', () => {
		expect(pageListMenuItems('nope')).toEqual([])
	})
})

describe('pageUnloadPlugin', () => {
	it('unloads every copy, clears the registry and the installed list', () => {
		let unloadCalls = 0
		const p1 = { id: 'dup', unload: () => unloadCalls++ }
		const p2 = { id: 'dup', unload: () => unloadCalls++ }
		const other = { id: 'keep', unload: () => unloadCalls++ }
		let saved = false
		g.Plugins = {
			all: [p1, other, p2],
			registered: { dup: p1, keep: other },
			installed: [{ id: 'dup' }, { id: 'keep' }],
		}
		g.StateMemory = { save: () => (saved = true) }

		pageUnloadPlugin('dup')

		expect(unloadCalls).toBe(2)
		expect(g.Plugins.all).toEqual([other])
		expect(g.Plugins.registered).toEqual({ keep: other })
		expect(g.Plugins.installed).toEqual([{ id: 'keep' }])
		expect(saved).toBe(true)
	})

	it('tolerates a throwing onunload and a missing plugin', () => {
		g.Plugins = {
			all: [
				{
					id: 'boom',
					unload: () => {
						throw new Error('x')
					},
				},
			],
			registered: {},
			installed: [],
		}
		expect(() => pageUnloadPlugin('boom')).not.toThrow()
		expect(g.Plugins.all).toEqual([])
		expect(() => pageUnloadPlugin('absent')).not.toThrow()
	})

	it('does nothing when Plugins is unavailable', () => {
		expect(() => pageUnloadPlugin('x')).not.toThrow()
	})
})
