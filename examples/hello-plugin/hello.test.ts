import { describe, expect, it } from '@jest/globals'

import { blockbench, closeProject, gui, loadPlugin, newProject } from 'blockbench-plugin-test'

// `hello_world.js` is preloaded via blockbench.config.mjs, so the plugin is
// already running when the suite starts.

describe('hello_world plugin', () => {
	it('is loaded into Blockbench', async () => {
		await expect(blockbench).toHaveLoadedPlugin('hello_world')
	})

	it('registers its actions', async () => {
		await expect(blockbench).toHaveAction('hello_world_greet')
		await expect(blockbench).toHaveAction('hello_world_open_dialog')
	})

	it('adds "Add Greeting Cube" to the Filter menu', async () => {
		await expect(blockbench).toHaveMenuItem('filter', 'Add Greeting Cube')
	})

	it('disables the greeting action until a project is open', async () => {
		await expect(gui.action('hello_world_greet')).not.toBeEnabled()

		await newProject('free')
		await expect(gui.action('hello_world_greet')).toBeEnabled()

		await closeProject()
	})

	it('adds a "Greeting" cube when triggered', async () => {
		await newProject('free')

		await gui.action('hello_world_greet').trigger()

		const cubes = await blockbench.evaluate(() =>
			(globalThis as any).Cube.all.map((c: any) => c.name),
		)
		expect(cubes).toContain('Greeting')

		await closeProject()
	})

	it('opens the Hello dialog and reads its form', async () => {
		await gui.action('hello_world_open_dialog').trigger()

		const dialog = gui.dialog()
		await expect(dialog).toBeOpen()
		expect(await dialog.title()).toBe('Hello World')
		expect(await dialog.values()).toMatchObject({ greeting: 'Hello' })

		await dialog.setValues({ greeting: 'Howdy' })
		expect(await dialog.values()).toMatchObject({ greeting: 'Howdy' })

		await dialog.cancel()
		await expect(dialog).not.toBeOpen()
	})
})

describe('loading a plugin at runtime', () => {
	it('can load and unload the same plugin file by hand', async () => {
		// Unload the preloaded copy first so we start clean.
		await blockbench.plugin('hello_world').unload()
		await expect(blockbench).not.toHaveLoadedPlugin('hello_world')

		const handle = await loadPlugin(new URL('./hello_world.js', import.meta.url).pathname)
		expect(handle.id).toBe('hello_world')
		await expect(blockbench).toHaveLoadedPlugin('hello_world')

		await handle.unload()
		await expect(blockbench).not.toHaveLoadedPlugin('hello_world')
	})
})
