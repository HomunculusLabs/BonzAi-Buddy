import type { Memory, UUID } from '@elizaos/core/node'
import type {
  AssistantActionType,
  AssistantMessage,
  ImportKnowledgeDocumentsRequest,
  KnowledgeImportDocumentResult,
  KnowledgeImportResult,
  KnowledgeImportStatus
} from '../../shared/contracts'
import { normalizeError } from '../../shared/value-utils'
import { normalizeText } from '../assistant-action-param-utils'
import type { RuntimeBundle } from './runtime-lifecycle'
import {
  prepareKnowledgeImportRequest,
  type KnowledgeImportChunk,
  type PreparedKnowledgeDocument
} from './runtime-knowledge-import'

interface RuntimeMemoryServiceOptions {
  getRuntime: () => Promise<RuntimeBundle>
  canSkipHistoryRuntimeHydration?: () => boolean
}

const KNOWLEDGE_IMPORT_SOURCE = 'bonzi-settings-knowledge-import'

export class BonziRuntimeMemoryService {
  private readonly getRuntime: () => Promise<RuntimeBundle>
  private readonly canSkipHistoryRuntimeHydration: () => boolean
  private knowledgeImportStatus: KnowledgeImportStatus = createIdleKnowledgeImportStatus()
  private knowledgeImportInFlight: Promise<KnowledgeImportResult> | null = null

