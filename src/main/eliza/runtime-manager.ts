import { app } from 'electron'
import { join } from 'node:path'
import {
  AgentRuntime,
  ChannelType,
  createMessageMemory,
  LLMMode,
  stringToUuid,
  type Content,
  type Memory,
  type UUID
} from '@elizaos/core/node'
import {
  ASSISTANT_ACTION_TYPES,
  type AssistantActionType,
  type AssistantEvent,
  type AssistantEventEmoteId,
  type AssistantMessage,
  type AssistantProviderInfo,
  type AssistantRuntimeStatus,
  type ElizaPluginSettings,
  type ShellState,
  type UpdateElizaPluginSettingsRequest
} from '../../shared/contracts'
import {
  normalizeText
} from '../assistant-action-param-utils'
import { createBonziDesktopActionProposal } from './bonzi-desktop-actions-plugin'
import {
  loadBonziElizaConfig,
  type BonziElizaResolvedConfig
} from './config'
import { BonziExternalEmbeddingsService } from './external-embeddings-service'
import {
  applyRuntimeSettings,
  buildRuntimePlugins,
  createRuntimeCharacter,
  createRuntimeConfigSignature
} from './runtime-bootstrap'
import {
  dedupeProposedActions,
  extractBonziActionsFromActionResults,
  extractBonziActionsFromContent,
  extractFailedBonziActionTypes,
  filterFailedProposedActions,
  type BonziProposedAction
} from './runtime-action-proposals'
import { BonziPluginSettingsStore } from './plugin-settings'

export type { BonziProposedAction } from './runtime-action-proposals'

const BONZI_WORLD_ID = stringToUuid('bonzi-world')
const BONZI_USER_ID = stringToUuid('bonzi-user')
const BONZI_ROOM_ID = stringToUuid('bonzi-room')

interface RuntimeBundle {
  runtime: AgentRuntime
  userId: UUID
  roomId: UUID
  worldId: UUID
}

interface BonziRuntimeManagerOptions {
  getShellState: () => ShellState
  dataDir?: string
}

export interface BonziRuntimeTurn {
  reply: string
  actions: BonziProposedAction[]
  warnings: string[]
  emote?: AssistantEventEmoteId
}

export class BonziRuntimeManager {
  private bundle: RuntimeBundle | null = null
  private initializing: Promise<RuntimeBundle> | null = null
  private configSignature: string | null = null
  private providerInfo: AssistantProviderInfo = {
    kind: 'eliza-classic',
    label: 'Eliza Classic'
  }
  private startupWarnings: string[] = []
  private runtimeStatus: AssistantRuntimeStatus = {
    backend: 'eliza',
    state: 'starting',
    persistence: 'localdb'
  }
  private readonly listeners = new Set<(event: AssistantEvent) => void>()
  private readonly dataDir: string
  private readonly getShellState: () => ShellState
  private readonly embeddingsService = new BonziExternalEmbeddingsService()
  private readonly pluginSettingsStore = new BonziPluginSettingsStore()

  constructor(options: BonziRuntimeManagerOptions) {
    this.getShellState = options.getShellState
    this.dataDir = options.dataDir ?? join(app.getPath('userData'), 'eliza-localdb')
    this.syncConfigState()
  }

  getProviderInfo(): AssistantProviderInfo {
    this.syncConfigState()
    return { ...this.providerInfo }
  }

  getStartupWarnings(): string[] {
    this.syncConfigState()
    return [...this.startupWarnings]
  }

  getRuntimeStatus(): AssistantRuntimeStatus {
    return { ...this.runtimeStatus }
  }

  getPluginSettings(): ElizaPluginSettings {
    return this.pluginSettingsStore.getSettings(this.getProviderInfo())
  }

  getAvailableActionTypes(): AssistantActionType[] {
    const settings = this.pluginSettingsStore.getRuntimeSettings()
    return settings.desktopActionsEnabled ? [...ASSISTANT_ACTION_TYPES] : []
  }

  async updatePluginSettings(
    request: UpdateElizaPluginSettingsRequest
  ): Promise<ElizaPluginSettings> {
    const settings = this.pluginSettingsStore.updateSettings(
      request,
      this.getProviderInfo()
    )

    if (this.initializing) {
      await this.initializing.catch(() => null)
    }

    this.configSignature = null

    return settings
  }

  subscribe(listener: (event: AssistantEvent) => void): () => void {
    this.listeners.add(listener)

    return (): void => {
      this.listeners.delete(listener)
    }
  }

