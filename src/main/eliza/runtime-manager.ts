import { createHash } from 'node:crypto'
import { app } from 'electron'
import { join } from 'node:path'
import {
  AgentRuntime,
  ChannelType,
  createMessageMemory,
  LLMMode,
  stringToUuid,
  type ActionResult,
  type Content,
  type Memory,
  type Plugin,
  type ProviderDataRecord,
  type UUID
} from '@elizaos/core/node'
import { elizaClassicPlugin } from '@elizaos/plugin-eliza-classic'
import localdbPlugin from '@elizaos/plugin-localdb'
import {
  ASSISTANT_ACTION_TYPES,
  type AssistantActionType,
  type AssistantEvent,
  type AssistantEventEmoteId,
  type AssistantMessage,
  type AssistantProviderInfo,
  type AssistantRuntimeStatus,
  type ShellState
} from '../../shared/contracts'
import { createBonziCharacter } from './bonzi-character'
import {
  loadBonziElizaConfig,
  type BonziElizaResolvedConfig
} from './config'
import { createBonziContextPlugin } from './bonzi-context-plugin'
import {
  bonziActionTypeFromElizaActionName,
  createBonziDesktopActionProposal,
  createBonziDesktopActionsPlugin
} from './bonzi-desktop-actions-plugin'
import {
  DEFAULT_ELIZA_EMBEDDING_DIMENSION,
  type ElizaCompatibleEmbeddingDimension
} from './embedding-dimensions'
import {
  BonziExternalEmbeddingsService,
  type ResolvedEmbeddingRuntimeSettings
} from './external-embeddings-service'

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

