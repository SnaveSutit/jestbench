import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { Envbench } from 'envbench'

import {
	compareSemver,
	createEnvbench,
	ensureEnvironment,
	environmentDir,
	resolvePortablePath,
} from '../src/envbench'
import { tempDir, withEnv } from './helpers'

const env = withEnv(['ENVBENCH_STORAGE_FOLDER', 'BLOCKBENCH_PORTABLES_CACHE'])
let dir: ReturnType<typeof tempDir>

/** An offline Envbench rooted at the temp dir, so nothing touches the real cache. */
function localEnvbench(): Envbench {
	return new Envbench({
		storageDir: dir.path,
		portablesCache: join(dir.path, '.portables'),
		online: false,
	})
}

function seedEnvironment(name: string, version: string) {
	mkdirSync(join(dir.path, name), { recursive: true })
	writeFileSync(
		join(dir.path, name, '.envbench.json'),
		JSON.stringify({ name, blockbench_version: version }),
	)
}

function seedPortable(fileName: string): string {
	const cache = join(dir.path, '.portables')
	mkdirSync(cache, { recursive: true })
	const path = join(cache, fileName)
	writeFileSync(path, 'binary')
	return path
}

beforeEach(() => {
	dir = tempDir()
	delete process.env.ENVBENCH_STORAGE_FOLDER
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
		expect(['5.1.9', '5.1.10', '4.12.0'].sort(compareSemver)).toEqual([
			'4.12.0',
			'5.1.9',
			'5.1.10',
		])
	})
})

describe('createEnvbench', () => {
	it('honours ENVBENCH_STORAGE_FOLDER / BLOCKBENCH_PORTABLES_CACHE', () => {
		process.env.ENVBENCH_STORAGE_FOLDER = dir.path
		process.env.BLOCKBENCH_PORTABLES_CACHE = join(dir.path, 'cache')
		const eb = createEnvbench()
		expect(eb.storageDir).toBe(dir.path)
		expect(eb.portablesCache).toBe(join(dir.path, 'cache'))
	})

	it('ignores blank overrides', () => {
		process.env.ENVBENCH_STORAGE_FOLDER = '   '
		const eb = createEnvbench()
		expect(eb.storageDir).not.toBe('   ')
	})
})

describe('environmentDir', () => {
	it('resolves under the Envbench storage folder', () => {
		expect(environmentDir(localEnvbench(), 'foo')).toBe(join(dir.path, 'foo'))
	})
})

describe('ensureEnvironment', () => {
	it('does nothing when the environment already exists', async () => {
		const create = mock(() => Promise.resolve())
		const eb = {
			environmentExists: () => Promise.resolve('env' as const),
			createEnvironment: create,
		} as unknown as Envbench

		await ensureEnvironment(eb, 'my-env', '5.1.6')
		expect(create).not.toHaveBeenCalled()
	})

	it('creates the environment with the requested version when missing', async () => {
		const create = mock(() => Promise.resolve())
		const eb = {
			environmentExists: () => Promise.resolve(false as const),
			createEnvironment: create,
		} as unknown as Envbench

		await ensureEnvironment(eb, 'my-env', '5.1.6')
		expect(create).toHaveBeenCalledTimes(1)
		expect(create).toHaveBeenCalledWith(
			'my-env',
			expect.objectContaining({ blockbenchVersion: '5.1.6' }),
			expect.anything(),
		)
	})
})

describe('resolvePortablePath', () => {
	it('locates the portable that matches the environment version', async () => {
		seedEnvironment('e', '5.1.6')
		const expected = seedPortable('blockbench-5.1.6.AppImage')
		expect(await resolvePortablePath(localEnvbench(), 'e')).toBe(expected)
	})

	it('falls back to the newest cached portable when the version cannot be resolved', async () => {
		// `latest` cannot be resolved offline, so the newest local portable wins.
		seedEnvironment('e', 'latest')
		seedPortable('blockbench-5.1.4.AppImage')
		const newest = seedPortable('blockbench-5.1.9.AppImage')
		expect(await resolvePortablePath(localEnvbench(), 'e')).toBe(newest)
	})

	it('throws a helpful error when no portable is present', async () => {
		seedEnvironment('e', '5.1.6')
		await expect(resolvePortablePath(localEnvbench(), 'e')).rejects.toThrow(
			/portable not found/,
		)
	})
})
