import {
  AgentRuntime,
  ChannelType,
  LLMMode,
  stringToUuid,
  type UUID
} from '@elizaos/core/node'
import type {
  AssistantRuntimeStatus,
  ShellState
} from '../../shared/contracts'
import { normalizeError } from '../../shared/value-utils'
import { BonziExternalEmbeddingsService } from './external-embeddings-service'
import type { BonziPluginRuntimeResolver } from './plugin-runtime-resolver'
import type { BonziPluginSettingsStore } from './plugin-settings'
import {
  applyRuntimeSettings,
  buildRuntimePlugins,
  createRuntimeCharacter,
  createRuntimeConfigSignature
} from './runtime-bootstrap'
import type { BonziRuntimeConfigState } from './runtime-config-state'

const BONZI_WORLD_ID = stringToUuid('bonzi-world')
const BONZI_USER_ID = stringToUuid('bonzi-user')
const BONZI_ROOM_ID = stringToUuid('bonzi-room')

export interface RuntimeBundle {
  runtime: AgentRuntime
  userId: UUID
  roomId: UUID
  worldId: UUID
}

interface BonziRuntimeLifecycleOptions {
  dataDir: string
  configState: BonziRuntimeConfigState
  pluginSettingsStore: BonziPluginSettingsStore
  pluginRuntimeResolver: BonziPluginRuntimeResolver
  getShellState: () => ShellState
  onRuntimeStatus: (status: AssistantRuntimeStatus) => void
}

export class BonziRuntimeLifecycle {
  private bundle: RuntimeBundle | null = null
  private initializing: Promise<RuntimeBundle> | null = null
  private configSignature: string | null = null
  private runtimeStatus: AssistantRuntimeStatus = {
    backend: 'eliza',
    state: 'starting',
    persistence: 'localdb'
  }
  private readonly embeddingsService = new BonziExternalEmbeddingsService()
  private readonly dataDir: string
  private readonly configState: BonziRuntimeConfigState
  private readonly pluginSettingsStore: BonziPluginSettingsStore
  private readonly pluginRuntimeResolver: BonziPluginRuntimeResolver
  private readonly getShellState: () => ShellState
  private readonly onRuntimeStatus: (status: AssistantRuntimeStatus) => void

  constructor(options: BonziRuntimeLifecycleOptions) {
    this.dataDir = options.dataDir
    this.configState = options.configState
    this.pluginSettingsStore = options.pluginSettingsStore
    this.pluginRuntimeResolver = options.pluginRuntimeResolver
    this.getShellState = options.getShellState
    this.onRuntimeStatus = options.onRuntimeStatus
  }

  getRuntimeStatus(): AssistantRuntimeStatus {
    return { ...this.runtimeStatus }
  }

  async waitForInitialization(): Promise<void> {
    if (this.initializing) {
      await this.initializing.catch(() => null)
    }
  }

  invalidateConfigSignature(): void {
    this.configSignature = null
  }

  async getOrCreateRuntime(): Promise<RuntimeBundle> {
    const config = this.configState.sync()
    const runtimeSettings = this.pluginSettingsStore.getRuntimeSettings()
    const runtimePluginSelection =
      this.pluginRuntimeResolver.getRuntimeSelectionMetadata()
    const signature = createRuntimeConfigSignature({
      config,
      runtimeSettings,
      runtimePluginSelection
    })

    if (this.bundle && this.configSignature === signature) {
      this.configState.addRuntimeStartupWarnings(
        await applyRuntimeSettings({
          runtime: this.bundle.runtime,
          config,
          dataDir: this.dataDir,
          embeddingsService: this.embeddingsService
        })
      )
      return this.bundle
    }

    if (this.initializing) {
      return this.initializing
    }

    this.updateRuntimeStatus({
      backend: 'eliza',
      state: 'starting',
      persistence: 'localdb'
    })

    this.initializing = (async () => {
      if (this.bundle) {
        await this.bundle.runtime.stop()
        this.bundle = null
        this.configSignature = null
      }

      try {
        this.configState.clearRuntimeStartupWarnings(config)
        const runtimePlugins = await buildRuntimePlugins({
          config,
          runtimeSettings,
          getShellState: this.getShellState,
          pluginResolver: this.pluginRuntimeResolver
        })
        this.configState.addRuntimeStartupWarnings(runtimePlugins.warnings)

        const runtime = new AgentRuntime({
          character: createRuntimeCharacter({ config, runtimeSettings }),
          plugins: runtimePlugins.plugins,
          actionPlanning: true,
          llmMode: LLMMode.SMALL
        })

        this.configState.addRuntimeStartupWarnings(
          await applyRuntimeSettings({
            runtime,
            config,
            dataDir: this.dataDir,
            embeddingsService: this.embeddingsService
          })
        )
        await runtime.initialize()

        await runtime.ensureConnection({
          entityId: BONZI_USER_ID,
          roomId: BONZI_ROOM_ID,
          worldId: BONZI_WORLD_ID,
          userName: 'User',
          source: 'bonzi-electron-main',
          channelId: 'chat',
          type: ChannelType.DM
        })

        const bundle: RuntimeBundle = {
          runtime,
          userId: BONZI_USER_ID,
          roomId: BONZI_ROOM_ID,
          worldId: BONZI_WORLD_ID
        }

        this.bundle = bundle
        this.configSignature = signature
        this.updateRuntimeStatus({
          backend: 'eliza',
          state: 'ready',
          persistence: 'localdb'
        })
        return bundle
      } catch (error) {
        await this.embeddingsService.stop()
        const message = normalizeError(error)
        this.updateRuntimeStatus({
          backend: 'eliza',
          state: 'error',
          persistence: 'localdb',
          lastError: message
        })
        throw new Error(message)
      }
    })()

    try {
      return await this.initializing
    } finally {
      this.initializing = null
    }
  }

  async reloadRuntime(): Promise<AssistantRuntimeStatus> {
    await this.waitForInitialization()

    if (this.bundle) {
      await this.bundle.runtime.stop()
      this.bundle = null
    }

    this.configSignature = null

    try {
      await this.getOrCreateRuntime()
    } catch {
      // runtime status already updated by getOrCreateRuntime failure path
    }

    return this.getRuntimeStatus()
  }

  async dispose(): Promise<void> {
    if (this.bundle) {
      await this.bundle.runtime.stop()
    }

    await this.embeddingsService.stop()

    this.bundle = null
    this.initializing = null
    this.configSignature = null
    this.configState.resetRuntimeStartupWarnings()
  }

  private updateRuntimeStatus(status: AssistantRuntimeStatus): void {
    this.runtimeStatus = status
    this.onRuntimeStatus(status)
  }
}
