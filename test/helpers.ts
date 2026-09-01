import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Create a temp directory that is removed when `dispose()` is called. */
export function tempDir(): { path: string; dispose(): void } {
	const path = mkdtempSync(join(tmpdir(), 'bpt-test-'))
	return {
		path,
		dispose: () => rmSync(path, { recursive: true, force: true }),
	}
}

/** Snapshot env vars and restore them after the test. */
export function withEnv(keys: string[]): { restore(): void } {
	const saved = new Map<string, string | undefined>()
	for (const k of keys) saved.set(k, process.env[k])
	return {
		restore: () => {
			for (const [k, v] of saved) {
				if (v === undefined) delete process.env[k]
				else process.env[k] = v
			}
		},
	}
}

/**
 * A stand-in for {@link import('../src/bridge').Bridge} that records the
 * page-side functions it is asked to run and returns canned results.
 */
export class FakeBridge {
	calls: Array<{ fn: unknown; args: unknown[] }> = []
	private responder: (fn: unknown, args: unknown[]) => unknown

	constructor(responder: (fn: unknown, args: unknown[]) => unknown = () => undefined) {
		this.responder = responder
	}

	page = {} as unknown

	async evaluate(fn: unknown, ...args: unknown[]): Promise<unknown> {
		this.calls.push({ fn, args })
		return this.responder(fn, args)
	}

	run = async () => undefined
	dispose = async () => undefined
}
