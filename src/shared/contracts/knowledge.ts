export interface KnowledgeImportDocument {
  name: string
  content: string
  lastModified?: number
}

export interface ImportKnowledgeDocumentsRequest {
  documents: KnowledgeImportDocument[]
}

export type KnowledgeImportRunState =
  | 'idle'
  | 'importing'
  | 'succeeded'
  | 'partial_failed'
  | 'failed'

export interface KnowledgeImportDocumentResult {
  name: string
  status: 'imported' | 'skipped' | 'failed'
  bytes: number
  chunksImported: number
  error?: string
}

export interface KnowledgeImportStatus {
  state: KnowledgeImportRunState
  startedAt?: string
  finishedAt?: string
  importedDocuments: number
  skippedDocuments: number
  failedDocuments: number
  importedChunks: number
  errors: string[]
  message: string
}

export interface KnowledgeImportResult {
  ok: boolean
  status: KnowledgeImportStatus
  documents: KnowledgeImportDocumentResult[]
  error?: string
}
