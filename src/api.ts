import { basename } from 'node:path'

import type { Page } from 'puppeteer-core'

import type { Bridge } from './bridge'

/** Normalised snapshot of a GUI handle, consumed by the custom matchers. */
export interface HandleState {
	kind: string
	label: string
	exists: boolean
	visible?: boolean
	enabled?: boolean
	open?: boolean
	[extra: string]: unknown
}

export interface Inspectable {
	readonly __bbHandle: string
	readonly label: string
	inspect(): Promise<HandleState>
}

export function pluginIdFromPath(path: string): string {
	return basename(path).replace(/\.js$/, '')
}

// ---------------------------------------------------------------------------
// Functions below run in the Blockbench renderer (puppeteer serialises them).
// They must be self-contained: no imports, no outer references.
// ---------------------------------------------------------------------------

export interface MenuProbe {
	menuExists: boolean
	found: boolean
	enabled: boolean
	path: string[]
}

/**
 * Walk a menu-bar menu's structure looking for an item whose display name (or
 * id) matches `wanted` (case-insensitive). Runs in the renderer.
 */
export function pageFindMenuItem(menuId: string, wanted: string): MenuProbe {
	const g = globalThis as any
	const MenuBar: any = g.MenuBar
	const tl: any = g.tl ?? ((s: string) => s)
	const Condition: any = g.Condition
	const BarItems: any = g.BarItems
	const menu = MenuBar?.menus?.[menuId]
	if (!menu) return { menuExists: false, found: false, enabled: false, path: [] }

	const target = wanted.toLowerCase()
	const matches: Array<{ enabled: boolean; path: string[] }> = []

	const testCondition = (cond: any): boolean => {
		try {
			return cond == null ? true : !!(Condition ? Condition(cond) : cond)
		} catch {
			return true
		}
	}

	const walk = (entries: any[], trail: string[]) => {
		if (!Array.isArray(entries)) return
		for (const entry of entries) {
			if (entry == null || entry === '_' || entry?.constructor?.name === 'MenuSeparator') {
				continue
			}
			let names: string[] = []
			let enabled = true
			let children: any[] | undefined

			if (typeof entry === 'string') {
				const item = BarItems?.[entry]
				if (!item) continue
				names = [item.name, entry].filter(Boolean)
				enabled = testCondition(item.condition)
			} else {
				names = [entry.name && tl(entry.name), entry.name, entry.id].filter(Boolean)
				enabled = testCondition(entry.condition)
				children = typeof entry.children === 'function' ? entry.children() : entry.children
			}

			const here = [...trail, names[0] ?? '?']
			if (names.some(n => String(n).toLowerCase() === target)) {
				matches.push({ enabled, path: here })
			}
			if (children) walk(children, here)
		}
	}

	const structure = typeof menu.structure === 'function' ? menu.structure() : menu.structure
	walk(structure, [])

	const match = matches[0]
	return {
		menuExists: true,
		found: !!match,
		enabled: match?.enabled ?? false,
		path: match?.path ?? [],
	}
}

/** Flat list of every item label in a menu (nested items included). Renderer. */
export function pageListMenuItems(menuId: string): string[] {
	const g = globalThis as any
	const MenuBar: any = g.MenuBar
	const tl: any = g.tl ?? ((s: string) => s)
	const BarItems: any = g.BarItems
	const menu = MenuBar?.menus?.[menuId]
	if (!menu) return []
	const out: string[] = []
	const walk = (entries: any[]) => {
		if (!Array.isArray(entries)) return
		for (const entry of entries) {
			if (entry == null || entry === '_' || entry?.constructor?.name === 'MenuSeparator') {
				continue
			}
			if (typeof entry === 'string') {
				const item = BarItems?.[entry]
				if (item?.name) out.push(item.name)
			} else {
				if (entry.name) out.push(tl(entry.name))
				const children =
					typeof entry.children === 'function' ? entry.children() : entry.children
				if (children) walk(children)
			}
		}
	}
	const structure = typeof menu.structure === 'function' ? menu.structure() : menu.structure
	walk(structure)
	return out
}

