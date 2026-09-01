import puppeteer, { type Browser, type Page } from 'puppeteer-core'

import type { ResolvedConfig } from './config'

/**
 * A live connection to the Blockbench renderer process. Everything the test API
 * does goes through {@link Bridge.evaluate}, which runs a function in the
 * renderer with access to all of Blockbench's globals (`Blockbench`, `Project`,
 * `BarItems`, `Dialog`, the DOM, and so on).
 */
export class Bridge {
	private constructor(
		readonly browser: Browser,
		readonly page: Page,
	) {}

	static async connect(wsEndpoint: string, config: ResolvedConfig): Promise<Bridge> {
		const browser = await puppeteer.connect({
			browserWSEndpoint: wsEndpoint,
			defaultViewport: null,
			protocolTimeout: Math.max(config.launchTimeout, 30_000),
		})

		const page = await findBlockbenchPage(browser)
		await page.waitForFunction(config.readyExpression, {
			timeout: config.launchTimeout,
			polling: 100,
		})
		return new Bridge(browser, page)
	}

	/**
	 * Run `fn` in the Blockbench renderer and return its (JSON-serialisable)
	 * result. `fn` may be async; promises are awaited. Only JSON-safe arguments
	 * and return values cross the boundary. Closures do not.
	 */
	evaluate<Args extends unknown[], R>(
		fn: (...args: Args) => R | Promise<R>,
		...args: Args
	): Promise<R> {
		// puppeteer's EvaluateFunc generic is stricter than we need here; the
		// runtime contract (JSON-serialisable args in, JSON-serialisable value
		// out) is enforced by the CDP boundary itself.
		return this.page.evaluate(
			fn as (...a: unknown[]) => R,
			...(args as unknown[]),
		) as Promise<R>
	}

	/** Evaluate a raw expression string in the renderer. */
	run<R = unknown>(expression: string): Promise<R> {
		return this.page.evaluate(expression) as Promise<R>
	}

	/** Detach without closing Blockbench (it is shared across the whole run). */
	async dispose(): Promise<void> {
		try {
			await this.browser.disconnect()
		} catch {
			/* already gone */
		}
	}
}

async function findBlockbenchPage(browser: Browser): Promise<Page> {
	const deadline = Date.now() + 15_000
	while (Date.now() < deadline) {
		const pages = await browser.pages()
		const page =
			pages.find(p => p.url().includes('app.asar')) ??
			pages.find(p => p.url().endsWith('index.html')) ??
			pages.find(p => !p.url().startsWith('devtools://'))
		if (page) return page
		await new Promise(r => setTimeout(r, 200))
	}
	throw new Error('Could not find the Blockbench window among the DevTools targets')
}
