import type {
  KnowledgeImportDocumentResult,
  KnowledgeImportSource,
  KnowledgeImportStatus
} from '../../shared/contracts'

interface KnowledgeImportCounts {
  importedDocuments: number
  skippedDocuments: number
  failedDocuments: number
  importedChunks: number
}

export const MAX_STATUS_ERRORS = 50
export const MAX_RECENT_DOCUMENT_RESULTS = 20

export function createIdleKnowledgeImportStatus(): KnowledgeImportStatus {
  return {
    state: 'idle',
    importedDocuments: 0,
    skippedDocuments: 0,
    failedDocuments: 0,
    importedChunks: 0,
    errorCount: 0,
    errors: [],
    recentDocuments: [],
    message: 'No Markdown knowledge has been imported this session.'
  }
}

export function createActiveKnowledgeImportStatus(input: {
  state: KnowledgeImportStatus['state']
  startedAt: string
  importId: string
  source: KnowledgeImportSource
  message: string
  selectedFolderCount?: number
  discoveredDocuments?: number
  totalDocuments?: number
}): KnowledgeImportStatus {
  return {
    state: input.state,
    startedAt: input.startedAt,
    importId: input.importId,
    source: input.source,
    cancellable: input.state === 'scanning' || input.state === 'importing',
    selectedFolderCount: input.selectedFolderCount,
    discoveredDocuments: input.discoveredDocuments,
    totalDocuments: input.totalDocuments,
    processedDocuments: 0,
    importedDocuments: 0,
    skippedDocuments: 0,
    failedDocuments: 0,
    importedChunks: 0,
    errorCount: 0,
    errors: [],
    recentDocuments: [],
    message: input.message
  }
}

export function cloneKnowledgeImportStatus(status: KnowledgeImportStatus): KnowledgeImportStatus {
  return {
    ...status,
    errors: [...status.errors],
    recentDocuments: status.recentDocuments?.map(cloneDocumentResult)
  }
}

export function cloneDocumentResult(result: KnowledgeImportDocumentResult): KnowledgeImportDocumentResult {
  return { ...result }
}

export function buildStatusFromResults(options: {
  startedAt: string
  importId: string
  source: KnowledgeImportSource
  state: KnowledgeImportStatus['state']
  results: readonly KnowledgeImportDocumentResult[]
  message: string
}): KnowledgeImportStatus {
  const counts = countDocumentResults(options.results)
  const errors = collectFailedErrors(options.results)
  return {
    state: options.state,
    startedAt: options.startedAt,
    importId: options.importId,
    source: options.source,
    cancellable: options.state === 'importing' || options.state === 'scanning',
    processedDocuments: options.results.length,
    totalDocuments: options.results.length,
    ...counts,
    errorCount: errors.length,
    errors: errors.slice(-MAX_STATUS_ERRORS),
    recentDocuments: options.results.slice(-MAX_RECENT_DOCUMENT_RESULTS).map(cloneDocumentResult),
    message: options.message
  }
}

export function buildFinalStatusFromResults(options: {
  startedAt: string
  importId: string
  source: KnowledgeImportSource
  results: readonly KnowledgeImportDocumentResult[]
}): KnowledgeImportStatus {
  const importingStatus = buildStatusFromResults({
    ...options,
    state: 'importing',
    message: 'Importing Markdown knowledge…'
  })
  const state = determineFinalState(importingStatus)

  return {
    ...importingStatus,
    state,
    cancellable: false,
    finishedAt: new Date().toISOString(),
    message: createFinalStatusMessage(state, importingStatus)
  }
}

export function countDocumentResults(results: readonly KnowledgeImportDocumentResult[]): KnowledgeImportCounts {
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

export function collectFailedErrors(
  results: readonly KnowledgeImportDocumentResult[]
): string[] {
  return results.flatMap((result) =>
    result.error && result.status === 'failed'
      ? [`${result.relativePath ?? result.name}: ${result.error}`]
      : []
  )
}

export function isKnowledgeImportActive(status: KnowledgeImportStatus): boolean {
  return status.state === 'scanning' ||
    status.state === 'importing' ||
    status.state === 'cancel_requested'
}

export function determineFinalState(status: Pick<
  KnowledgeImportStatus,
  'importedChunks' | 'failedDocuments' | 'skippedDocuments'
>): KnowledgeImportStatus['state'] {
  if (status.importedChunks > 0 && status.failedDocuments === 0) {
    return 'succeeded'
  }

  if (status.importedChunks > 0 && status.failedDocuments > 0) {
    return 'partial_failed'
  }

  if (status.failedDocuments > 0) {
    return 'failed'
  }

  if (status.skippedDocuments > 0) {
    return 'succeeded'
  }

  return 'failed'
}

export function createFinalStatusMessage(
  state: KnowledgeImportStatus['state'],
  counts: Pick<
    KnowledgeImportStatus,
    'importedDocuments' | 'skippedDocuments' | 'failedDocuments' | 'importedChunks'
  >
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
    case 'cancelled':
      return 'Knowledge import cancelled.'
    case 'idle':
      return 'No Markdown knowledge has been imported this session.'
    case 'scanning':
      return 'Scanning selected folders for Markdown files…'
    case 'importing':
      return 'Importing Markdown knowledge…'
    case 'cancel_requested':
      return 'Cancelling knowledge import…'
  }
}

export function appendBounded<T>(items: readonly T[], item: T, maxItems: number): T[] {
  return [...items, item].slice(-maxItems)
}