/** Remove every loaded copy of a plugin id, running its `onunload`. */
export function pageUnloadPlugin(id: string): void {
	const Plugins: any = (globalThis as any).Plugins
	if (!Plugins?.all) return
	for (const p of Plugins.all.filter((pl: any) => pl.id === id)) {
		try {
			p.unload?.()
		} catch {
			/* ignore a throwing onunload */
		}
		Plugins.all.remove?.(p)
	}
	if (Plugins.registered) delete Plugins.registered[id]
	// Keep the persistent envbench environment clean between runs.
	const inst = Plugins.installed?.find?.((x: any) => x.id === id)
	if (inst) {
		Plugins.installed.remove?.(inst)
		try {
			;(globalThis as any).StateMemory?.save?.('installed_plugins')
		} catch {
			/* best effort */
		}
	}
}

// ---------------------------------------------------------------------------
// Handles
// ---------------------------------------------------------------------------

export class PluginHandle implements Inspectable {
	readonly __bbHandle = 'plugin'
	constructor(
		private readonly bridge: Bridge,
		readonly id: string,
		readonly path?: string,
	) {}

	get label(): string {
		return `plugin "${this.id}"`
	}

	/** Whether Blockbench currently has this plugin loaded. */
	isLoaded(): Promise<boolean> {
		return this.bridge.evaluate(
			id => !!(globalThis as any).Plugins?.all?.find((p: any) => p.id === id),
			this.id,
		)
	}

	/** Read the plugin's registered metadata, or `null` if it is not loaded. */
	meta(): Promise<null | Record<string, unknown>> {
		return this.bridge.evaluate(id => {
			const p: any = (globalThis as any).Plugins?.all?.find((pl: any) => pl.id === id)
			if (!p) return null
			return {
				id: p.id,
				title: p.title,
				author: p.author,
				version: p.version,
				description: p.description,
				source: p.source,
				disabled: p.disabled,
			}
		}, this.id)
	}

	/** Re-run the plugin from disk (file plugins only). */
	async reload(): Promise<void> {
		await this.bridge.evaluate(async id => {
			const p: any = (globalThis as any).Plugins?.all?.find((pl: any) => pl.id === id)
			if (p?.reload) await p.reload()
		}, this.id)
	}

	/** Unload the plugin and remove it from Blockbench. */
	async unload(): Promise<void> {
		await this.bridge.evaluate(pageUnloadPlugin, this.id)
	}

	async inspect(): Promise<HandleState> {
		return { kind: 'plugin', label: this.label, exists: await this.isLoaded() }
	}
}

export class ActionHandle implements Inspectable {
	readonly __bbHandle = 'action'
	constructor(
		private readonly bridge: Bridge,
		readonly id: string,
	) {}

	get label(): string {
		return `action "${this.id}"`
	}

	private read() {
		return this.bridge.evaluate(id => {
			const item: any = (globalThis as any).BarItems?.[id]
			if (!item) return null
			let enabled = true
			try {
				const Condition: any = (globalThis as any).Condition
				if (item.condition != null && Condition) enabled = !!Condition(item.condition)
			} catch {
				/* keep default */
			}
			return {
				name: item.name,
				description: item.description,
				keybind: item.keybind?.label ?? null,
				type: item.type,
				enabled,
			}
		}, this.id)
	}

	exists(): Promise<boolean> {
		return this.read().then(Boolean)
	}

	/** The action's translated display name. */
	async name(): Promise<string | undefined> {
		return (await this.read())?.name
	}

	async isEnabled(): Promise<boolean> {
		return (await this.read())?.enabled ?? false
	}

	/** Fire the action, exactly as clicking its button would. */
	async trigger(): Promise<void> {
		const ok = await this.bridge.evaluate(id => {
			const item: any = (globalThis as any).BarItems?.[id]
			if (!item) return false
			item.trigger()
			return true
		}, this.id)
		if (!ok) throw new Error(`No action with id "${this.id}" is registered in Blockbench`)
	}

	async inspect(): Promise<HandleState> {
		const info = await this.read()
		return {
			kind: 'action',
			label: this.label,
			exists: !!info,
			enabled: info?.enabled ?? false,
			visible: !!info,
			name: info?.name,
		}
	}
}

export class MenuItemHandle implements Inspectable {
	readonly __bbHandle = 'menuItem'
	constructor(
		private readonly bridge: Bridge,
		readonly menuId: string,
		readonly name: string,
	) {}

	get label(): string {
		return `menu item "${this.name}" in menu "${this.menuId}"`
	}

