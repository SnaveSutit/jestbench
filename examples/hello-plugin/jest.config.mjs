// The same config a Blockbench plugin project would write. It works from inside
// this repo because the package self-resolves via its `exports`.

/** @type {import('jest').Config} */
export default {
	preset: '@snavesutit/jestbench',
	rootDir: '.',
	// Your project's TypeScript transform: ts-jest, babel-jest, @swc/jest, etc.
	transform: {
		'^.+\\.ts$': ['@swc/jest', { jsc: { target: 'es2022' } }],
	},
}
