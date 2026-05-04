import type { HermesSecondaryRuntimeStatus } from '../../shared/contracts/hermes'
import { normalizeError } from '../../shared/value-utils'
import type { HermesAgentClient } from './hermes-agent-client'
import {
  loadHermesConfig,
  type HermesResolvedConfig
} from './hermes-config'

interface HermesLifecycleOptions {
  client: HermesAgentClient
  onRuntimeStatus?: (status: HermesSecondaryRuntimeStatus) => void
}

export class HermesLifecycle {
  private config: HermesResolvedConfig = loadHermesConfig()
  private initializing: Promise<void> | null = null
  private initialized = false
  private runtimeStatus: HermesSecondaryRuntimeStatus = createStatus('starting')

  constructor(private readonly options: HermesLifecycleOptions) {}

  getConfig(): HermesResolvedConfig {
    this.config = loadHermesConfig()
    return this.config
  }

  getRuntimeStatus(): HermesSecondaryRuntimeStatus {
    return { ...this.runtimeStatus }
  }

  async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return
    }

    if (this.initializing) {
      return this.initializing
    }

    const config = this.getConfig()
    this.updateRuntimeStatus(createStatus('starting', undefined, config))

    this.initializing = (async () => {
      try {
        await this.options.client.initialize(config)
        this.initialized = true
        this.updateRuntimeStatus(createStatus('ready', undefined, config))
      } catch (error) {
        const message = normalizeError(error)
        this.initialized = false
        this.updateRuntimeStatus(createStatus('error', message, config))
        throw new Error(message)
      }
    })()

    try {
      await this.initializing
    } finally {
      this.initializing = null
    }
  }

  async reloadRuntime(): Promise<HermesSecondaryRuntimeStatus> {
    await this.dispose()

    try {
      await this.ensureInitialized()
    } catch {
      // Status was updated by ensureInitialized.
    }

    return this.getRuntimeStatus()
  }

  async dispose(): Promise<void> {
    await this.initializing?.catch(() => undefined)
    await this.options.client.dispose()
    this.initializing = null
    this.initialized = false
  }

  private updateRuntimeStatus(status: HermesSecondaryRuntimeStatus): void {
    this.runtimeStatus = status
    this.options.onRuntimeStatus?.(status)
  }
}

function createStatus(
  state: HermesSecondaryRuntimeStatus['state'],
  lastError?: string,
  config: HermesResolvedConfig = loadHermesConfig()
): HermesSecondaryRuntimeStatus {
  return {
    backend: 'hermes',
    role: 'secondary',
    state,
    invocation: config.gateway.enabled ? 'gateway' : 'cli',
    persistence: 'none',
    ...(lastError ? { lastError } : {})
  }
}
