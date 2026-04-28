import type {
  CancelKnowledgeImportRequest,
  CancelKnowledgeImportResult,
  ImportKnowledgeDocumentsRequest,
  ImportKnowledgeFoldersRequest,
  KnowledgeImportResult,
  KnowledgeImportStatus,
  SelectKnowledgeImportFoldersResult,
  StartKnowledgeImportResult
} from '../shared/contracts/knowledge'

export interface KnowledgeSettingsDataClient {
  isAvailable(): boolean
  getStatus(): Promise<KnowledgeImportStatus>
  selectFolders(): Promise<SelectKnowledgeImportFoldersResult>
  importFolders(
    request: ImportKnowledgeFoldersRequest
  ): Promise<StartKnowledgeImportResult>
  cancelImport(
    request: CancelKnowledgeImportRequest
  ): Promise<CancelKnowledgeImportResult>
  importDocuments(
    request: ImportKnowledgeDocumentsRequest
  ): Promise<KnowledgeImportResult>
}

export function createKnowledgeSettingsDataClient(): KnowledgeSettingsDataClient {
  const requireBridge = (): NonNullable<typeof window.bonzi> => {
    if (!window.bonzi) {
      throw new Error('Bonzi bridge unavailable')
    }

    return window.bonzi
  }

  return {
    isAvailable: () => Boolean(window.bonzi),
    getStatus: async () => {
      const bridge = requireBridge()
      return bridge.settings.getKnowledgeImportStatus()
    },
    selectFolders: async () => {
      const bridge = requireBridge()
      return bridge.settings.selectKnowledgeImportFolders()
    },
    importFolders: async (request) => {
      const bridge = requireBridge()
      return bridge.settings.importKnowledgeFolders(request)
    },
    cancelImport: async (request) => {
      const bridge = requireBridge()
      return bridge.settings.cancelKnowledgeImport(request)
    },
    importDocuments: async (request) => {
      const bridge = requireBridge()
      return bridge.settings.importKnowledgeDocuments(request)
    }
  }
}