  constructor(options: RuntimeMemoryServiceOptions) {
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

  getKnowledgeImportStatus(): KnowledgeImportStatus {
    return cloneKnowledgeImportStatus(this.knowledgeImportStatus)
  }

  async importKnowledgeDocuments(
    request: ImportKnowledgeDocumentsRequest
  ): Promise<KnowledgeImportResult> {
    if (this.knowledgeImportInFlight) {
      return {
        ok: false,
        status: this.getKnowledgeImportStatus(),
        documents: [],
        error: 'A knowledge import is already running.'
      }
    }

    this.knowledgeImportInFlight = this.runKnowledgeImport(request)

    try {
      return await this.knowledgeImportInFlight
    } finally {
      this.knowledgeImportInFlight = null
    }
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

  private async runKnowledgeImport(
    request: ImportKnowledgeDocumentsRequest
  ): Promise<KnowledgeImportResult> {
    const startedAt = new Date().toISOString()
    const importId = crypto.randomUUID()
    this.knowledgeImportStatus = {
      state: 'importing',
      startedAt,
      importedDocuments: 0,
      skippedDocuments: 0,
      failedDocuments: 0,
      importedChunks: 0,
      errors: [],
      message: 'Importing Markdown knowledge…'
    }

    let prepared: ReturnType<typeof prepareKnowledgeImportRequest>

    try {
      prepared = prepareKnowledgeImportRequest(request)
    } catch (error) {
      const message = normalizeError(error)
      const status = this.finishKnowledgeImportStatus({
        startedAt,
        state: 'failed',
        importedDocuments: 0,
        skippedDocuments: 0,
        failedDocuments: 1,
        importedChunks: 0,
        errors: [message],
        message: `Knowledge import failed: ${message}`
      })

      return {
        ok: false,
        status,
        documents: [],
        error: message
      }
    }

    const results: KnowledgeImportDocumentResult[] = [
      ...prepared.rejectedDocuments
    ]

    if (prepared.documents.length === 0) {
      const finalStatus = buildFinalStatus(startedAt, results)
      this.knowledgeImportStatus = finalStatus

      return {
        ok: finalStatus.state === 'succeeded',
        status: cloneKnowledgeImportStatus(finalStatus),
        documents: results.map((result) => ({ ...result })),
        ...(finalStatus.state === 'failed' ? { error: finalStatus.message } : {})
      }
    }

    try {
      const bundle = await this.getRuntime()

      for (const document of prepared.documents) {
        const result = await this.importPreparedKnowledgeDocument({
          bundle,
          importId,
          document,
          importedAt: startedAt
        })
        results.push(result)
        this.knowledgeImportStatus = buildImportingStatus(startedAt, results)
      }
    } catch (error) {
      const message = normalizeError(error)
      results.push({
        name: 'Runtime',
        status: 'failed',
        bytes: 0,
        chunksImported: 0,
        error: message
      })
    }

    const finalStatus = buildFinalStatus(startedAt, results)
    this.knowledgeImportStatus = finalStatus

    return {
      ok: finalStatus.state === 'succeeded' || finalStatus.state === 'partial_failed',
      status: cloneKnowledgeImportStatus(finalStatus),
      documents: results.map((result) => ({ ...result })),
      ...(finalStatus.state === 'failed' ? { error: finalStatus.message } : {})
    }
  }

  private async importPreparedKnowledgeDocument(options: {
    bundle: RuntimeBundle
    importId: string
    document: PreparedKnowledgeDocument
    importedAt: string
  }): Promise<KnowledgeImportDocumentResult> {
    const { bundle, importId, document, importedAt } = options
    let chunksImported = 0
    let chunksSkipped = 0

    try {
      for (const chunk of document.chunks) {
        const imported = await this.importKnowledgeChunk({
          bundle,
          importId,
          document,
          chunk,
          importedAt
        })

        if (imported) {
          chunksImported += 1
        } else {
          chunksSkipped += 1
        }
      }
    } catch (error) {
      return {
        name: document.name,
        status: 'failed',
        bytes: document.bytes,
        chunksImported,
        error: normalizeError(error)
      }
    }

    if (chunksImported === 0 && chunksSkipped > 0) {
      return {
        name: document.name,
        status: 'skipped',
        bytes: document.bytes,
        chunksImported: 0,
        error: 'All chunks were already imported.'
      }
    }

    return {
      name: document.name,
      status: 'imported',
      bytes: document.bytes,
      chunksImported
    }
  }

  private async importKnowledgeChunk(options: {
    bundle: RuntimeBundle
    importId: string
    document: PreparedKnowledgeDocument
    chunk: KnowledgeImportChunk
    importedAt: string
  }): Promise<boolean> {
    const { bundle, importId, document, chunk, importedAt } = options
    const { ChannelType, stringToUuid } = await import('@elizaos/core/node')
    const memoryId = stringToUuid(
      `bonzi-knowledge:${chunk.documentHash}:${chunk.chunkIndex}`
    ) as UUID
    const existing = await bundle.runtime.getMemoryById(memoryId)

    if (existing) {
      return false
    }

    const documentId = stringToUuid(
      `bonzi-knowledge-document:${document.documentHash}`
    ) as UUID
    const memory: Memory = {
      id: memoryId,
      agentId: bundle.runtime.agentId,
      entityId: bundle.runtime.agentId,
      roomId: bundle.roomId,
      worldId: bundle.worldId,
      content: {
        text: chunk.text,
        source: KNOWLEDGE_IMPORT_SOURCE,
        channelType: ChannelType.DM,
        metadata: {
          importId,
          documentName: chunk.documentName,
          documentHash: chunk.documentHash,
          chunkIndex: chunk.chunkIndex,
          chunkCount: chunk.chunkCount,
          importedAt,
          lastModified: document.lastModified
        }
      },
      metadata: {
        type: 'fragment',
        source: KNOWLEDGE_IMPORT_SOURCE,
        scope: 'shared',
        timestamp: Date.parse(importedAt),
        documentId,
        position: chunk.chunkIndex
      }
    }
    const embeddedMemory = await bundle.runtime.addEmbeddingToMemory(memory)
    await bundle.runtime.createMemory(embeddedMemory, 'knowledge', true)
    return true
  }

  private finishKnowledgeImportStatus(
    status: KnowledgeImportStatus
  ): KnowledgeImportStatus {
    this.knowledgeImportStatus = {
      ...status,
      errors: [...status.errors],
      finishedAt: new Date().toISOString()
    }
    return this.getKnowledgeImportStatus()
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

function createIdleKnowledgeImportStatus(): KnowledgeImportStatus {
  return {
    state: 'idle',
    importedDocuments: 0,
    skippedDocuments: 0,
    failedDocuments: 0,
    importedChunks: 0,
    errors: [],
    message: 'No Markdown knowledge has been imported this session.'
  }
}

function cloneKnowledgeImportStatus(status: KnowledgeImportStatus): KnowledgeImportStatus {
  return {
    ...status,
    errors: [...status.errors]
  }
}

function buildImportingStatus(
  startedAt: string,
  results: readonly KnowledgeImportDocumentResult[]
): KnowledgeImportStatus {
  const counts = countDocumentResults(results)
  return {
    state: 'importing',
    startedAt,
    ...counts,
    errors: results.flatMap((result) => result.error ? [`${result.name}: ${result.error}`] : []),
    message: `Importing Markdown knowledge… ${counts.importedChunks} chunks imported.`
  }
}

function buildFinalStatus(
  startedAt: string,
  results: readonly KnowledgeImportDocumentResult[]
): KnowledgeImportStatus {
  const counts = countDocumentResults(results)
  const errors = results.flatMap((result) =>
    result.error && result.status === 'failed' ? [`${result.name}: ${result.error}`] : []
  )
  const state = determineFinalState(counts)

  return {
    state,
    startedAt,
    finishedAt: new Date().toISOString(),
    ...counts,
    errors,
    message: createFinalStatusMessage(state, counts)
  }
}

function countDocumentResults(results: readonly KnowledgeImportDocumentResult[]): {
  importedDocuments: number
  skippedDocuments: number
  failedDocuments: number
  importedChunks: number
} {
  return results.reduce(
    (counts, result) => {
      if (result.status === 'imported') {
        counts.importedDocuments += 1
      } else if (result.status === 'skipped') {
        counts.skippedDocuments += 1
      } else {
        counts.failedDocuments += 1
      }

      counts.importedChunks += result.chunksImported
      return counts
    },
    {
      importedDocuments: 0,
      skippedDocuments: 0,
      failedDocuments: 0,
      importedChunks: 0
    }
  )
}

function determineFinalState(counts: {
  importedChunks: number
  failedDocuments: number
  skippedDocuments: number
}): KnowledgeImportStatus['state'] {
  if (counts.importedChunks > 0 && counts.failedDocuments === 0) {
    return 'succeeded'
  }

  if (counts.importedChunks > 0 && counts.failedDocuments > 0) {
    return 'partial_failed'
  }

  if (counts.failedDocuments > 0) {
    return 'failed'
  }

  if (counts.skippedDocuments > 0) {
    return 'succeeded'
  }

  return 'failed'
}

function createFinalStatusMessage(
  state: KnowledgeImportStatus['state'],
  counts: {
    importedDocuments: number
    skippedDocuments: number
    failedDocuments: number
    importedChunks: number
  }
): string {
  switch (state) {
    case 'succeeded':
      if (counts.importedChunks === 0) {
        return 'Knowledge import completed with no new chunks to import.'
      }
      return `Knowledge import complete: ${counts.importedChunks} chunks from ${counts.importedDocuments} documents imported.`
    case 'partial_failed':
      return `Knowledge import partially completed: ${counts.importedChunks} chunks imported, ${counts.failedDocuments} documents failed.`
    case 'failed':
      return 'Knowledge import failed. No chunks were imported.'
    case 'idle':
      return 'No Markdown knowledge has been imported this session.'
    case 'importing':
      return 'Importing Markdown knowledge…'
  }
}
