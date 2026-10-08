import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Mirrors `REQUESTABLE_APIS` in Blockbench's `js/native_apis.ts`. */
const REQUESTABLE_MODULES = [
	'fs',
	'process',
	'child_process',
	'https',
	'net',
	'tls',
	'util',
	'os',
	'v8',
	'dialog',
	'clipboard',
	'shell',
]

type PluginPermissions = Record<string, { allowed: Record<string, unknown> }>

/**
 * Pre-approve every requestable module for the given plugins in the
 * environment's `plugin_permissions.json`. Blockbench asks for permission with
 * a native, synchronous dialog that freezes the renderer, so an unanswered
 * prompt would hang every test. It reads the file once at startup, so this must
 * run before launch. Existing entries are kept.
 */
export function grantPluginPermissions(userDataDir: string, pluginIds: string[]): void {
	if (!pluginIds.length) return
	const file = join(userDataDir, 'plugin_permissions.json')

	let permissions: PluginPermissions = {}
	try {
		permissions = JSON.parse(readFileSync(file, 'utf-8'))
	} catch {
		/* missing or unreadable: start fresh */
	}

	for (const id of pluginIds) {
		const allowed = (permissions[id] ??= { allowed: {} }).allowed
		// Blockbench keys by the exact name the plugin requires, prefixed or not.
		for (const name of REQUESTABLE_MODULES) {
			allowed[name] = true
			allowed[`node:${name}`] = true
		}
	}

	writeFileSync(file, JSON.stringify(permissions))
}
