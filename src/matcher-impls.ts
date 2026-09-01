import { BlockbenchAPI, type Inspectable } from './api'

/**
 * The custom matcher implementations, kept free of any `@jest/globals` import so
 * they can be unit-tested directly. `matchers.ts` wires these into `expect`.
 */

export interface MatcherResult {
	pass: boolean
	message: () => string
}

export function isInspectable(v: unknown): v is Inspectable {
	return !!v && typeof (v as Inspectable).inspect === 'function'
}

export function isApi(v: unknown): v is BlockbenchAPI {
	if (v instanceof BlockbenchAPI) return true
	// `blockbench` from the package entry is a lazy Proxy, not an instance.
	const cand = v as Partial<BlockbenchAPI> | null
	return (
		!!cand &&
		typeof cand.loadedPlugins === 'function' &&
		typeof cand.action === 'function' &&
		typeof cand.menu === 'function'
	)
}

function ensureInspectable(received: unknown): Inspectable {
	if (!isInspectable(received)) {
		throw new Error(
			'This matcher expects a Blockbench GUI handle, e.g. ' +
				'blockbench.action("id"), blockbench.menu("filter").item("Name") or blockbench.dialog().',
		)
	}
	return received
}

function ensureApi(received: unknown, matcher: string): BlockbenchAPI {
	if (!isApi(received)) {
		throw new Error(`${matcher} expects the \`blockbench\` object`)
	}
	return received
}

export const matcherImplementations = {
	async toExist(received: unknown): Promise<MatcherResult> {
		const state = await ensureInspectable(received).inspect()
		return {
			pass: state.exists,
			message: () =>
				state.exists
					? `Expected ${state.label} not to exist, but it does.`
					: `Expected ${state.label} to exist, but it was not found.`,
		}
	},

	async toBeVisible(received: unknown): Promise<MatcherResult> {
		const state = await ensureInspectable(received).inspect()
		const visible = state.visible ?? state.exists
		return {
			pass: visible,
			message: () =>
				visible
					? `Expected ${state.label} not to be visible, but it is.`
					: state.exists
						? `Expected ${state.label} to be visible, but it is hidden/disabled.`
						: `Expected ${state.label} to be visible, but it does not exist.`,
		}
	},

	async toBeEnabled(received: unknown): Promise<MatcherResult> {
		const state = await ensureInspectable(received).inspect()
		const enabled = state.enabled ?? false
		return {
			pass: enabled,
			message: () =>
				enabled
					? `Expected ${state.label} to be disabled, but it is enabled.`
					: `Expected ${state.label} to be enabled, but it is disabled${
							state.exists ? '' : ' (it does not exist)'
						}.`,
		}
	},

	async toBeOpen(received: unknown): Promise<MatcherResult> {
		const state = await ensureInspectable(received).inspect()
		const open = state.open ?? false
		return {
			pass: open,
			message: () =>
				open
					? `Expected ${state.label} not to be open, but it is.`
					: `Expected ${state.label} to be open, but it is not.`,
		}
	},

	async toHaveLoadedPlugin(received: unknown, id: string): Promise<MatcherResult> {
		const ids = await ensureApi(received, 'toHaveLoadedPlugin').loadedPlugins()
		return {
			pass: ids.includes(id),
			message: () =>
				ids.includes(id)
					? `Expected plugin "${id}" not to be loaded, but it is.`
					: `Expected plugin "${id}" to be loaded. Loaded plugins: ${
							ids.join(', ') || '(none)'
						}.`,
		}
	},

	async toHaveAction(received: unknown, id: string): Promise<MatcherResult> {
		const exists = await ensureApi(received, 'toHaveAction').action(id).exists()
		return {
			pass: exists,
			message: () =>
				exists
					? `Expected no action with id "${id}", but one is registered.`
					: `Expected an action with id "${id}" to be registered, but none was found.`,
		}
	},

	async toHaveMenuItem(received: unknown, menuId: string, name: string): Promise<MatcherResult> {
		const exists = await ensureApi(received, 'toHaveMenuItem').menu(menuId).has(name)
		return {
			pass: exists,
			message: () =>
				exists
					? `Expected menu "${menuId}" not to contain an item named "${name}", but it does.`
					: `Expected menu "${menuId}" to contain an item named "${name}", but it does not.`,
		}
	},
}
