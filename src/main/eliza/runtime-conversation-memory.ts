import type { Memory, UUID } from '@elizaos/core/node'
import type {
  AssistantActionType,
  AssistantMessage
} from '../../shared/contracts'
import { normalizeText } from '../assistant-action-param-utils'
import type { RuntimeBundle } from './runtime-lifecycle'

interface BonziConversationMemoryServiceOptions {
  getRuntime: () => Promise<RuntimeBundle>
  canSkipHistoryRuntimeHydration?: () => boolean
}

export class BonziConversationMemoryService {
  private readonly getRuntime: () => Promise<RuntimeBundle>
  private readonly canSkipHistoryRuntimeHydration: () => boolean

  constructor(options: BonziConversationMemoryServiceOptions) {
    this.getRuntime = options.getRuntime
    this.canSkipHistoryRuntimeHydration =
      options.canSkipHistoryRuntimeHydration ?? (() => false)
  }

  async getHistory(): Promise<AssistantMessage[]> {
    if (this.canSkipHistoryRuntimeHydration()) {
      return []
    }

    const bundle = await this.getRuntime()
    const memories = await bundle.runtime.getMemories({
      roomId: bundle.roomId,
      tableName: 'messages',
      count: 100
    })

    return memories
      .map((memory) => memoryToAssistantMessage(memory, bundle))
      .filter((message): message is AssistantMessage => message !== null)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  async resetConversation(): Promise<void> {
    const bundle = await this.getRuntime()
    await bundle.runtime.deleteAllMemories(bundle.roomId, 'messages')
  }

  async recordActionObservation(
    action: {
      type: AssistantActionType
      title: string
      status: string
      params?: unknown
    },
    resultMessage: string
  ): Promise<void> {
    const text = normalizeText(resultMessage)

    if (!text) {
      return
    }

    const bundle = await this.getRuntime()
    const { ChannelType, createMessageMemory } = await import('@elizaos/core/node')
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
}

function memoryToAssistantMessage(
  memory: Memory,
  bundle: RuntimeBundle
): AssistantMessage | null {
  if (
    memory.content.source === 'action' ||
    memory.content.source === 'bonzi-action-observation-continuation'
  ) {
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
