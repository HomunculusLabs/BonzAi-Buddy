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
  | 'scanning'
  | 'importing'
  | 'succeeded'
  | 'partial_failed'
  | 'failed'
  | 'cancel_requested'
  | 'cancelled'

export type KnowledgeImportSource = 'document-payload' | 'folder'

export interface KnowledgeImportFolderSelection {
  path: string
  name: string
}

export interface SelectKnowledgeImportFoldersResult {
  ok: boolean
  cancelled: boolean
  folders: KnowledgeImportFolderSelection[]
  selectionId?: string
  message?: string
  error?: string
}

export interface ImportKnowledgeFoldersRequest {
  folderSelectionId?: string
  folderPaths?: string[]
}

export interface CancelKnowledgeImportRequest {
  importId?: string
}

export interface KnowledgeImportDocumentResult {
  name: string
  status: 'imported' | 'skipped' | 'failed'
  bytes: number
  chunksImported: number
  error?: string
  relativePath?: string
  sourceRootName?: string
}

export interface KnowledgeImportStatus {
  state: KnowledgeImportRunState
  startedAt?: string
  finishedAt?: string
  importId?: string
  source?: KnowledgeImportSource
  cancellable?: boolean
  selectedFolderCount?: number
  discoveredDocuments?: number
  totalDocuments?: number
  processedDocuments?: number
  currentDocumentName?: string
  currentDocumentRelativePath?: string
  importedDocuments: number
  skippedDocuments: number
  failedDocuments: number
  importedChunks: number
  /** Total chunks currently persisted in elizaOS knowledge memory for this room. */
  knowledgeMemoryCount?: number
  /** True when status was rebuilt from persisted knowledge memory after in-memory import state was lost. */
  recovered?: boolean
  errorCount?: number
  errors: string[]
  recentDocuments?: KnowledgeImportDocumentResult[]
  message: string
}

export interface KnowledgeImportResult {
  ok: boolean
  status: KnowledgeImportStatus
  documents: KnowledgeImportDocumentResult[]
  error?: string
}

export interface StartKnowledgeImportResult {
  ok: boolean
  importId?: string
  status: KnowledgeImportStatus
  message: string
  error?: string
}

export interface CancelKnowledgeImportResult {
  ok: boolean
  status: KnowledgeImportStatus
  message: string
  error?: string
}
