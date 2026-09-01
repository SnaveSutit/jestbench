import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
	compareSemver,
	environmentDir,
	environmentExists,
	resolvePortablePath,
	resolveVersion,
} from '../src/envbench'
import { tempDir, withEnv } from './helpers'

const env = withEnv(['ENVBENCH_STORAGE_FOLDER', 'BLOCKBENCH_PORTABLES_CACHE'])
let dir: ReturnType<typeof tempDir>

beforeEach(() => {
	dir = tempDir()
	process.env.ENVBENCH_STORAGE_FOLDER = dir.path
	delete process.env.BLOCKBENCH_PORTABLES_CACHE
})
afterEach(() => {
	dir.dispose()
	env.restore()
})

describe('compareSemver', () => {
	it('orders versions numerically, not lexically', () => {
		expect(compareSemver('5.1.6', '5.1.10')).toBeLessThan(0)
		expect(compareSemver('5.2.0', '5.1.9')).toBeGreaterThan(0)
		expect(compareSemver('4.12.0', '4.12.0')).toBe(0)
		expect([...['5.1.9', '5.1.10', '4.12.0']].sort(compareSemver)).toEqual([
			'4.12.0',
			'5.1.9',
			'5.1.10',
		])
	})
})

describe('environmentDir / environmentExists', () => {
	it('resolves under ENVBENCH_STORAGE_FOLDER', () => {
		expect(environmentDir('foo')).toBe(join(dir.path, 'foo'))
	})

	it('detects the .envbench.json marker', () => {
		expect(environmentExists('foo')).toBe(false)
		mkdirSync(join(dir.path, 'foo'))
		writeFileSync(join(dir.path, 'foo', '.envbench.json'), '{"name":"foo"}')
		expect(environmentExists('foo')).toBe(true)
	})
})

describe('resolveVersion', () => {
	it('strips a leading v from an explicit version without hitting the network', async () => {
		expect(await resolveVersion('5.1.6')).toBe('5.1.6')
		expect(await resolveVersion('v5.1.6')).toBe('5.1.6')
	})

	it('asks GitHub for "latest" and returns the tag', async () => {
		const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(JSON.stringify({ tag_name: 'v5.9.9' }), { status: 200 }),
		)
		try {
			expect(await resolveVersion('latest')).toBe('5.9.9')
			expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('/releases/latest')
		} finally {
			fetchSpy.mockRestore()
		}
	})

	it('finds the newest prerelease for "beta"', async () => {
		const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(
				JSON.stringify([
					{ tag_name: 'v6.0.0', prerelease: false },
					{ tag_name: 'v6.1.0-beta.2', prerelease: true },
				]),
				{ status: 200 },
			),
		)
		try {
			expect(await resolveVersion('beta')).toBe('6.1.0-beta.2')
		} finally {
			fetchSpy.mockRestore()
		}
	})
})

describe('resolvePortablePath', () => {
	function seedEnvironment(name: string, version: string) {
		mkdirSync(join(dir.path, name), { recursive: true })
		writeFileSync(
			join(dir.path, name, '.envbench.json'),
			JSON.stringify({ name, blockbench_version: version }),
		)
	}
	function seedPortable(fileName: string) {
		const cache = join(dir.path, '.portables')
		mkdirSync(cache, { recursive: true })
		writeFileSync(join(cache, fileName), 'binary')
		return join(cache, fileName)
	}

	it('locates the portable that matches the environment version', async () => {
		seedEnvironment('e', '5.1.6')
		const expected = seedPortable('blockbench-5.1.6.AppImage')
		expect(await resolvePortablePath('e')).toBe(expected)
	})

	it('falls back to the newest local portable when version resolution fails', async () => {
		seedEnvironment('e', 'latest')
		seedPortable('blockbench-5.1.4.AppImage')
		const newest = seedPortable('blockbench-5.1.9.AppImage')
		const fetchSpy = spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
		try {
			expect(await resolvePortablePath('e')).toBe(newest)
		} finally {
			fetchSpy.mockRestore()
		}
	})

	it('throws a helpful error when no portable is present', async () => {
		seedEnvironment('e', '5.1.6')
		await expect(resolvePortablePath('e')).rejects.toThrow(/portable not found/)
	})
})
