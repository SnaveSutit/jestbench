// Running `jest` at the repo root runs the end-to-end example suite (the unit
// tests under `test/` use `bun test` - see `bunfig.toml`).
/** @type {import('jest').Config} */
export default {
	projects: ['<rootDir>/examples/hello-plugin'],
}
