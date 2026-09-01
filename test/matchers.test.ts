import { describe, expect, it } from 'bun:test'

import { BlockbenchAPI } from '../src/api'
import { isApi, isInspectable, matcherImplementations as m } from '../src/matcher-impls'
import { FakeBridge } from './helpers'

function handle(state: Record<string, unknown>) {
	return { __bbHandle: 'x', label: 'thing', inspect: async () => state }
}

describe('isInspectable / isApi', () => {
	it('recognises a handle', () => {
		expect(isInspectable(handle({}))).toBe(true)
		expect(isInspectable({})).toBe(false)
		expect(isInspectable(null)).toBe(false)
	})

	it('recognises a real BlockbenchAPI and a duck-typed proxy, but not a plain object', () => {
		expect(isApi(new BlockbenchAPI(new FakeBridge() as never))).toBe(true)
		expect(isApi({ loadedPlugins() {}, action() {}, menu() {} })).toBe(true)
		expect(isApi({ action() {} })).toBe(false)
		expect(isApi(null)).toBe(false)
	})
})

describe('handle matchers', () => {
	it('toExist', async () => {
		expect((await m.toExist(handle({ exists: true, label: 't' }))).pass).toBe(true)
		const fail = await m.toExist(handle({ exists: false, label: 't' }))
		expect(fail.pass).toBe(false)
		expect(fail.message()).toMatch(/to exist, but it was not found/)
	})

	it('toBeVisible falls back to `exists` when `visible` is absent', async () => {
		expect((await m.toBeVisible(handle({ exists: true, label: 't' }))).pass).toBe(true)
		expect(
			(await m.toBeVisible(handle({ exists: true, visible: false, label: 't' }))).pass,
		).toBe(false)
	})

	it('toBeEnabled', async () => {
		expect((await m.toBeEnabled(handle({ enabled: true, label: 't' }))).pass).toBe(true)
		expect((await m.toBeEnabled(handle({ label: 't' }))).pass).toBe(false)
	})

	it('toBeOpen', async () => {
		expect((await m.toBeOpen(handle({ open: true, label: 't' }))).pass).toBe(true)
		expect((await m.toBeOpen(handle({ open: false, label: 't' }))).pass).toBe(false)
	})

	it('rejects a non-handle receiver', async () => {
		await expect(m.toExist({} as unknown)).rejects.toThrow(/GUI handle/)
	})
})

describe('api matchers', () => {
	const fakeApi = {
		loadedPlugins: async () => ['a', 'b'],
		action: (id: string) => ({ exists: async () => id === 'known' }),
		menu: (menuId: string) => ({
			has: async (n: string) => menuId === 'filter' && n === 'Item',
		}),
	}

	it('toHaveLoadedPlugin', async () => {
		expect((await m.toHaveLoadedPlugin(fakeApi, 'a')).pass).toBe(true)
		const fail = await m.toHaveLoadedPlugin(fakeApi, 'z')
		expect(fail.pass).toBe(false)
		expect(fail.message()).toContain('a, b')
	})

	it('toHaveAction', async () => {
		expect((await m.toHaveAction(fakeApi, 'known')).pass).toBe(true)
		expect((await m.toHaveAction(fakeApi, 'other')).pass).toBe(false)
	})

	it('toHaveMenuItem', async () => {
		expect((await m.toHaveMenuItem(fakeApi, 'filter', 'Item')).pass).toBe(true)
		expect((await m.toHaveMenuItem(fakeApi, 'filter', 'Nope')).pass).toBe(false)
	})

	it('rejects when the receiver is not the blockbench object', async () => {
		await expect(m.toHaveAction({} as unknown, 'x')).rejects.toThrow(/blockbench.*object/)
	})
})
