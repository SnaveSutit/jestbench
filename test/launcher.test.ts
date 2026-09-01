import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'

import { connectExisting, getFreePort, isAlive, killBlockbench } from '../src/launcher'

describe('getFreePort', () => {
	it('returns a port that is actually bindable', async () => {
		const port = await getFreePort()
		expect(port).toBeGreaterThan(1023)
		expect(port).toBeLessThan(65_536)
		await new Promise<void>((resolve, reject) => {
			const srv = createServer()
			srv.once('error', reject)
			srv.listen(port, '127.0.0.1', () => srv.close(() => resolve()))
		})
	})

	it('hands out different ports on successive calls', async () => {
		const [a, b] = await Promise.all([getFreePort(), getFreePort()])
		expect(a).not.toBe(b)
	})
})

describe('connectExisting', () => {
	it('passes a ws:// endpoint straight through and derives the http origin', async () => {
		const r = await connectExisting('ws://127.0.0.1:9223/devtools/browser/xyz')
		expect(r.wsEndpoint).toBe('ws://127.0.0.1:9223/devtools/browser/xyz')
		expect(r.httpEndpoint).toBe('http://127.0.0.1:9223')
		expect(r.pid).toBeUndefined()
		await expect(r.kill()).resolves.toBeUndefined()
	})

	it('resolves an http origin by querying /json/version', async () => {
		const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(
				JSON.stringify({
					webSocketDebuggerUrl: 'ws://127.0.0.1:9223/devtools/browser/from-http',
				}),
				{
					status: 200,
				},
			),
		)
		try {
			const r = await connectExisting('http://127.0.0.1:9223')
			expect(r.wsEndpoint).toBe('ws://127.0.0.1:9223/devtools/browser/from-http')
			expect(String(fetchSpy.mock.calls[0]?.[0])).toBe('http://127.0.0.1:9223/json/version')
		} finally {
			fetchSpy.mockRestore()
		}
	})

	it('throws when the endpoint is unreachable', async () => {
		const fetchSpy = spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))
		try {
			await expect(connectExisting('http://127.0.0.1:1')).rejects.toThrow(/Could not reach/)
		} finally {
			fetchSpy.mockRestore()
		}
	})
})

describe('isAlive', () => {
	it('is true for the current process and false for a bogus pid', () => {
		expect(isAlive(process.pid)).toBe(true)
		expect(isAlive(2_147_483_646)).toBe(false)
	})
})

describe('killBlockbench', () => {
	const children: number[] = []
	afterEach(() => {
		for (const pid of children.splice(0)) {
			try {
				process.kill(pid, 'SIGKILL')
			} catch {
				/* already dead */
			}
		}
	})

	it('is a no-op when there is no pid', async () => {
		await expect(killBlockbench(undefined, undefined)).resolves.toBeUndefined()
	})

	it('terminates a detached child process group', async () => {
		const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
			detached: true,
			stdio: 'ignore',
		})
		children.push(child.pid!)
		// let it come up
		await new Promise(r => setTimeout(r, 200))
		expect(isAlive(child.pid!)).toBe(true)

		await killBlockbench(child.pid, undefined)
		expect(isAlive(child.pid!)).toBe(false)
	})

	it('kills a leftover process by its userData dir even without a pid', async () => {
		const marker = `/tmp/bpt-kill-marker-${Date.now()}`
		const child = spawn(
			process.execPath,
			['-e', `process.title=${JSON.stringify(marker)}; setInterval(()=>{}, 1000)`, marker],
			{ detached: true, stdio: 'ignore' },
		)
		children.push(child.pid!)
		await new Promise(r => setTimeout(r, 200))
		expect(isAlive(child.pid!)).toBe(true)

		await killBlockbench(undefined, marker)
		expect(isAlive(child.pid!)).toBe(false)
	})
})
