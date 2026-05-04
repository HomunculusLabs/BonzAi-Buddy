import { constants as fsConstants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { ChannelType, stringToUuid, type Memory, type UUID } from '@elizaos/core/node'
import type {
  CancelKnowledgeImportRequest,
  CancelKnowledgeImportResult,
  ImportKnowledgeDocumentsRequest,
  ImportKnowledgeFoldersRequest,
  KnowledgeImportDocumentResult,
  KnowledgeImportResult,
  KnowledgeImportSource,
  KnowledgeImportStatus,
  StartKnowledgeImportResult
} from '../../shared/contracts'
import { isRecord, normalizeError } from '../../shared/value-utils'
import type { RuntimeBundle } from './runtime-lifecycle'
import {
  MAX_KNOWLEDGE_FOLDER_MARKDOWN_FILES,
  scanKnowledgeImportFolders,
  type KnowledgeFolderDocumentCandidate
} from './runtime-knowledge-folder-scan'
import {
  MAX_SINGLE_KNOWLEDGE_DOCUMENT_BYTES,
  prepareKnowledgeDocument,
  prepareKnowledgeImportRequest,
  type KnowledgeImportChunk,
  type PreparedKnowledgeDocument
} from './runtime-knowledge-import'
import { KnowledgeImportManifestStore } from './runtime-knowledge-import-manifest'
import {
  MAX_RECENT_DOCUMENT_RESULTS,
  MAX_STATUS_ERRORS,
  appendBounded,
  buildFinalStatusFromResults,
  buildStatusFromResults,
  cloneDocumentResult,
  cloneKnowledgeImportStatus,
  countDocumentResults,
  createActiveKnowledgeImportStatus,
  createFinalStatusMessage,
  createIdleKnowledgeImportStatus,
  determineFinalState,
  isKnowledgeImportActive
} from './runtime-knowledge-import-status'

interface BonziKnowledgeImportCoordinatorOptions {
  getRuntime: () => Promise<RuntimeBundle>
  knowledgeImportManifestPath?: string
}

interface KnowledgeImportJob {
  importId: string
  source: KnowledgeImportSource
  abortController: AbortController
  promise: Promise<void>
}

const KNOWLEDGE_IMPORT_SOURCE = 'bonzi-settings-knowledge-import'
const KNOWLEDGE_IMPORT_DOCUMENT_YIELD_INTERVAL = 1
const KNOWLEDGE_IMPORT_CHUNK_YIELD_INTERVAL = 10
const KNOWLEDGE_IMPORT_CHUNK_CONCURRENCY = 2

export class BonziKnowledgeImportCoordinator {
  private readonly getRuntime: () => Promise<RuntimeBundle>
  private readonly knowledgeImportManifestPath?: string
  private knowledgeImportStatus: KnowledgeImportStatus = createIdleKnowledgeImportStatus()
  private knowledgeImportJob: KnowledgeImportJob | null = null

  constructor(options: BonziKnowledgeImportCoordinatorOptions) {
    this.getRuntime = options.getRuntime
    this.knowledgeImportManifestPath = options.knowledgeImportManifestPath
  }

  async getKnowledgeImportStatus(): Promise<KnowledgeImportStatus> {
    const initialStatus = cloneKnowledgeImportStatus(this.knowledgeImportStatus)

    if (isKnowledgeImportActive(initialStatus)) {
      return initialStatus
    }

    const knowledgeMemoryCount = await this.getPersistedKnowledgeMemoryCount()
    const status = cloneKnowledgeImportStatus(this.knowledgeImportStatus)

    if (isKnowledgeImportActive(status) || knowledgeMemoryCount === null) {
      return status
    }

    if (status.state === 'idle' && knowledgeMemoryCount > 0) {
      return {
        ...status,
        importedChunks: knowledgeMemoryCount,
        knowledgeMemoryCount,
        recovered: true,
        message: `Knowledge memory contains ${knowledgeMemoryCount.toLocaleString()} imported chunk${knowledgeMemoryCount === 1 ? '' : 's'}.`
      }
    }

    return {
      ...status,
      knowledgeMemoryCount
    }
  }

  private getKnowledgeImportStatusSnapshot(): KnowledgeImportStatus {
    return cloneKnowledgeImportStatus(this.knowledgeImportStatus)
  }

  async importKnowledgeDocuments(
    request: ImportKnowledgeDocumentsRequest
  ): Promise<KnowledgeImportResult> {
    if (this.knowledgeImportJob) {
      return {
        ok: false,
        status: await this.getKnowledgeImportStatus(),
        documents: [],
        error: 'A knowledge import is already running.'
      }
    }

    const startedAt = new Date().toISOString()
    const importId = crypto.randomUUID()
    const abortController = new AbortController()
    const resultPromise = this.runKnowledgeDocumentImport({
      request,
      importId,
      startedAt,
      signal: abortController.signal
    })
    const jobPromise = resultPromise.then(
      () => undefined,
      () => undefined
    )

    this.knowledgeImportJob = {
      importId,
      source: 'document-payload',
      abortController,
      promise: jobPromise
    }

    try {
      return await resultPromise
    } finally {
      if (this.knowledgeImportJob?.importId === importId) {
        this.knowledgeImportJob = null
      }
    }
  }

  async startKnowledgeFolderImport(
    request: ImportKnowledgeFoldersRequest
  ): Promise<StartKnowledgeImportResult> {
    if (this.knowledgeImportJob) {
      const status = await this.getKnowledgeImportStatus()
      return {
        ok: false,
        status,
        message: 'A knowledge import is already running.',
        error: 'A knowledge import is already running.'
      }
    }

    if (!isRecord(request) || !Array.isArray(request.folderPaths)) {
      const status = this.finishKnowledgeImportStatus({
        ...createActiveKnowledgeImportStatus({
          state: 'failed',
          startedAt: new Date().toISOString(),
          importId: crypto.randomUUID(),
          source: 'folder',
          message: 'Knowledge folder import failed: folder paths are required.'
        }),
        failedDocuments: 1,
        errorCount: 1,
        errors: ['Knowledge folder import request must include folderPaths.']
      })

      return {
        ok: false,
        status,
        message: status.message,
        error: status.errors[0]
      }
    }

    const folderPaths = request.folderPaths

    if (folderPaths.length === 0) {
      const status = this.finishKnowledgeImportStatus({
        ...createActiveKnowledgeImportStatus({
          state: 'failed',
          startedAt: new Date().toISOString(),
          importId: crypto.randomUUID(),
          source: 'folder',
          message: 'Select at least one folder to import.'
        }),
        failedDocuments: 1,
        errorCount: 1,
        errors: ['Select at least one folder to import.']
      })

      return {
        ok: false,
        status,
        message: status.message,
        error: status.errors[0]
      }
    }

    const startedAt = new Date().toISOString()
    const importId = crypto.randomUUID()
    const abortController = new AbortController()

    this.knowledgeImportStatus = createActiveKnowledgeImportStatus({
      state: 'scanning',
      startedAt,
      importId,
      source: 'folder',
      message: 'Scanning selected folders for Markdown files…',
      selectedFolderCount: folderPaths.length
    })

    const promise = this.runKnowledgeFolderImport({
      folderPaths,
      importId,
      startedAt,
      signal: abortController.signal
    }).catch((error) => {
      if (isAbortError(error)) {
        this.finishCancelledKnowledgeImportStatus(startedAt, importId)
        return
      }

      const message = normalizeError(error)
      this.finishKnowledgeImportStatus({
        ...this.knowledgeImportStatus,
        state: this.knowledgeImportStatus.importedChunks > 0 ? 'partial_failed' : 'failed',
        cancellable: false,
        errorCount: (this.knowledgeImportStatus.errorCount ?? 0) + 1,
        errors: appendBounded(this.knowledgeImportStatus.errors, message, MAX_STATUS_ERRORS),
        message: `Knowledge folder import failed: ${message}`
      })
    }).finally(() => {
      if (this.knowledgeImportJob?.importId === importId) {
        this.knowledgeImportJob = null
      }
    })

    this.knowledgeImportJob = {
      importId,
      source: 'folder',
      abortController,
      promise
    }

    return {
      ok: true,
      importId,
      status: this.getKnowledgeImportStatusSnapshot(),
      message: 'Knowledge folder import started.'
    }
  }

  async cancelKnowledgeImport(
    request: CancelKnowledgeImportRequest = {}
  ): Promise<CancelKnowledgeImportResult> {
    const job = this.knowledgeImportJob

    if (!job) {
      const status = await this.getKnowledgeImportStatus()
      return {
        ok: false,
        status,
        message: 'No knowledge import is running.',
        error: 'No knowledge import is running.'
      }
    }

    if (request.importId && request.importId !== job.importId) {
      const status = await this.getKnowledgeImportStatus()
      return {
        ok: false,
        status,
        message: 'Knowledge import id does not match the running import.',
        error: 'Knowledge import id does not match the running import.'
      }
    }

    job.abortController.abort()
    this.knowledgeImportStatus = {
      ...this.knowledgeImportStatus,
      state: 'cancel_requested',
      cancellable: false,
      message: 'Cancelling knowledge import…'
    }

    return {
      ok: true,
      status: this.getKnowledgeImportStatusSnapshot(),
      message: 'Knowledge import cancellation requested.'
    }
  }


  private async runKnowledgeDocumentImport(options: {
    request: ImportKnowledgeDocumentsRequest
    importId: string
    startedAt: string
    signal: AbortSignal
  }): Promise<KnowledgeImportResult> {
    const { request, importId, startedAt, signal } = options
    this.knowledgeImportStatus = createActiveKnowledgeImportStatus({
      state: 'importing',
      startedAt,
      importId,
      source: 'document-payload',
      message: 'Importing Markdown knowledge…'
    })

    let prepared: ReturnType<typeof prepareKnowledgeImportRequest>

    try {
      prepared = prepareKnowledgeImportRequest(request)
    } catch (error) {
      const message = normalizeError(error)
      const status = this.finishKnowledgeImportStatus({
        ...createActiveKnowledgeImportStatus({
          state: 'failed',
          startedAt,
          importId,
          source: 'document-payload',
          message: `Knowledge import failed: ${message}`
        }),
        failedDocuments: 1,
        errorCount: 1,
        errors: [message]
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
    this.knowledgeImportStatus = buildStatusFromResults({
      startedAt,
      importId,
      source: 'document-payload',
      state: 'importing',
      results,
      message: 'Importing Markdown knowledge…'
    })

    if (prepared.documents.length === 0) {
      const finalStatus = buildFinalStatusFromResults({
        startedAt,
        importId,
        source: 'document-payload',
        results
      })
      this.knowledgeImportStatus = finalStatus

      return {
        ok: finalStatus.state === 'succeeded',
        status: cloneKnowledgeImportStatus(finalStatus),
        documents: results.map(cloneDocumentResult),
        ...(finalStatus.state === 'failed' ? { error: finalStatus.message } : {})
      }
    }

    try {
      const bundle = await this.getRuntime()

      for (const document of prepared.documents) {
        throwIfAborted(signal)
        const result = await this.importPreparedKnowledgeDocument({
          bundle,
          importId,
          document,
          importedAt: startedAt,
          signal
        })
        results.push(result)
        this.knowledgeImportStatus = buildStatusFromResults({
          startedAt,
          importId,
          source: 'document-payload',
          state: 'importing',
          results,
          message: `Importing Markdown knowledge… ${countDocumentResults(results).importedChunks} chunks imported.`
        })
      }
    } catch (error) {
      if (isAbortError(error)) {
        const status = this.finishCancelledKnowledgeImportStatus(startedAt, importId)
        return {
          ok: false,
          status,
          documents: results.map(cloneDocumentResult),
          error: status.message
        }
      }

      const message = normalizeError(error)
      results.push({
        name: 'Runtime',
        status: 'failed',
        bytes: 0,
        chunksImported: 0,
        error: message
      })
    }

    const finalStatus = buildFinalStatusFromResults({
      startedAt,
      importId,
      source: 'document-payload',
      results
    })
    this.knowledgeImportStatus = finalStatus

    return {
      ok: finalStatus.state === 'succeeded' || finalStatus.state === 'partial_failed',
      status: cloneKnowledgeImportStatus(finalStatus),
      documents: results.map(cloneDocumentResult),
      ...(finalStatus.state === 'failed' ? { error: finalStatus.message } : {})
    }
  }

  private async runKnowledgeFolderImport(options: {
    folderPaths: string[]
    importId: string
    startedAt: string
    signal: AbortSignal
  }): Promise<void> {
    const { folderPaths, importId, startedAt, signal } = options
    const scan = await scanKnowledgeImportFolders(folderPaths, { signal })
    throwIfAborted(signal)

    if (scan.capped) {
      const message = `Knowledge folder import supports at most ${MAX_KNOWLEDGE_FOLDER_MARKDOWN_FILES.toLocaleString()} Markdown files per run. Select fewer folders or split the import.`
      this.finishKnowledgeImportStatus({
        ...createActiveKnowledgeImportStatus({
          state: 'failed',
          startedAt,
          importId,
          source: 'folder',
          message,
          selectedFolderCount: scan.roots.length,
          discoveredDocuments: scan.markdownFileCount,
          totalDocuments: scan.markdownFileCount
        }),
        failedDocuments: 1,
        errorCount: 1,
        errors: [message]
      })
      return
    }

    const initialErrors = scan.errors.map((error) => `Scan: ${error}`)
    this.knowledgeImportStatus = {
      ...createActiveKnowledgeImportStatus({
        state: 'importing',
        startedAt,
        importId,
        source: 'folder',
        message: `Importing ${scan.documents.length} Markdown files into elizaOS knowledge memory…`,
        selectedFolderCount: scan.roots.length,
        discoveredDocuments: scan.documents.length,
        totalDocuments: scan.documents.length
      }),
      failedDocuments: scan.errorCount,
      errorCount: scan.errorCount,
      errors: initialErrors.slice(-MAX_STATUS_ERRORS)
    }

    if (scan.documents.length === 0) {
      this.finishKnowledgeImportStatus({
        ...this.knowledgeImportStatus,
        state: initialErrors.length > 0 ? 'failed' : 'succeeded',
        cancellable: false,
        message: initialErrors.length > 0
          ? 'Knowledge folder import failed. No Markdown files were imported.'
          : 'Knowledge folder import completed: no Markdown files found.'
      })
      return
    }

    const bundle = await this.getRuntime()
    const manifestStore = this.knowledgeImportManifestPath
      ? await KnowledgeImportManifestStore.create(this.knowledgeImportManifestPath)
      : null

    try {
      for (const [index, candidate] of scan.documents.entries()) {
        throwIfAborted(signal)
        this.knowledgeImportStatus = {
          ...this.knowledgeImportStatus,
          currentDocumentName: candidate.name,
          currentDocumentRelativePath: candidate.relativePath,
          message: `Importing Markdown knowledge… ${index} / ${scan.documents.length} files processed.`
        }

        const result = await this.importFolderCandidate({
          bundle,
          importId,
          candidate,
          manifestStore,
          importedAt: startedAt,
          signal
        })

        this.recordKnowledgeDocumentResult(result)
        this.knowledgeImportStatus = {
          ...this.knowledgeImportStatus,
          processedDocuments: index + 1,
          currentDocumentName: candidate.name,
          currentDocumentRelativePath: candidate.relativePath,
          message: `Importing Markdown knowledge… ${index + 1} / ${scan.documents.length} files processed, ${this.knowledgeImportStatus.importedChunks} chunks imported.`
        }

        if ((index + 1) % KNOWLEDGE_IMPORT_DOCUMENT_YIELD_INTERVAL === 0) {
          await yieldToEventLoop()
        }
      }
    } finally {
      await manifestStore?.flush()
    }

    const finalState = determineFinalState(this.knowledgeImportStatus)
    this.finishKnowledgeImportStatus({
      ...this.knowledgeImportStatus,
      state: finalState,
      cancellable: false,
      currentDocumentName: undefined,
      currentDocumentRelativePath: undefined,
      message: createFinalStatusMessage(finalState, this.knowledgeImportStatus)
    })
  }

  private async importFolderCandidate(options: {
    bundle: RuntimeBundle
    importId: string
    candidate: KnowledgeFolderDocumentCandidate
    manifestStore: KnowledgeImportManifestStore | null
    importedAt: string
    signal: AbortSignal
  }): Promise<KnowledgeImportDocumentResult> {
    const { bundle, importId, candidate, manifestStore, importedAt, signal } = options

    try {
      throwIfAborted(signal)
      if (candidate.bytes > MAX_SINGLE_KNOWLEDGE_DOCUMENT_BYTES) {
        return createFolderCandidateFailure(
          candidate,
          'Markdown file must be 1 MiB or smaller.'
        )
      }

      if (manifestStore?.shouldSkipUnchangedFile(candidate)) {
        return {
          name: candidate.name,
          status: 'skipped',
          bytes: candidate.bytes,
          chunksImported: 0,
          error: 'Already imported; unchanged since last import.',
          relativePath: candidate.relativePath,
          sourceRootName: candidate.rootName
        }
      }

      const currentStat = await lstat(candidate.absolutePath)
      if (currentStat.isSymbolicLink() || !currentStat.isFile()) {
        return createFolderCandidateFailure(
          candidate,
          'Markdown file is no longer a regular file.'
        )
      }

      if (currentStat.size > MAX_SINGLE_KNOWLEDGE_DOCUMENT_BYTES) {
        return createFolderCandidateFailure(
          candidate,
          'Markdown file must be 1 MiB or smaller.'
        )
      }

      const handle = await open(
        candidate.absolutePath,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW
      )
      let content: string
      try {
        content = await handle.readFile('utf8')
      } finally {
        await handle.close()
      }

      throwIfAborted(signal)
      const prepared = prepareKnowledgeDocument({
        name: candidate.name,
        content,
        lastModified: candidate.lastModified,
        relativePath: candidate.relativePath,
        sourceRootName: candidate.rootName,
        identityName: `${candidate.rootName}/${candidate.relativePath}`
      })

      if (!prepared.ok) {
        return prepared.result
      }

      const result = await this.importPreparedKnowledgeDocument({
        bundle,
        importId,
        document: prepared.document,
        importedAt,
        skipDuplicateLookup: true,
        signal
      })

      if (result.status !== 'failed' && manifestStore) {
        try {
          await manifestStore.markImportedFile(candidate, prepared.document, importedAt)
        } catch {
          // Manifest persistence is best-effort for faster resumable imports.
        }
      }

      return result
    } catch (error) {
      if (isAbortError(error)) {
        throw error
      }

      return createFolderCandidateFailure(candidate, normalizeError(error))
    }
  }

  private async importPreparedKnowledgeDocument(options: {
    bundle: RuntimeBundle
    importId: string
    document: PreparedKnowledgeDocument
    importedAt: string
    skipDuplicateLookup?: boolean
    signal?: AbortSignal
  }): Promise<KnowledgeImportDocumentResult> {
    const {
      bundle,
      importId,
      document,
      importedAt,
      skipDuplicateLookup = false,
      signal
    } = options
    let chunksImported = 0
    let chunksSkipped = 0

    try {
      await runWithConcurrency(
        document.chunks,
        KNOWLEDGE_IMPORT_CHUNK_CONCURRENCY,
        async (chunk, index) => {
          throwIfAborted(signal)
          const imported = await this.importKnowledgeChunk({
            bundle,
            importId,
            document,
            chunk,
            importedAt,
            skipDuplicateLookup
          })

          if (imported) {
            chunksImported += 1
          } else {
            chunksSkipped += 1
          }

          if ((index + 1) % KNOWLEDGE_IMPORT_CHUNK_YIELD_INTERVAL === 0) {
            await yieldToEventLoop()
          }
        }
      )
    } catch (error) {
      if (isAbortError(error)) {
        throw error
      }

      return {
        name: document.name,
        status: 'failed',
        bytes: document.bytes,
        chunksImported,
        error: normalizeError(error),
        relativePath: document.relativePath,
        sourceRootName: document.sourceRootName
      }
    }

    if (chunksImported === 0 && chunksSkipped > 0) {
      return {
        name: document.name,
        status: 'skipped',
        bytes: document.bytes,
        chunksImported: 0,
        error: 'All chunks were already imported.',
        relativePath: document.relativePath,
        sourceRootName: document.sourceRootName
      }
    }

    return {
      name: document.name,
      status: 'imported',
      bytes: document.bytes,
      chunksImported,
      relativePath: document.relativePath,
      sourceRootName: document.sourceRootName
    }
  }

  private async importKnowledgeChunk(options: {
    bundle: RuntimeBundle
    importId: string
    document: PreparedKnowledgeDocument
    chunk: KnowledgeImportChunk
    importedAt: string
    skipDuplicateLookup?: boolean
  }): Promise<boolean> {
    const {
      bundle,
      importId,
      document,
      chunk,
      importedAt,
      skipDuplicateLookup = false
    } = options
    const memoryId = stringToUuid(
      `bonzi-knowledge:${chunk.documentHash}:${chunk.chunkIndex}`
    ) as UUID
    const existing = skipDuplicateLookup ? null : await bundle.runtime.getMemoryById(memoryId)

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
          lastModified: document.lastModified,
          relativePath: document.relativePath,
          sourceRootName: document.sourceRootName
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

  private async getPersistedKnowledgeMemoryCount(): Promise<number | null> {
    try {
      const bundle = await this.getRuntime()
      const runtime = bundle.runtime

      if (typeof runtime.countMemories === 'function') {
        return await runtime.countMemories(bundle.roomId, false, 'knowledge')
      }

      return null
    } catch {
      return null
    }
  }

  private recordKnowledgeDocumentResult(result: KnowledgeImportDocumentResult): void {
    const status = this.knowledgeImportStatus
    const counts = countDocumentResults([result])
    const failedError = result.status === 'failed' && result.error
      ? `${result.relativePath ?? result.name}: ${result.error}`
      : null

    this.knowledgeImportStatus = {
      ...status,
      importedDocuments: status.importedDocuments + counts.importedDocuments,
      skippedDocuments: status.skippedDocuments + counts.skippedDocuments,
      failedDocuments: status.failedDocuments + counts.failedDocuments,
      importedChunks: status.importedChunks + counts.importedChunks,
      errorCount: (status.errorCount ?? 0) + (failedError ? 1 : 0),
      errors: failedError
        ? appendBounded(status.errors, failedError, MAX_STATUS_ERRORS)
        : [...status.errors],
      recentDocuments: appendBounded(
        status.recentDocuments ?? [],
        cloneDocumentResult(result),
        MAX_RECENT_DOCUMENT_RESULTS
      )
    }
  }

  private finishKnowledgeImportStatus(
    status: KnowledgeImportStatus
  ): KnowledgeImportStatus {
    this.knowledgeImportStatus = {
      ...status,
      cancellable: false,
      errors: [...status.errors],
      recentDocuments: status.recentDocuments?.map(cloneDocumentResult),
      finishedAt: new Date().toISOString()
    }
    return this.getKnowledgeImportStatusSnapshot()
  }

  private finishCancelledKnowledgeImportStatus(
    startedAt: string,
    importId: string
  ): KnowledgeImportStatus {
    return this.finishKnowledgeImportStatus({
      ...this.knowledgeImportStatus,
      state: 'cancelled',
      startedAt: this.knowledgeImportStatus.startedAt ?? startedAt,
      importId: this.knowledgeImportStatus.importId ?? importId,
      cancellable: false,
      currentDocumentName: undefined,
      currentDocumentRelativePath: undefined,
      message: 'Knowledge import cancelled.'
    })
  }
}

function createFolderCandidateFailure(
  candidate: KnowledgeFolderDocumentCandidate,
  error: string
): KnowledgeImportDocumentResult {
  return {
    name: candidate.name,
    status: 'failed',
    bytes: candidate.bytes,
    chunksImported: 0,
    error,
    relativePath: candidate.relativePath,
    sourceRootName: candidate.rootName
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException('Knowledge import was cancelled.', 'AbortError')
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  const workerCount = Math.max(1, Math.min(concurrency, items.length))
  let nextIndex = 0

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex
        nextIndex += 1
        await worker(items[index], index)
      }
    })
  )
}
