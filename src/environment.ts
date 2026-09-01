import type { EnvironmentContext, JestEnvironmentConfig } from '@jest/environment'
import { TestEnvironment as NodeEnvironment } from 'jest-environment-node'

import { BlockbenchAPI } from './api'
import { Bridge } from './bridge'
import { readState } from './state'

/**
 * Jest test environment that connects each test file to the shared Blockbench
 * instance started by `globalSetup`, and exposes it as `globalThis.blockbench`
 * (and to the package's named exports).
 */
class BlockbenchEnvironment extends NodeEnvironment {
	private bridge?: Bridge
	private api?: BlockbenchAPI
	private isolate = true

	constructor(config: JestEnvironmentConfig, context: EnvironmentContext) {
		super(config, context)
	}

	override async setup(): Promise<void> {
		await super.setup()

		const state = readState()
		this.isolate = state.config.isolateTests
		this.bridge = await Bridge.connect(state.wsEndpoint, state.config)
		this.api = new BlockbenchAPI(this.bridge)

		const g = this.global as unknown as Record<string, unknown>
		g.blockbench = this.api
		g.__BLOCKBENCH_API__ = this.api
	}

	async handleTestEvent(event: { name: string }): Promise<void> {
		if (event.name === 'test_done' && this.isolate && this.api) {
			await this.api.resetForNextTest().catch(() => {})
		}
	}

	override async teardown(): Promise<void> {
		await this.bridge?.dispose()
		this.bridge = undefined
		this.api = undefined
		await super.teardown()
	}
}

export default BlockbenchEnvironment
export { BlockbenchEnvironment }
