import type {
	ActionHandle,
	BlockbenchAPI,
	DialogHandle,
	MenuHandle,
	NewProjectOptions,
	PanelHandle,
	PluginHandle,
} from './api'

// Registers the custom-matcher typings for anyone importing this package.
import './matcher-types'

export { defineConfig } from './config'
export type { BlockbenchMatchers } from './matcher-types'
export type { JestbenchConfig, ResolvedConfig } from './config'
export type {
	ActionHandle,
	BlockbenchAPI,
	DialogHandle,
	HandleState,
	Inspectable,
	MenuHandle,
	MenuItemHandle,
	NewProjectOptions,
	PanelHandle,
	PluginHandle,
} from './api'

function resolveApi(): BlockbenchAPI {
	const api = (globalThis as Record<string, unknown>).__BLOCKBENCH_API__ as
		BlockbenchAPI | undefined
	if (!api) {
		throw new Error(
			'The Blockbench test API is not available. Make sure your Jest config uses\n' +
				'  preset: "@snavesutit/jestbench"\n' +
				'(or sets testEnvironment to "@snavesutit/jestbench/environment"), and that\n' +
				'you are calling it from inside a test.',
		)
	}
	return api
}

/**
 * The Blockbench test API, bound to the instance started for this test run.
 * Also available as the `blockbench` global inside every test file.
 */
export const blockbench: BlockbenchAPI = new Proxy({} as BlockbenchAPI, {
	get(_target, prop: string) {
		const value = Reflect.get(resolveApi() as object, prop)
		return typeof value === 'function' ? value.bind(resolveApi()) : value
	},
})

/** GUI-focused helpers, matching `blockbench.action` / `.menu` / `.dialog` / `.panel`. */
export const gui = {
	action: (id: string): ActionHandle => resolveApi().action(id),
	menu: (id: string): MenuHandle => resolveApi().menu(id),
	dialog: (): DialogHandle => resolveApi().dialog(),
	panel: (id: string): PanelHandle => resolveApi().panel(id),
}

// -- flat convenience re-exports -------------------------------------------

export const loadPlugin = (path: string): Promise<PluginHandle> => resolveApi().loadPlugin(path)
export const reloadPlugins = (): Promise<void> => resolveApi().reloadPlugins()
export const loadedPlugins = (): Promise<string[]> => resolveApi().loadedPlugins()
export const plugin = (id: string): PluginHandle => resolveApi().plugin(id)

export const newProject = (format?: string, options?: NewProjectOptions): Promise<void> =>
	resolveApi().newProject(format, options)
export const closeProject = (): Promise<void> => resolveApi().closeProject()
export const activeProject = (): Promise<null | Record<string, unknown>> =>
	resolveApi().activeProject()

export const action = gui.action
export const menu = gui.menu
export const dialog = gui.dialog
export const panel = gui.panel

export const evaluate: BlockbenchAPI['evaluate'] = (fn, ...args) =>
	resolveApi().evaluate(fn, ...args)
export const setSetting = (id: string, value: unknown): Promise<void> =>
	resolveApi().setSetting(id, value)
export const getSetting = (id: string): Promise<unknown> => resolveApi().getSetting(id)
export const screenshot = (path: string): Promise<void> => resolveApi().screenshot(path)
export const waitFor = (expr: string | (() => unknown), timeout?: number): Promise<void> =>
	resolveApi().waitFor(expr, timeout)
