import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { grantPluginPermissions } from '../src/permissions'
import { tempDir } from './helpers'

let dir: ReturnType<typeof tempDir>
const file = () => join(dir.path, 'plugin_permissions.json')
const read = () => JSON.parse(readFileSync(file(), 'utf-8'))

beforeEach(() => {
	dir = tempDir()
})
afterEach(() => {
	dir.dispose()
})

describe('grantPluginPermissions', () => {
	it('allows every requestable module, with and without the node: prefix', () => {
		grantPluginPermissions(dir.path, ['my_plugin'])
		const allowed = read().my_plugin.allowed
		expect(allowed.fs).toBe(true)
		expect(allowed['node:fs']).toBe(true)
		expect(allowed.clipboard).toBe(true)
		expect(allowed['node:child_process']).toBe(true)
	})

	it('keeps existing entries for other plugins', () => {
		writeFileSync(file(), JSON.stringify({ other: { allowed: { shell: true } } }))
		grantPluginPermissions(dir.path, ['my_plugin'])
		const permissions = read()
		expect(permissions.other).toEqual({ allowed: { shell: true } })
		expect(permissions.my_plugin.allowed.fs).toBe(true)
	})

	it('upgrades a scoped fs grant to a full one', () => {
		writeFileSync(
			file(),
			JSON.stringify({ my_plugin: { allowed: { fs: { directories: ['/a'] } } } }),
		)
		grantPluginPermissions(dir.path, ['my_plugin'])
		expect(read().my_plugin.allowed.fs).toBe(true)
	})

	it('recovers from an unreadable file', () => {
		writeFileSync(file(), '{not json')
		grantPluginPermissions(dir.path, ['my_plugin'])
		expect(read().my_plugin.allowed.fs).toBe(true)
	})

	it('writes nothing when there are no plugins', () => {
		grantPluginPermissions(dir.path, [])
		expect(existsSync(file())).toBe(false)
	})
})