  async getHistory(): Promise<AssistantMessage[]> {
    const bundle = await this.getOrCreateRuntime()
    const memories = await bundle.runtime.getMemories({
      roomId: bundle.roomId,
      tableName: 'messages',
      count: 100
    })

    return memories
      .map((memory) => this.memoryToAssistantMessage(memory, bundle))
      .filter((message): message is AssistantMessage => message !== null)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  async resetConversation(): Promise<void> {
    const bundle = await this.getOrCreateRuntime()
    await bundle.runtime.deleteAllMemories(bundle.roomId, 'messages')
  }

  async recordActionObservation(action: {
    type: AssistantActionType
    title: string
    status: string
    params?: unknown
  }, resultMessage: string): Promise<void> {
    const text = normalizeText(resultMessage)

    if (!text) {
      return
    }

    const bundle = await this.getOrCreateRuntime()
    const paramsText = action.params
      ? `\nParams: ${JSON.stringify(action.params)}`
      : ''

    await bundle.runtime.createMemory(
      createMessageMemory({
        id: crypto.randomUUID() as UUID,
        entityId: bundle.runtime.agentId,
        roomId: bundle.roomId,
        content: {
          text: `[Bonzi action observation: ${action.type} / ${action.status}]\n${action.title}${paramsText}\n\n${text}`,
          source: 'bonzi-action-observation',
          channelType: ChannelType.DM
        }
      }),
      'messages'
    )
  }

  async sendCommand(command: string): Promise<BonziRuntimeTurn> {
    const config = this.syncConfigState()
    const bundle = await this.getOrCreateRuntime()

    if (config.e2eMode) {
      return this.buildE2eTurn(command)
    }

    if (!bundle.runtime.messageService) {
      throw new Error('Runtime message service not available.')
    }

    const messageMemory = createMessageMemory({
      id: crypto.randomUUID() as UUID,
      entityId: bundle.userId,
      roomId: bundle.roomId,
      content: {
        text: command,
        source: 'bonzi-electron-renderer',
        channelType: ChannelType.DM
      }
    })

    const callbackTexts: string[] = []
    const callbackActions: BonziProposedAction[] = []

    const result = await bundle.runtime.messageService.handleMessage(
      bundle.runtime,
      messageMemory,
      async (content: Content) => {
        const text = normalizeText(content.text)

        if (text) {
          callbackTexts.push(text)
        }

        callbackActions.push(...extractBonziActionsFromContent(content))
        return []
      }
    )

    const responseContent = result.responseContent ?? undefined
    const actionResults = bundle.runtime.getActionResults(messageMemory.id as UUID)
    const responseText = normalizeText(responseContent?.text)
    const failedActionTypes = extractFailedBonziActionTypes(actionResults)
    const actions = dedupeProposedActions([
      ...extractBonziActionsFromActionResults(actionResults),
      ...filterFailedProposedActions(callbackActions, failedActionTypes),
      ...filterFailedProposedActions(
        extractBonziActionsFromContent(responseContent),
        failedActionTypes
      )
    ])
    const reply =
      responseText ||
      callbackTexts.at(-1) ||
      (actions.length > 0
        ? 'I prepared that Bonzi action for you.'
        : 'The runtime returned an empty response.')

    if (!responseText) {
      await bundle.runtime.createMemory(
        createMessageMemory({
          id: crypto.randomUUID() as UUID,
          entityId: bundle.runtime.agentId,
          roomId: bundle.roomId,
          content: {
            text: reply,
            source: 'bonzi-electron-main',
            channelType: ChannelType.DM
          }
        }),
        'messages'
      )
    }

    return {
      reply,
      actions,
      warnings: []
    }
  }

  async dispose(): Promise<void> {
    this.listeners.clear()

    if (this.bundle) {
      await this.bundle.runtime.stop()
    }

    await this.embeddingsService.stop()

    this.bundle = null
    this.initializing = null
    this.configSignature = null
  }

  private async getOrCreateRuntime(): Promise<RuntimeBundle> {
    const config = this.syncConfigState()
    const runtimeSettings = this.pluginSettingsStore.getRuntimeSettings()
    const signature = createRuntimeConfigSignature({ config, runtimeSettings })

    this.providerInfo = config.provider
    this.startupWarnings = [...config.startupWarnings]

    if (this.bundle && this.configSignature === signature) {
      this.addStartupWarnings(
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
        const runtime = new AgentRuntime({
          character: createRuntimeCharacter({ config, runtimeSettings }),
          plugins: await buildRuntimePlugins({
            config,
            runtimeSettings,
            getShellState: this.getShellState
          }),
          actionPlanning: true,
          llmMode: LLMMode.SMALL
        })

        this.addStartupWarnings(
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

  private syncConfigState(): BonziElizaResolvedConfig {
    const config = loadBonziElizaConfig()
    this.providerInfo = config.provider
    this.startupWarnings = [...config.startupWarnings]
    return config
  }

  private buildE2eTurn(command: string): BonziRuntimeTurn {
    return {
      reply: `E2E assistant reply for: ${command}`,
      actions: command.toLowerCase().includes('shell')
        ? [createBonziDesktopActionProposal('report-shell-state')]
        : [],
      warnings: []
    }
  }

  private memoryToAssistantMessage(
    memory: Memory,
    bundle: RuntimeBundle
  ): AssistantMessage | null {
    if (memory.content.source === 'action') {
      return null
    }

    const content = typeof memory.content.text === 'string' ? memory.content.text.trim() : ''

    if (!content) {
      return null
    }

    const createdAt = normalizeTimestamp(memory.createdAt)

    return {
      id: String(memory.id),
      role: memory.entityId === bundle.userId ? 'user' : 'assistant',
      content,
      createdAt
    }
  }

  private addStartupWarnings(warnings: string[]): void {
    const additions = warnings.filter(
      (warning) => !this.startupWarnings.includes(warning)
    )

    if (additions.length > 0) {
      this.startupWarnings = [...this.startupWarnings, ...additions]
    }
  }

  private updateRuntimeStatus(status: AssistantRuntimeStatus): void {
    this.runtimeStatus = status
    this.emit({
      type: 'runtime-status',
      status
    })
  }

  private emit(event: AssistantEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString()
  }

  if (typeof value === 'string' && value.trim()) {
    const asNumber = Number(value)
    if (Number.isFinite(asNumber)) {
      return new Date(asNumber).toISOString()
    }

    const asDate = new Date(value)
    if (!Number.isNaN(asDate.getTime())) {
      return asDate.toISOString()
    }
  }

  return new Date().toISOString()
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
