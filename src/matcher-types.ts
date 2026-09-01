/**
 * Type-level registration of the custom matchers. Imported by the package entry
 * so that `import '@snavesutit/jestbench'` is enough to get matcher typings;
 * the runtime `expect.extend` call lives in `matchers.ts`.
 */

export interface BlockbenchMatchers<R = void> {
	/** Passes when a GUI handle refers to something that exists in Blockbench. */
	toExist(): Promise<R>
	/** Passes when a handle exists and is currently shown / not disabled. */
	toBeVisible(): Promise<R>
	/** Passes when an action / menu item is not disabled by its condition. */
	toBeEnabled(): Promise<R>
	/** Passes when `blockbench.dialog()` refers to a dialog that is open. */
	toBeOpen(): Promise<R>
	/** On the `blockbench` object: passes when a plugin id is loaded. */
	toHaveLoadedPlugin(id: string): Promise<R>
	/** On the `blockbench` object: passes when an action id is registered. */
	toHaveAction(id: string): Promise<R>
	/** On the `blockbench` object: passes when a menu contains a named item. */
	toHaveMenuItem(menuId: string, name: string): Promise<R>
}

// Jest 30's recommended typing path: `import { expect } from '@jest/globals'`.
declare module 'expect' {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	interface Matchers<R extends void | Promise<void>, T = unknown> extends BlockbenchMatchers<R> {}
}
