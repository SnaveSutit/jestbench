import globals from 'globals'
import tsESLint, { type ConfigWithExtends } from 'typescript-eslint'

const IGNORE_PATTERNS = [
	'.DS_Store',
	'.env',
	'.env.*',
	'.github',
	'.vscode',
	'**/node_modules/**',

	// Build output
	'dist/**/*',
	'**/dist/**/*',

	// Lockfiles
	'bun.lock',
	'pnpm-lock.yaml',
	'package-lock.json',
	'yarn.lock',
]

const CUSTOM_RULES: ConfigWithExtends['rules'] = {
	// ESLint
	semi: ['error', 'never'],
	'prefer-const': 'warn',
	'no-fallthrough': 'off',
	'no-mixed-spaces-and-tabs': 'off',
	'no-unreachable': 'warn',
	'@typescript-eslint/no-unused-vars': [
		'warn',
		{
			vars: 'local',
			args: 'after-used',
			argsIgnorePattern: '^_',
			ignoreRestSiblings: true,
		},
	],
	// TypeScript
	'@typescript-eslint/no-explicit-any': 'off',
	'@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
	'@typescript-eslint/array-type': ['warn', { default: 'array-simple' }],
	'@typescript-eslint/consistent-indexed-object-style': ['warn', 'record'],
	'@typescript-eslint/consistent-generic-constructors': 'warn',
	'@typescript-eslint/no-namespace': 'off',
	'@typescript-eslint/restrict-template-expressions': 'off',
	'@typescript-eslint/no-unsafe-member-access': 'off',
	'@typescript-eslint/no-unsafe-assignment': 'off',
	'@typescript-eslint/ban-ts-comment': 'off',
	'@typescript-eslint/no-unsafe-call': 'off',
	'@typescript-eslint/unbound-method': 'off',
	'@typescript-eslint/no-non-null-assertion': 'off',
	'@typescript-eslint/triple-slash-reference': 'off',
	// Async lifecycle methods (dispose/kill/evaluate on the test doubles and the
	// Bridge) are intentionally `async` for signature symmetry even when a given
	// implementation has nothing to await.
	'@typescript-eslint/require-await': 'off',
	// Empty catch blocks and no-op lifecycle stubs (`kill: async () => {}`,
	// `.catch(() => {})`) are a deliberate pattern here.
	'@typescript-eslint/no-empty-function': 'off',
	// Dropped from the animated-java config: `@typescript-eslint/naming-convention`.
	// This package deliberately mirrors Blockbench's own global names (`MenuBar`,
	// `BarItems`, `Project`, `Formats`, ...) as locals and uses `__bb`-prefixed
	// internal handles, which a naming-convention rule can't express cleanly.
}

export default tsESLint.config(
	{
		ignores: IGNORE_PATTERNS,
	},
	...tsESLint.configs.stylisticTypeChecked,
	{
		languageOptions: {
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.ts'],
				},
				tsconfigRootDir: import.meta.dirname,
			},
			globals: {
				...globals.node,
			},
		},
		linterOptions: {
			reportUnusedDisableDirectives: true,
		},
		rules: CUSTOM_RULES,
	},
	{
		// Plain JS config files are not part of any tsconfig - lint them without type info.
		files: ['**/*.{js,mjs,cjs}'],
		extends: [tsESLint.configs.disableTypeChecked],
	},
)
