<div align="center">

# blockbench-plugin-test

**End-to-end tests for your [Blockbench](https://www.blockbench.net/) plugins.**

A Jest addon that runs your test suite inside a headless, isolated Blockbench
instance. Load your plugin, click menus, fill dialogs, inspect the project,
assert on the result.

</div>

---

Blockbench plugins run inside the app. They call `Blockbench`, `Project`,
`Cube`, `new Action(...)`, `new Dialog(...)`, the menu bar, the DOM. None of
that exists in a plain Node/Jest process. `blockbench-plugin-test` starts
Blockbench, connects Jest to it, and gives you an API that runs code in the
renderer and returns the result.

```ts
import { describe, expect, it } from '@jest/globals'
import { blockbench, gui, newProject } from 'blockbench-plugin-test'

describe('my plugin', () => {
	it('adds a "Greeting Cube" action to the Filter menu', async () => {
		await expect(blockbench).toHaveAction('hello_world_greet')
		await expect(blockbench).toHaveMenuItem('filter', 'Add Greeting Cube')
	})

	it('actually adds the cube when triggered', async () => {
		await newProject('free')
		await gui.action('hello_world_greet').trigger()

		const cubes = await blockbench.evaluate(() => Cube.all.map(c => c.name))
		expect(cubes).toContain('Greeting')
	})
})
```

## Contents

- [Requirements](#requirements)
- [Install](#install)
- [Setup](#setup)
- [Configuration](#configuration)
- [API](#api)
- [Matchers](#matchers)
- [How it works](#how-it-works)
- [Troubleshooting](#troubleshooting)
- [Example](#example)
- [Developing this framework](#developing-this-framework)

## Requirements

|                   |                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| **Node**          | 20 or newer                                                                                            |
| **Jest**          | 29 or 30                                                                                               |
| **Headless runs** | Linux with `xvfb-run` on `PATH`. Elsewhere (or with `headless: false`) Blockbench opens a real window. |

[envbench](https://github.com/SnaveSutit/envbench) is bundled as a dependency —
it provisions the isolated Blockbench install and its per-environment `userData`
folder. The first test run downloads Blockbench (~120 MB) through it; later runs
reuse it.

## Install

```bash
npm i -D blockbench-plugin-test jest
```

## Setup

### 1. Point Jest at the preset

```js
// jest.config.mjs
export default {
	preset: 'blockbench-plugin-test',
}
```

The preset wires up the test environment, `globalSetup`/`globalTeardown`, the
custom matchers, a longer `testTimeout`, and `maxWorkers: 1` (every test shares
one Blockbench instance, so they must run serially).

Already have a config you can't replace? Spread it:

```js
import preset from 'blockbench-plugin-test/jest-preset.js'

export default {
	...preset,
	// your options - keep maxWorkers at 1
}
```

### 2. Add `blockbench.config.mjs`

Next to your Jest config:

```js
import { defineConfig } from 'blockbench-plugin-test'

export default defineConfig({
	// Pin a version for reproducible CI. "latest" and "beta" also work.
	blockbenchVersion: '5.1.6',

	// A dedicated, isolated envbench environment (created automatically).
	environment: 'my-plugin-tests',

	// Plugin files to load before the suite starts. The file name must match the
	// id you pass to Plugin.register() - e.g. my_plugin.js -> Plugin.register('my_plugin').
	plugins: ['./dist/my_plugin.js'],
})
```

`.ts`, `.js`, `.cjs` and `.json` configs work too. Point at a non-standard
location with `BLOCKBENCH_CONFIG=path/to/config`.

### 3. Write tests

Import the Jest globals from `@jest/globals` — that also registers the custom
matcher types for TypeScript:

```ts
import { describe, expect, it } from '@jest/globals'
import { blockbench, gui, loadPlugin, newProject } from 'blockbench-plugin-test'
```

Run `jest` as usual.

## Configuration

| Option              | Default                    | Description                                                                                 |
| ------------------- | -------------------------- | ------------------------------------------------------------------------------------------- |
| `blockbenchVersion` | `"latest"`                 | Blockbench version envbench provisions. `"latest"`, `"beta"`, or `"x.y.z"`.                 |
| `environment`       | `"blockbench-plugin-test"` | envbench environment name.                                                                  |
| `plugins`           | `[]`                       | Plugin `.js` files to preload, resolved relative to the config file.                        |
| `headless`          | `true`                     | Run through `xvfb-run` with no window (Linux).                                              |
| `launchTimeout`     | `60000`                    | Milliseconds to wait for Blockbench to boot.                                                |
| `debugPort`         | `0`                        | Fixed CDP port; `0` picks a free one.                                                       |
| `launchArgs`        | `[]`                       | Extra CLI arguments for the Blockbench executable.                                          |
| `readyExpression`   | _(boot check)_             | JS expression evaluated in the renderer to decide when Blockbench is ready.                 |
| `connect`           | –                          | `ws://…` or `http://…` DevTools endpoint of an already-running Blockbench. Skips launching. |
| `keepAlive`         | `false`                    | Leave Blockbench running after the suite (debugging).                                       |
| `isolateTests`      | `true`                     | After each test, unload plugins that the test loaded and close the active project.          |
| `verbose`           | `false`                    | Print Blockbench's stdout/stderr.                                                           |

## API

Every helper is available as a named import **and** on the `blockbench` object,
which is also a global inside every test file.

### Plugins

```ts
const plugin = await loadPlugin('./dist/my_plugin.js') // load at runtime
await plugin.reload() // re-run from disk
await plugin.unload()
await plugin.isLoaded() // boolean
await plugin.meta() // { id, title, author, version, ... } | null

await reloadPlugins() // Plugins.devReload()
await loadedPlugins() // string[]
blockbench.plugin('my_plugin') // handle for an already-loaded plugin
```

### Projects

```ts
await newProject('free', { name: 'Test' }) // a format id; no "New Project" dialog
await closeProject() // discards unsaved changes
await activeProject() // { name, format, uuid, mode, elements } | null
```

### GUI

```ts
gui.action('my_action')
//   .trigger()        fire it, like clicking the button
//   .exists()  .isEnabled()  .name()

gui.menu('filter')
//   .has('My Action')        boolean
//   .items()                 flat list of every item label
//   .item('My Action')       -> a handle:
//       .exists()  .isVisible()  .path()   // path of labels from the menu root

gui.dialog() // the currently open dialog
//   .isOpen()  .id()  .title()  .values()
//   .setValues({ greeting: 'Howdy' })
//   .confirm()   .cancel()

gui.panel('textures')
//   .exists()  .isVisible()
```

### Low-level access

```ts
// Run anything in the renderer. Args and return value must be JSON-serialisable.
await blockbench.evaluate(name => new Cube({ name }).init().name, 'Box')

await blockbench.click('#panel_textures .tool') // raw DOM click
await blockbench.waitForSelector('#some_element')
await blockbench.waitFor('Project.elements.length > 0')
await blockbench.screenshot('debug.png')
blockbench.page // the underlying puppeteer Page

await blockbench.setSetting('preview_bloom', true)
await blockbench.getSetting('preview_bloom')
await blockbench.version() // "5.1.6"
```

## Matchers

All matchers are **async** — always `await` them.

```ts
await expect(blockbench).toHaveLoadedPlugin('my_plugin')
await expect(blockbench).toHaveAction('my_action')
await expect(blockbench).toHaveMenuItem('filter', 'My Action')

await expect(gui.action('my_action')).toExist()
await expect(gui.action('my_action')).toBeEnabled()
await expect(gui.menu('filter').item('My Action')).toBeVisible()
await expect(gui.dialog()).toBeOpen()

// negate as usual
await expect(gui.action('gone')).not.toExist()
```

## How it works

```
 Jest globalSetup ─┐
                   ├─ envbench (library)  → isolated Blockbench + userData
                   ├─ launch Blockbench  --remote-debugging-port  (under xvfb-run)
                   └─ preload your plugins over the DevTools bridge
        │
 each test file ── connect puppeteer-core to the renderer
                   expose `blockbench` / named exports
                   (calls run inside Blockbench, results come back as JSON)
        │
 Jest globalTeardown ── shut Blockbench down
```

Your real Blockbench install and settings are never touched. envbench keeps a
separate `userData` folder per environment.

## Troubleshooting

| Symptom                                                  | Fix                                                                                                                                                                                     |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Could not determine which Blockbench version to launch` | The first run needs network access to resolve `"latest"`/`"beta"` and download Blockbench. Pin an exact `blockbenchVersion` for offline CI with a warm `~/.envbench` cache.             |
| `Timed out … waiting for Blockbench to start`            | Headless Linux needs `xvfb-run` on `PATH`. In containers you may also need `--no-sandbox` (already passed) and a writable `/tmp`. Bump `launchTimeout` for the first (downloading) run. |
| `Failed to load plugin … is the file named "<id>.js"?`   | Blockbench derives the plugin id from the **file name**. `my_plugin.js` must call `Plugin.register('my_plugin')`.                                                                       |
| Tests interfere with each other                          | Keep `maxWorkers: 1` (the preset sets it). `isolateTests` cleans up between tests; disable it only if you manage state yourself.                                                        |
| Matcher is "not a function" / no types                   | Import Jest globals from `@jest/globals`, and make sure the run goes through the preset (not a bare `jest` with no config).                                                             |
| Want to watch it run                                     | `headless: false` (opens a real window) and/or `keepAlive: true`.                                                                                                                       |

## Example

[`examples/hello-plugin/`](./examples/hello-plugin) is a complete, runnable
example — a small plugin (`hello_world.js`), its `blockbench.config.mjs`, its
`jest.config.mjs`, and a full test suite. Copy it as a starting point.

## Developing this framework

```bash
bun install
bun run typecheck    # src + tests + example
bun test             # everything: unit tests + the example suite
SKIP_E2E=1 bun test  # just the fast unit tests
bun run test:e2e     # just the example suite (build + Jest)
```

- `test/` — fast unit tests for config loading, envbench/version resolution, the
  launcher and teardown, the GUI-handle logic, the renderer-side functions and
  the matchers.
- `test/e2e.test.ts` — runs the Jest example suite as a subprocess (the
  framework is a Jest addon, so its end-to-end suite runs under Jest). You can
  also run it directly with `jest` at the repo root.

## License

MIT
