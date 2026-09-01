import { beforeAll, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Jestbench is a Jest addon, so its end-to-end suite runs under
 * Jest. This test drives that suite as a subprocess, so a single `bun test`
 * covers everything.
 *
 * Set `SKIP_E2E=1` to skip it. It launches a headless Blockbench, and the first
 * run downloads Blockbench via envbench.
 */

const repoRoot = join(import.meta.dir, '..')
const run = process.env.SKIP_E2E ? test.skip : test

beforeAll(() => {
	const build = spawnSync('bun', ['run', 'build'], { cwd: repoRoot, encoding: 'utf-8' })
	if (build.status !== 0) {
		throw new Error(`build failed:\n${build.stdout}\n${build.stderr}`)
	}
	expect(existsSync(join(repoRoot, 'dist/index.js'))).toBe(true)
})

run(
	'the example plugin suite passes under Jest',
	() => {
		const result = spawnSync(
			process.execPath,
			['node_modules/jest/bin/jest.js', '--ci', '--colors=false'],
			{ cwd: repoRoot, encoding: 'utf-8', timeout: 6 * 60_000 },
		)
		const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`

		if (result.status !== 0 || !/Tests:\s+\d+ passed/.test(output)) {
			// Print Jest's own report on failure.
			console.error(output)
		} else {
			for (const line of output.split('\n')) {
				if (/^(Test Suites|Tests):/.test(line.trim()))
					console.log(`  jest › ${line.trim()}`)
			}
		}

		expect(result.error).toBeUndefined() // e.g. a timeout
		expect(result.status).toBe(0)
		expect(output).toMatch(/Test Suites:\s+1 passed, 1 total/)
		expect(output).toMatch(/Tests:\s+7 passed, 7 total/)
	},
	6 * 60_000,
)
