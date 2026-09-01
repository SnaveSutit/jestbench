import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { defineConfig, loadConfig } from '../src/config'
import { tempDir, withEnv } from './helpers'

const env = withEnv(['BLOCKBENCH_CONFIG'])
let dir: ReturnType<typeof tempDir>

beforeEach(() => {
	delete process.env.BLOCKBENCH_CONFIG
	dir = tempDir()
})
afterEach(() => {
	dir.dispose()
	env.restore()
})

describe('defineConfig', () => {
	it('returns its input unchanged', () => {
		const cfg = { environment: 'x', blockbenchVersion: '5.1.6' }
		expect(defineConfig(cfg)).toBe(cfg)
	})
})

describe('loadConfig', () => {
	it('falls back to defaults when no config file exists', async () => {
		const cfg = await loadConfig(dir.path)
		expect(cfg.environment).toBe('jestbench')
		expect(cfg.blockbenchVersion).toBe('latest')
		expect(cfg.headless).toBe(true)
		expect(cfg.isolateTests).toBe(true)
		expect(cfg.plugins).toEqual([])
		expect(cfg.connect).toBeUndefined()
		expect(cfg.configPath).toBeUndefined()
	})

	it('loads and merges a JSON config over the defaults', async () => {
		writeFileSync(
			join(dir.path, 'blockbench.config.json'),
			JSON.stringify({ environment: 'my-env', blockbenchVersion: '5.1.6' }),
		)
		const cfg = await loadConfig(dir.path)
		expect(cfg.environment).toBe('my-env')
		expect(cfg.blockbenchVersion).toBe('5.1.6')
		expect(cfg.headless).toBe(true) // still the default
		expect(cfg.configPath).toBe(join(dir.path, 'blockbench.config.json'))
	})

	it('loads an ESM (.mjs) config via jiti', async () => {
		writeFileSync(
			join(dir.path, 'blockbench.config.mjs'),
			'export default { environment: "esm-env", headless: false }\n',
		)
		const cfg = await loadConfig(dir.path)
		expect(cfg.environment).toBe('esm-env')
		expect(cfg.headless).toBe(false)
	})

	it('loads a TypeScript config via jiti', async () => {
		writeFileSync(
			join(dir.path, 'blockbench.config.ts'),
			'const c: { environment: string } = { environment: "ts-env" }\nexport default c\n',
		)
		const cfg = await loadConfig(dir.path)
		expect(cfg.environment).toBe('ts-env')
	})

	it('ignores undefined values in the user config', async () => {
		writeFileSync(
			join(dir.path, 'blockbench.config.mjs'),
			'export default { environment: undefined, blockbenchVersion: "5.0.0" }\n',
		)
		const cfg = await loadConfig(dir.path)
		expect(cfg.environment).toBe('jestbench')
		expect(cfg.blockbenchVersion).toBe('5.0.0')
	})

	it('resolves plugin paths relative to the config file', async () => {
		writeFileSync(
			join(dir.path, 'blockbench.config.json'),
			JSON.stringify({ plugins: ['./plugins/a.js', '/abs/b.js'] }),
		)
		const cfg = await loadConfig(dir.path)
		expect(cfg.plugins).toEqual([join(dir.path, 'plugins/a.js'), '/abs/b.js'])
	})

	it('honours BLOCKBENCH_CONFIG', async () => {
		const custom = join(dir.path, 'nested', 'custom.config.json')
		writeFileSync(
			join(dir.path, 'blockbench.config.json'),
			JSON.stringify({ environment: 'ignored' }),
		)
		mkdirSync(join(dir.path, 'nested'))
		writeFileSync(custom, JSON.stringify({ environment: 'from-env-var' }))
		process.env.BLOCKBENCH_CONFIG = custom
		const cfg = await loadConfig(dir.path)
		expect(cfg.environment).toBe('from-env-var')
	})

	it('throws if BLOCKBENCH_CONFIG points at a missing file', async () => {
		process.env.BLOCKBENCH_CONFIG = join(dir.path, 'does-not-exist.json')
		await expect(loadConfig(dir.path)).rejects.toThrow(/does not exist/)
	})

	it('picks .ts before .js when both are present', async () => {
		writeFileSync(
			join(dir.path, 'blockbench.config.js'),
			'module.exports = { environment: "js" }\n',
		)
		writeFileSync(
			join(dir.path, 'blockbench.config.ts'),
			'export default { environment: "ts" }\n',
		)
		const cfg = await loadConfig(dir.path)
		expect(cfg.environment).toBe('ts')
	})
})
