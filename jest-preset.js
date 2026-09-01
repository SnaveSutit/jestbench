'use strict'

// Jest resolves the paths below relative to the *consuming* project, so they
// are resolved to absolute paths here, against this package.
const r = p => require.resolve(p)

/** @type {import('jest').Config} */
module.exports = {
	testEnvironment: r('./dist/environment.js'),
	globalSetup: r('./dist/globalSetup.js'),
	globalTeardown: r('./dist/globalTeardown.js'),
	setupFilesAfterEnv: [r('./dist/setup.js')],

	// One shared Blockbench instance backs the whole run - tests must not race.
	maxWorkers: 1,
	// Driving a real application over CDP is slower than a unit test.
	testTimeout: 30_000,
	// globalTeardown shuts Blockbench down deterministically; without this Jest
	// can hang ~1s waiting on the (already-closed) DevTools socket to be GC'd.
	forceExit: true,
}
