import type {
  KnowledgeImportDocumentResult,
  KnowledgeImportFolderSelection,
  KnowledgeImportStatus
} from '../shared/contracts/knowledge'
import { renderKnowledgeSettings } from './knowledge-settings-view'

const TERMINAL_IMPORT_STATES = new Set<KnowledgeImportStatus['state']>([
  'succeeded',
  'partial_failed',
  'failed',
  'cancelled'
])

export interface KnowledgeSettingsState {
  getStatus(): KnowledgeImportStatus | null
  setStatus(status: KnowledgeImportStatus | null): void
  getDocumentResults(): KnowledgeImportDocumentResult[]
  setDocumentResults(results: KnowledgeImportDocumentResult[]): void
  getSelectedFiles(): File[]
  setSelectedFiles(files: File[]): void
  getSelectedFolders(): KnowledgeImportFolderSelection[]
  setSelectedFolders(folders: KnowledgeImportFolderSelection[]): void
  getSelectedFolderSelectionId(): string | null
  setSelectedFolderSelectionId(selectionId: string | null): void
  isImporting(): boolean
  setImporting(importing: boolean): void
  isHydrated(): boolean
  setHydrated(hydrated: boolean): void
  getLastImportId(): string | null
  setLastImportId(importId: string | null): void
  syncLastImportIdFromStatus(status: KnowledgeImportStatus): void
  render(): void
}

export function createKnowledgeSettingsState(options: {
  knowledgeSettingsEl: HTMLElement
}): KnowledgeSettingsState {
  const { knowledgeSettingsEl } = options

  let status: KnowledgeImportStatus | null = null
  let documentResults: KnowledgeImportDocumentResult[] = []
  let selectedFiles: File[] = []
  let selectedFolders: KnowledgeImportFolderSelection[] = []
  let selectedFolderSelectionId: string | null = null
  let isImporting = false
  let isHydrated = false
  let lastImportId: string | null = null

  return {
    getStatus: () => status,
    setStatus: (nextStatus) => {
      status = nextStatus
      if (nextStatus) {
        lastImportId = nextStatus.importId ?? lastImportId
      }
    },
    getDocumentResults: () => documentResults,
    setDocumentResults: (results) => {
      documentResults = results
    },
    getSelectedFiles: () => selectedFiles,
    setSelectedFiles: (files) => {
      selectedFiles = files
    },
    getSelectedFolders: () => selectedFolders,
    setSelectedFolders: (folders) => {
      selectedFolders = folders
    },
    getSelectedFolderSelectionId: () => selectedFolderSelectionId,
    setSelectedFolderSelectionId: (selectionId) => {
      selectedFolderSelectionId = selectionId
    },
    isImporting: () => isImporting,
    setImporting: (importing) => {
      isImporting = importing
    },
    isHydrated: () => isHydrated,
    setHydrated: (hydrated) => {
      isHydrated = hydrated
    },
    getLastImportId: () => lastImportId,
    setLastImportId: (importId) => {
      lastImportId = importId
    },
    syncLastImportIdFromStatus: (nextStatus) => {
      lastImportId = nextStatus.importId ?? lastImportId
    },
    render: () => {
      renderKnowledgeSettings(knowledgeSettingsEl, {
        status,
        documentResults,
        selectedFiles,
        selectedFolders,
        isImporting,
        isHydrated,
        bridgeAvailable: Boolean(window.bonzi)
      })
    }
  }
}

export function isActiveImport(status: KnowledgeImportStatus): boolean {
  return !TERMINAL_IMPORT_STATES.has(status.state) && status.state !== 'idle'
}