	private read(): Promise<MenuProbe> {
		return this.bridge.evaluate(pageFindMenuItem, this.menuId, this.name)
	}

	async exists(): Promise<boolean> {
		return (await this.read()).found
	}

	async isVisible(): Promise<boolean> {
		const r = await this.read()
		return r.found && r.enabled
	}

	/** Path of labels from the menu root down to this item. */
	async path(): Promise<string[]> {
		return (await this.read()).path
	}

	async inspect(): Promise<HandleState> {
		const r = await this.read()
		return {
			kind: 'menuItem',
			label: this.label,
			exists: r.found,
			visible: r.found && r.enabled,
			enabled: r.enabled,
			menuExists: r.menuExists,
			path: r.path,
		}
	}
}

export class MenuHandle {
	constructor(
		private readonly bridge: Bridge,
		readonly id: string,
	) {}

	/** A handle to one item in this menu, matched by display name or id. */
	item(name: string): MenuItemHandle {
		return new MenuItemHandle(this.bridge, this.id, name)
	}

	has(name: string): Promise<boolean> {
		return this.item(name).exists()
	}

	/** Flat list of every item label in the menu (including nested ones). */
	items(): Promise<string[]> {
		return this.bridge.evaluate(pageListMenuItems, this.id)
	}
}

export class DialogHandle implements Inspectable {
	readonly __bbHandle = 'dialog'
	constructor(private readonly bridge: Bridge) {}

	readonly label = 'the open dialog'

	private read() {
		return this.bridge.evaluate(() => {
			const dialog: any = (globalThis as any).Dialog?.open
			if (!dialog) return null
			const tl: any = (globalThis as any).tl ?? ((s: string) => s)
			let values: Record<string, unknown> = {}
			try {
				values = dialog.getFormResult?.() ?? {}
			} catch {
				/* form-less dialog */
			}
			return { id: dialog.id, title: tl(dialog.title), values }
		})
	}

	isOpen(): Promise<boolean> {
		return this.read().then(Boolean)
	}

	async id(): Promise<string | undefined> {
		return (await this.read())?.id
	}

	async title(): Promise<string | undefined> {
		return (await this.read())?.title
	}

	/** Current form values of the dialog. */
	async values(): Promise<Record<string, unknown>> {
		return (await this.read())?.values ?? {}
	}

	async setValues(values: Record<string, unknown>): Promise<void> {
		const ok = await this.bridge.evaluate(v => {
			const dialog: any = (globalThis as any).Dialog?.open
			if (!dialog?.setFormValues) return false
			dialog.setFormValues(v)
			return true
		}, values)
		if (!ok) throw new Error('No dialog is currently open (or it has no form)')
	}

	/** Press the dialog's confirm button. */
	async confirm(): Promise<void> {
		const ok = await this.bridge.evaluate(() => {
			const dialog: any = (globalThis as any).Dialog?.open
			if (!dialog) return false
			dialog.confirm()
			return true
		})
		if (!ok) throw new Error('No dialog is currently open')
	}

	/** Press the dialog's cancel button / close it. */
	async cancel(): Promise<void> {
		await this.bridge.evaluate(() => {
			;(globalThis as any).Dialog?.open?.cancel?.()
		})
	}

	async inspect(): Promise<HandleState> {
		const info = await this.read()
		return {
			kind: 'dialog',
			label: info ? `dialog "${info.id}"` : this.label,
			exists: !!info,
			open: !!info,
			title: info?.title,
		}
	}
}

export class PanelHandle implements Inspectable {
	readonly __bbHandle = 'panel'
	constructor(
		private readonly bridge: Bridge,
		readonly id: string,
	) {}

	get label(): string {
		return `panel "${this.id}"`
	}

	private read() {
		return this.bridge.evaluate(id => {
			const panel: any = (globalThis as any).Panels?.[id]
			if (!panel) return null
			let visible = false
			try {
				visible =
					typeof panel.isVisible === 'function'
						? !!panel.isVisible()
						: !!panel.node?.isConnected
			} catch {
				/* keep default */
			}
			return { slot: panel.slot, visible }
		}, this.id)
	}

	exists(): Promise<boolean> {
		return this.read().then(Boolean)
	}

	async isVisible(): Promise<boolean> {
		return (await this.read())?.visible ?? false
	}

