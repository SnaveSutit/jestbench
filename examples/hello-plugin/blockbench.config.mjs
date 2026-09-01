// @ts-check
// Real projects can `import { defineConfig } from '@snavesutit/jestbench'` for
// autocomplete; a plain object works just as well.

/** @type {import('@snavesutit/jestbench').JestbenchConfig} */
export default {
	// Pin a version so the suite is reproducible. Omit for "latest".
	blockbenchVersion: '5.1.6',
	// A dedicated, isolated envbench environment for this suite.
	environment: 'jestbench-example',
	// Installed into the environment before Blockbench starts.
	plugins: ['./hello_world.js'],
	headless: true,
}
