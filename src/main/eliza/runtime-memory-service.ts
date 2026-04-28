import type {
  AssistantActionType,
  AssistantMessage,
  CancelKnowledgeImportRequest,
  CancelKnowledgeImportResult,
  ImportKnowledgeDocumentsRequest,
  ImportKnowledgeFoldersRequest,
  KnowledgeImportResult,
  KnowledgeImportStatus,
  StartKnowledgeImportResult
} from '../../shared/contracts'
import type { RuntimeBundle } from './runtime-lifecycle'
import { BonziConversationMemoryService } from './runtime-conversation-memory'
import { BonziKnowledgeImportCoordinator } from './runtime-knowledge-import-coordinator'

interface RuntimeMemoryServiceOptions {
  getRuntime: () => Promise<RuntimeBundle>
  knowledgeImportManifestPath?: string
  canSkipHistoryRuntimeHydration?: () => boolean
}

export class BonziRuntimeMemoryService {
  private readonly conversationMemory: BonziConversationMemoryService
  private readonly knowledgeImports: BonziKnowledgeImportCoordinator

  constructor(options: RuntimeMemoryServiceOptions) {
    this.conversationMemory = new BonziConversationMemoryService({
      getRuntime: options.getRuntime,
      canSkipHistoryRuntimeHydration: options.canSkipHistoryRuntimeHydration
    })
    this.knowledgeImports = new BonziKnowledgeImportCoordinator({
      getRuntime: options.getRuntime,
      knowledgeImportManifestPath: options.knowledgeImportManifestPath
    })
  }

  getHistory(): Promise<AssistantMessage[]> {
    return this.conversationMemory.getHistory()
  }

  resetConversation(): Promise<void> {
    return this.conversationMemory.resetConversation()
  }

  getKnowledgeImportStatus(): Promise<KnowledgeImportStatus> {
    return this.knowledgeImports.getKnowledgeImportStatus()
  }

  importKnowledgeDocuments(
    request: ImportKnowledgeDocumentsRequest
  ): Promise<KnowledgeImportResult> {
    return this.knowledgeImports.importKnowledgeDocuments(request)
  }

  startKnowledgeFolderImport(
    request: ImportKnowledgeFoldersRequest
  ): Promise<StartKnowledgeImportResult> {
    return this.knowledgeImports.startKnowledgeFolderImport(request)
  }

  cancelKnowledgeImport(
    request: CancelKnowledgeImportRequest = {}
  ): Promise<CancelKnowledgeImportResult> {
    return this.knowledgeImports.cancelKnowledgeImport(request)
  }

  recordActionObservation(
    action: {
      type: AssistantActionType
      title: string
      status: string
      params?: unknown
    },
    resultMessage: string
  ): Promise<void> {
    return this.conversationMemory.recordActionObservation(action, resultMessage)
  }
}