	async inspect(): Promise<HandleState> {
		const info = await this.read()
		return {
			kind: 'panel',
			label: this.label,
			exists: !!info,
			visible: info?.visible ?? false,
		}
	}
}

// ---------------------------------------------------------------------------
// The root API
// ---------------------------------------------------------------------------

export interface NewProjectOptions {
	/** File name to give the new project. */
	name?: string
}

export class BlockbenchAPI {
	/** @internal plugin ids loaded via {@link loadPlugin} since the last reset. */
	readonly _testLoaded = new Set<string>()

	constructor(private readonly bridge: Bridge) {}

	/** The raw puppeteer {@link Page} for the Blockbench window. */
	get page(): Page {
		return this.bridge.page
	}

	/** Run a function inside the Blockbench renderer and return its result. */
	evaluate<Args extends unknown[], R>(
		fn: (...args: Args) => R | Promise<R>,
		...args: Args
	): Promise<R> {
		return this.bridge.evaluate(fn, ...args)
	}

	/** Blockbench version string, e.g. `"5.1.6"`. */
	version(): Promise<string> {
		return this.bridge.evaluate(() => (globalThis as any).Blockbench.version)
	}

	// -- plugins -------------------------------------------------------------

	/**
	 * Load a plugin from a `.js` file into the running Blockbench, the same way
	 * "Load Plugin from File" does. The plugin's `onload` runs before this
	 * resolves. Returns a handle for asserting on and unloading it.
	 */
	async loadPlugin(path: string): Promise<PluginHandle> {
		const id = pluginIdFromPath(path)
		const result = await this.bridge.evaluate(
			async (p: string, expectedId: string) => {
				const g = globalThis as any
				const PluginCtor: any = g.Plugin
				const Plugins: any = g.Plugins
				if (!PluginCtor || !Plugins) return { ok: false, error: 'Plugin API unavailable' }

				// Make loading idempotent: drop any copy already present.
				for (const pl of (Plugins.all ?? []).filter((x: any) => x.id === expectedId)) {
					try {
						pl.unload?.()
					} catch {
						/* ignore */
					}
					Plugins.all.remove?.(pl)
					if (Plugins.registered) delete Plugins.registered[expectedId]
				}

				try {
					await new PluginCtor().loadFromFile({ path: p, name: p, content: '' }, false)
				} catch (err) {
					return { ok: false, error: String((err as Error)?.message ?? err) }
				}

				// Don't leave the plugin installed in the persistent envbench environment.
				const inst = Plugins.installed?.find?.((x: any) => x.id === expectedId)
				if (inst) {
					Plugins.installed.remove?.(inst)
					try {
						g.StateMemory?.save?.('installed_plugins')
					} catch {
						/* best effort */
					}
				}

				const loaded = !!(Plugins.all ?? []).find((pl: any) => pl.id === expectedId)
				return {
					ok: loaded,
					error: loaded
						? null
						: `plugin did not register - is the file named "${expectedId}.js" to match its Plugin.register() id?`,
				}
			},
			path,
			id,
		)

		if (!result.ok) {
			throw new Error(`Failed to load plugin from ${path}: ${result.error}`)
		}
		this._testLoaded.add(id)
		return new PluginHandle(this.bridge, id, path)
	}

	/** Handle for a plugin that is already loaded (e.g. preloaded via config). */
	plugin(id: string): PluginHandle {
		return new PluginHandle(this.bridge, id)
	}

	/** Ids of every currently loaded plugin. */
	loadedPlugins(): Promise<string[]> {
		return this.bridge.evaluate(() =>
			((globalThis as any).Plugins?.all ?? []).map((p: any) => p.id),
		)
	}

	/** Reload every reloadable file plugin (`Plugins.devReload()`). */
	async reloadPlugins(): Promise<void> {
		await this.bridge.evaluate(() => (globalThis as any).Plugins?.devReload?.())
	}

	// -- projects -----------------------------------------------------------

	/**
	 * Create a fresh project in the given format (no "New Project" dialog).
	 * `format` is a format id such as `"free"`, `"java_block"`, `"bedrock"`.
	 */
	async newProject(format = 'free', options: NewProjectOptions = {}): Promise<void> {
		const ok = await this.bridge.evaluate(
			(fmt: string, opts: NewProjectOptions) => {
				const newProject: any = (globalThis as any).newProject
				const Formats: any = (globalThis as any).Formats
				if (!newProject || !Formats) return false
				const created = newProject(Formats[fmt] ?? fmt)
				if (created && opts.name && (globalThis as any).Project) {
					;(globalThis as any).Project.name = opts.name
				}
				return !!created
			},
			format,
			options,
		)
		if (!ok) throw new Error(`Could not create a "${format}" project`)
	}

