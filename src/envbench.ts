import { existsSync } from 'node:fs'
import { join } from 'node:path'

import {
	Envbench,
	getPortablePath,
	type DownloadProgress,
	type NamedBlockbenchVersion,
	type ResolvedBlockbenchVersion,
} from 'envbench'

/**
 * Integration with the `envbench` library (https://github.com/SnaveSutit/envbench).
 *
 * envbench owns provisioning an isolated Blockbench install: which version to
 * download, and a dedicated `userData` folder per environment. We drive it
 * through its programmatic API, then locate the portable binary so the launcher
 * can start it with the CDP instrumentation flags envbench does not add itself.
 */

/** Treats an unset or blank environment variable as absent (matches the envbench CLI). */
function envPath(value: string | undefined): string | undefined {
	return value && value.trim() !== '' ? value : undefined
}

/**
 * An {@link Envbench} instance pointed at the default storage folder
 * (`~/.envbench`), honouring the same `ENVBENCH_STORAGE_FOLDER` /
 * `BLOCKBENCH_PORTABLES_CACHE` overrides as the CLI.
 */
export function createEnvbench(): Envbench {
	return new Envbench({
		storageDir: envPath(process.env.ENVBENCH_STORAGE_FOLDER),
		portablesCache: envPath(process.env.BLOCKBENCH_PORTABLES_CACHE),
	})
}

/** Absolute path to an environment's folder, which doubles as its `userData` dir. */
export function environmentDir(eb: Envbench, name: string): string {
	return join(eb.storageDir, name)
}

/** Numeric (not lexical) semver ordering, so `5.1.9` sorts before `5.1.10`. */
export function compareSemver(a: string, b: string): number {
	const pa = a.split('.').map(Number)
	const pb = b.split('.').map(Number)
	for (let i = 0; i < 3; i++) {
		if (pa[i] !== pb[i]) return (pa[i] ?? 0) - (pb[i] ?? 0)
	}
	return 0
}

/** Progress reporting for the (~120 MB) first-run download, so it doesn't look hung. */
function downloadHooks() {
	let lastShown = -1
	return {
		onDownloadStart: (version: string) =>
			process.stderr.write(`[blockbench-plugin-test] downloading Blockbench ${version}\n`),
		onProgress: ({ percent }: DownloadProgress) => {
			const pct = Math.floor(percent * 10) * 10
			if (pct > lastShown) {
				lastShown = pct
				process.stderr.write(`[blockbench-plugin-test]   ${pct}%\n`)
			}
		},
	}
}

/** Create the environment if it is missing. Downloads Blockbench on first use. */
export async function ensureEnvironment(
	eb: Envbench,
	name: string,
	blockbenchVersion: string,
): Promise<void> {
	if ((await eb.environmentExists(name)) === 'env') return
	await eb.createEnvironment(
		name,
		{ blockbenchVersion: blockbenchVersion as NamedBlockbenchVersion, force: true },
		downloadHooks(),
	)
}

/**
 * Locate the Blockbench executable envbench downloaded for this environment.
 * Falls back to the newest cached portable when the version cannot be resolved
 * (e.g. `blockbenchVersion: "latest"` on an offline CI runner with a warm cache).
 */
export async function resolvePortablePath(eb: Envbench, name: string): Promise<string> {
	const env = await eb.getEnvironment(name)

	let version: ResolvedBlockbenchVersion | undefined
	try {
		version = await eb.resolveVersion(env.blockbench_version)
	} catch {
		version = (await eb.listInstalledVersions()).sort(compareSemver).at(-1)
	}
	if (!version) {
		throw new Error(
			`Could not determine which Blockbench version to launch for "${name}". ` +
				'Check your network connection or pin `blockbenchVersion` in the config.',
		)
	}

	const portable = getPortablePath(eb.portablesCache, version)
	if (!existsSync(portable)) {
		throw new Error(
			`Blockbench ${version} portable not found at ${portable}. ` +
				`Recreate the "${name}" environment to download it.`,
		)
	}
	return portable
}