export interface BonziProposedAction {
  type: AssistantActionType
  title?: string
  description?: string
  requiresConfirmation?: boolean
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
    const actions = dedupeProposedActions([
      ...extractBonziActionsFromActionResults(actionResults),
      ...callbackActions,
      ...extractBonziActionsFromContent(responseContent)
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
    const signature = this.createConfigSignature(config)

    this.providerInfo = config.provider
    this.startupWarnings = [...config.startupWarnings]

    if (this.bundle && this.configSignature === signature) {
      await this.applySettings(this.bundle.runtime, config)
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
          character: createBonziCharacter({
            systemPromptOverride: config.systemPromptOverride
          }),
          plugins: await this.buildPlugins(config),
          actionPlanning: true,
          llmMode: LLMMode.SMALL
        })

        await this.applySettings(runtime, config)
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

  private async buildPlugins(
    config: BonziElizaResolvedConfig
  ): Promise<Plugin[]> {
    const plugins: Plugin[] = [
      localdbPlugin,
      createBonziContextPlugin({
        getShellState: this.getShellState
      }),
      createBonziDesktopActionsPlugin()
    ]

    if (config.effectiveProvider === 'openai-compatible') {
      const openaiPlugin = (await import('@elizaos/plugin-openai')).default
      return [...plugins, openaiPlugin]
    }

    return [...plugins, elizaClassicPlugin]
  }

  private async applySettings(
    runtime: AgentRuntime,
    config: BonziElizaResolvedConfig
  ): Promise<void> {
    runtime.setSetting('LLM_MODE', 'DEFAULT')
    runtime.setSetting('CHECK_SHOULD_RESPOND', false)
    runtime.setSetting('LOCALDB_DATA_DIR', this.dataDir)

    if (config.effectiveProvider === 'openai-compatible' && config.openai) {
      runtime.setSetting('OPENAI_API_KEY', config.openai.apiKey, true)
      runtime.setSetting('OPENAI_BASE_URL', config.openai.baseUrl)
      runtime.setSetting('OPENAI_SMALL_MODEL', config.openai.model)
      runtime.setSetting('OPENAI_LARGE_MODEL', config.openai.model)

      const embeddingRuntimeSettings =
        await this.resolveEmbeddingRuntimeSettings(config)

      if (embeddingRuntimeSettings?.model) {
        runtime.setSetting(
          'OPENAI_EMBEDDING_MODEL',
          embeddingRuntimeSettings.model
        )
      }

      if (embeddingRuntimeSettings?.baseUrl) {
        runtime.setSetting(
          'OPENAI_EMBEDDING_URL',
          embeddingRuntimeSettings.baseUrl
        )
      }

      if (embeddingRuntimeSettings?.apiKey) {
        runtime.setSetting(
          'OPENAI_EMBEDDING_API_KEY',
          embeddingRuntimeSettings.apiKey,
          true
        )
      }

      if (embeddingRuntimeSettings?.dimensions !== undefined) {
        runtime.setSetting(
          'OPENAI_EMBEDDING_DIMENSIONS',
          String(embeddingRuntimeSettings.dimensions)
        )
      }

      if (
        embeddingRuntimeSettings?.warning &&
        !this.startupWarnings.includes(embeddingRuntimeSettings.warning)
      ) {
        this.startupWarnings = [
          ...this.startupWarnings,
          embeddingRuntimeSettings.warning
        ]
      }
      return
    }

    await this.embeddingsService.stop()
  }

  private async resolveEmbeddingRuntimeSettings(
    config: BonziElizaResolvedConfig
  ): Promise<ResolvedEmbeddingRuntimeSettings | null> {
    if (config.effectiveProvider !== 'openai-compatible' || !config.openai) {
      await this.embeddingsService.stop()
      return null
    }

    const embeddingConfig = config.openai.embedding
    if (!embeddingConfig) {
      await this.embeddingsService.stop()
      return null
    }

    const dimensions =
      embeddingConfig.dimensions ?? DEFAULT_ELIZA_EMBEDDING_DIMENSION

    if (embeddingConfig.mode === 'local-service' && embeddingConfig.service) {
      return this.embeddingsService.start(embeddingConfig.service, dimensions)
    }

    await this.embeddingsService.stop()
    return {
      model: embeddingConfig.model,
      baseUrl: embeddingConfig.baseUrl,
      apiKey: embeddingConfig.apiKey,
      dimensions
    }
  }

  private createConfigSignature(config: BonziElizaResolvedConfig): string {
    return JSON.stringify({
      effectiveProvider: config.effectiveProvider,
      e2eMode: config.e2eMode,
      systemPromptOverride: config.systemPromptOverride ?? '',
      openai: config.openai
        ? {
            baseUrl: config.openai.baseUrl,
            model: config.openai.model,
            apiKeyFingerprint: fingerprintSecret(config.openai.apiKey),
            embedding: config.openai.embedding
              ? {
                  mode: config.openai.embedding.mode,
                  model: config.openai.embedding.model ?? '',
                  baseUrl: config.openai.embedding.baseUrl ?? '',
                  apiKeyFingerprint: fingerprintSecret(
                    config.openai.embedding.apiKey
                  ),
                  dimensions:
                    config.openai.embedding.dimensions ??
                    DEFAULT_ELIZA_EMBEDDING_DIMENSION,
                      service: config.openai.embedding.service
                    ? {
                        upstreamBaseUrl:
                          config.openai.embedding.service.upstreamBaseUrl,
                        upstreamModel:
                          config.openai.embedding.service.upstreamModel,
                        upstreamApiKeyFingerprint: fingerprintSecret(
                          config.openai.embedding.service.upstreamApiKey
                        ),
                        dimensionStrategy:
                          config.openai.embedding.service.dimensionStrategy,
                        port: config.openai.embedding.service.port,
                        timeoutMs: config.openai.embedding.service.timeoutMs
                      }
                    : null
                }
              : null
          }
        : null
    })
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

function extractBonziActionsFromContent(
  content: Content | null | undefined
): BonziProposedAction[] {
  const actions = Array.isArray(content?.actions) ? content.actions : []

  return actions.flatMap((actionName) => {
    const type = bonziActionTypeFromElizaActionName(actionName)
    return type ? [createBonziDesktopActionProposal(type)] : []
  })
}

function extractBonziActionsFromActionResults(
  results: ActionResult[]
): BonziProposedAction[] {
  return results.flatMap((result) => {
    const proposal = extractBonziActionProposalFromData(result.data)

    if (proposal) {
      return [proposal]
    }

    const type = bonziActionTypeFromElizaActionName(result.data?.actionName)
    return type ? [createBonziDesktopActionProposal(type)] : []
  })
}

function extractBonziActionProposalFromData(
  data: ProviderDataRecord | undefined
): BonziProposedAction | null {
  const rawProposal = data?.bonziProposedAction

  if (!isRecord(rawProposal)) {
    return null
  }

  const type = rawProposal.type

  if (!isAssistantActionType(type)) {
    return null
  }

  const defaults = createBonziDesktopActionProposal(type)

  return {
    type,
    title: normalizeText(rawProposal.title) || defaults.title,
    description: normalizeText(rawProposal.description) || defaults.description,
    requiresConfirmation:
      typeof rawProposal.requiresConfirmation === 'boolean'
        ? rawProposal.requiresConfirmation
        : defaults.requiresConfirmation
  }
}

function dedupeProposedActions(
  actions: BonziProposedAction[]
): BonziProposedAction[] {
  const seen = new Set<AssistantActionType>()
  const deduped: BonziProposedAction[] = []

  for (const action of actions) {
    if (seen.has(action.type)) {
      continue
    }

    seen.add(action.type)
    deduped.push(action)
  }

  return deduped
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isAssistantActionType(value: unknown): value is AssistantActionType {
  return (
    typeof value === 'string' &&
    (ASSISTANT_ACTION_TYPES as readonly string[]).includes(value)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
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

function fingerprintSecret(value: string | undefined): string {
  if (!value) {
    return 'none'
  }

  return createHash('sha256').update(value).digest('hex')
}
