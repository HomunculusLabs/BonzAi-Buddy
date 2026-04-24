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
  type Plugin,
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
    const bundle = await this.getOrCreateRuntime()

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

    let parsedTurn: BonziRuntimeTurn = {
      reply: '',
      actions: [],
      warnings: []
    }

    const result = await bundle.runtime.messageService.handleMessage(
      bundle.runtime,
      messageMemory,
      async (content: Content) => {
        parsedTurn = parseBonziAssistantEnvelope(
          typeof content.text === 'string' ? content.text : ''
        )

        if (!parsedTurn.reply) {
          return []
        }

        return [
          createMessageMemory({
            id: crypto.randomUUID() as UUID,
            entityId: bundle.runtime.agentId,
            roomId: bundle.roomId,
            content: {
              ...content,
              text: parsedTurn.reply,
              source: 'bonzi-electron-main',
              channelType: ChannelType.DM
            }
          })
        ]
      }
    )

    if (!parsedTurn.reply && typeof result.responseContent?.text === 'string') {
      parsedTurn = parseBonziAssistantEnvelope(result.responseContent.text)
    }

    if (parsedTurn.emote) {
      this.emit({
        type: 'play-emote',
        emoteId: parsedTurn.emote
      })
    }

    return parsedTurn
  }

  async dispose(): Promise<void> {
    this.listeners.clear()

    if (this.bundle) {
      await this.bundle.runtime.stop()
    }

    this.bundle = null
    this.initializing = null
    this.configSignature = null
  }

  private async getOrCreateRuntime(): Promise<RuntimeBundle> {
    const config = this.syncConfigState()
    const signature = JSON.stringify({
      effectiveProvider: config.effectiveProvider,
      systemPromptOverride: config.systemPromptOverride ?? ''
    })

    this.providerInfo = config.provider
    this.startupWarnings = [...config.startupWarnings]

    if (this.bundle && this.configSignature === signature) {
      this.applySettings(this.bundle.runtime, config)
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
          actionPlanning: false,
          llmMode: LLMMode.SMALL
        })

        this.applySettings(runtime, config)
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

  private async buildPlugins(
    config: BonziElizaResolvedConfig
  ): Promise<Plugin[]> {
    const plugins: Plugin[] = [
      localdbPlugin,
      createBonziContextPlugin({
        getShellState: this.getShellState
      })
    ]

    if (config.effectiveProvider === 'openai-compatible') {
      const openaiPlugin = (await import('@elizaos/plugin-openai')).default
      return [...plugins, openaiPlugin]
    }

    return [...plugins, elizaClassicPlugin]
  }

  private applySettings(
    runtime: AgentRuntime,
    config: BonziElizaResolvedConfig
  ): void {
    runtime.setSetting('LLM_MODE', 'DEFAULT')
    runtime.setSetting('CHECK_SHOULD_RESPOND', false)
    runtime.setSetting('LOCALDB_DATA_DIR', this.dataDir)

    if (config.effectiveProvider === 'openai-compatible' && config.openai) {
      runtime.setSetting('OPENAI_API_KEY', config.openai.apiKey, true)
      runtime.setSetting('OPENAI_BASE_URL', config.openai.baseUrl)
      runtime.setSetting('OPENAI_SMALL_MODEL', config.openai.model)
      runtime.setSetting('OPENAI_LARGE_MODEL', config.openai.model)
    }
  }

  private memoryToAssistantMessage(
    memory: Memory,
    bundle: RuntimeBundle
  ): AssistantMessage | null {
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

function parseBonziAssistantEnvelope(content: string): BonziRuntimeTurn {
  const cleaned = stripCodeFence(content)

  try {
    const parsed = JSON.parse(cleaned) as {
      reply?: unknown
      actions?: unknown
      emote?: unknown
    }

    return {
      reply:
        typeof parsed.reply === 'string' && parsed.reply.trim()
          ? parsed.reply.trim()
          : 'The runtime returned JSON without a usable reply.',
      actions: Array.isArray(parsed.actions)
        ? sanitizeProposedActions(parsed.actions)
        : [],
      warnings: [],
      emote: isAssistantEventEmoteId(parsed.emote) ? parsed.emote : undefined
    }
  } catch {
    return {
      reply: content.trim() || 'The runtime returned an empty response.',
      actions: [],
      emote: undefined,
      warnings: [
        'Runtime returned non-JSON text, so assistant actions were disabled for this turn.'
      ]
    }
  }
}

function sanitizeProposedActions(actions: unknown[]): BonziProposedAction[] {
  const seen = new Set<AssistantActionType>()

  return actions.flatMap((action) => {
    if (!isRecord(action)) {
      return []
    }

    const type = action.type

    if (!isAssistantActionType(type) || seen.has(type)) {
      return []
    }

    seen.add(type)

    return [
      {
        type,
        title: typeof action.title === 'string' ? action.title : undefined,
        description:
          typeof action.description === 'string'
            ? action.description
            : undefined,
        requiresConfirmation:
          typeof action.requiresConfirmation === 'boolean'
            ? action.requiresConfirmation
            : undefined
      }
    ]
  })
}

function isAssistantActionType(value: unknown): value is AssistantActionType {
  return (
    typeof value === 'string' &&
    (ASSISTANT_ACTION_TYPES as readonly string[]).includes(value)
  )
}

function isAssistantEventEmoteId(value: unknown): value is AssistantEventEmoteId {
  return value === 'wave' || value === 'happy-bounce'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function stripCodeFence(content: string): string {
  const trimmed = content.trim()

  if (!trimmed.startsWith('```')) {
    return trimmed
  }

  return trimmed.replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, '')
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