	/** Close the active project (discarding unsaved changes). */
	async closeProject(): Promise<void> {
		await this.bridge.evaluate(async () => {
			const Project: any = (globalThis as any).Project
			if (Project && typeof Project.close === 'function') await Project.close(true)
		})
	}

	/** Info about the active project, or `null` when the start screen is showing. */
	activeProject(): Promise<null | Record<string, unknown>> {
		return this.bridge.evaluate(() => {
			const Project: any = (globalThis as any).Project
			if (!Project) return null
			return {
				name: Project.name,
				format: Project.format?.id,
				uuid: Project.uuid,
				mode:
					(globalThis as any).Mode?.selected?.id ??
					(globalThis as any).Modes?.selected?.id,
				elements: Project.elements?.length ?? 0,
			}
		})
	}

	// -- GUI --------------------------------------------------------------

	action(id: string): ActionHandle {
		return new ActionHandle(this.bridge, id)
	}

	menu(id: string): MenuHandle {
		return new MenuHandle(this.bridge, id)
	}

	/** Handle for the currently open dialog. */
	dialog(): DialogHandle {
		return new DialogHandle(this.bridge)
	}

	panel(id: string): PanelHandle {
		return new PanelHandle(this.bridge, id)
	}

	/** Change a Blockbench setting by id. */
	async setSetting(id: string, value: unknown): Promise<void> {
		const ok = await this.bridge.evaluate(
			(settingId: string, v: unknown) => {
				const setting: any = (globalThis as any).settings?.[settingId]
				if (!setting) return false
				setting.set ? setting.set(v) : (setting.value = v)
				return true
			},
			id,
			value,
		)
		if (!ok) throw new Error(`No setting with id "${id}"`)
	}

	getSetting(id: string): Promise<unknown> {
		return this.bridge.evaluate(
			(settingId: string) => (globalThis as any).settings?.[settingId]?.value,
			id,
		)
	}

	// -- low level -------------------------------------------------------

	/** Click a DOM element in the Blockbench window by CSS selector. */
	async click(selector: string): Promise<void> {
		await this.bridge.page.click(selector)
	}

	/** Wait for a selector to appear in the Blockbench DOM. */
	async waitForSelector(selector: string, timeout = 5000): Promise<void> {
		await this.bridge.page.waitForSelector(selector, { timeout })
	}

	/**
	 * Wait until `expression` evaluates truthy in the renderer. Handy for
	 * letting async plugin work settle.
	 */
	async waitFor(expression: string | (() => unknown), timeout = 5000): Promise<void> {
		await this.bridge.page.waitForFunction(expression, { timeout, polling: 50 })
	}

	/** Save a screenshot of the Blockbench window. */
	async screenshot(path: string): Promise<void> {
		await this.bridge.page.screenshot({ path: path as `${string}.png` })
	}

	// -- test isolation --------------------------------------------------

	/** @internal used by the framework between tests */
	async resetForNextTest(): Promise<void> {
		const loadedByTests = [...this._testLoaded]
		this._testLoaded.clear()
		await this.bridge.evaluate(async (ids: string[]) => {
			const g = globalThis as any
			const Plugins: any = g.Plugins
			for (const id of ids) {
				for (const p of (Plugins?.all ?? []).filter((pl: any) => pl.id === id)) {
					try {
						p.unload?.()
					} catch {
						/* ignore */
					}
					Plugins.all.remove?.(p)
					if (Plugins.registered) delete Plugins.registered[id]
				}
				const inst = Plugins?.installed?.find?.((x: any) => x.id === id)
				if (inst) {
					Plugins.installed.remove?.(inst)
					try {
						g.StateMemory?.save?.('installed_plugins')
					} catch {
						/* best effort */
					}
				}
			}
			if (g.Dialog?.open) g.Dialog.open.cancel?.()
			if (g.Project && typeof g.Project.close === 'function') await g.Project.close(true)
		}, loadedByTests)
	}
}
