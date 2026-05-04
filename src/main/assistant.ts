import { app, type BrowserWindow } from 'electron'
import {
  type AssistantActionExecutionRequest,
  type AssistantActionExecutionResponse,
  type AssistantActionType,
  type AssistantCommandRequest,
  type AssistantCommandResponse,
  type CancelWorkflowRunRequest,
  type CancelWorkflowRunResponse,
  type AssistantEvent,
  type AssistantMessage,
  type AssistantProviderInfo,
  type AssistantProviderSettings,
  type AssistantRuntimeStatus,
  type BonziWorkflowRunSnapshot,
  type BonziWorkspaceSettings,
  type CancelKnowledgeImportRequest,
  type CancelKnowledgeImportResult,
  type ElizaCharacterSettings,
  type ElizaPluginDiscoveryRequest,
  type RespondWorkflowApprovalRequest,
  type RespondWorkflowApprovalResponse,
  type RuntimeApprovalSettings,
  type RuntimeRoutingSettingsResponse,
  type ElizaPluginInstallRequest,
  type ElizaPluginOperationResult,
  type ElizaPluginSettings,
  type ElizaPluginUninstallRequest,
  type HermesHealthCheckRequest,
  type HermesHealthCheckResult,
  type HermesModelAuthCheckResult,
  type HermesModelAuthSettingsResponse,
  type HermesRuntimeSettingsResponse,
  type HermesSecondaryRuntimeSummary,
  type UpdateHermesModelAuthSettingsRequest,
  type UpdateHermesRuntimeSettingsRequest,
  type ImportKnowledgeDocumentsRequest,
  type ImportKnowledgeFoldersRequest,
  type ListPiAiModelOptionsRequest,
  type ListPiAiModelOptionsResult,
  type KnowledgeImportResult,
  type KnowledgeImportStatus,
  type UpdateAssistantProviderSettingsRequest,
  type UpdateElizaCharacterSettingsRequest,
  type UpdateElizaPluginSettingsRequest,
  type UpdateRuntimeApprovalSettingsRequest,
  type UpdateRuntimeRoutingSettingsRequest,
  type ShellState,
  type StartKnowledgeImportResult
} from '../shared/contracts'
import { AssistantActionUseCase } from './assistant-action-use-case'
import { AssistantCommandUseCase } from './assistant-command-use-case'
import { AssistantWorkflowUseCase } from './assistant-workflow-use-case'
import { BonziRuntimeManager } from './eliza/runtime-manager'
import { createDiscordBrowserServiceFromEnv } from './discord-browser-service'
import { BonziWorkspaceFileService } from './bonzi-workspace-file-service'
import { PendingAssistantActions } from './pending-assistant-actions'
import { BonziWorkflowContinuationCoordinator } from './workflow-continuation-coordinator'
import { HermesSecondaryRuntimeService } from './hermes/hermes-secondary-runtime-service'

interface AssistantServiceOptions {
  getCompanionWindow: () => BrowserWindow | null
  getShellState: () => ShellState
}

export interface AssistantService {
  getProviderInfo: () => AssistantProviderInfo
  getStartupWarnings: () => string[]
  getRuntimeStatus: () => AssistantRuntimeStatus
  getPluginSettings: () => ElizaPluginSettings
  getRuntimeApprovalSettings: () => RuntimeApprovalSettings
  getAssistantProviderSettings: () => AssistantProviderSettings
  updateAssistantProviderSettings: (
    request: UpdateAssistantProviderSettingsRequest
  ) => Promise<AssistantProviderSettings>
  listPiAiModelOptions: (
    request?: ListPiAiModelOptionsRequest
  ) => Promise<ListPiAiModelOptionsResult>
  updateRuntimeApprovalSettings: (
    request: UpdateRuntimeApprovalSettingsRequest
  ) => Promise<RuntimeApprovalSettings>
  getCharacterSettings: () => ElizaCharacterSettings
  updateCharacterSettings: (
    request: UpdateElizaCharacterSettingsRequest
  ) => Promise<ElizaCharacterSettings>
  importKnowledgeDocuments: (
    request: ImportKnowledgeDocumentsRequest
  ) => Promise<KnowledgeImportResult>
  startKnowledgeFolderImport: (
    request: ImportKnowledgeFoldersRequest
  ) => Promise<StartKnowledgeImportResult>
  cancelKnowledgeImport: (
    request: CancelKnowledgeImportRequest
  ) => Promise<CancelKnowledgeImportResult>
  getKnowledgeImportStatus: () => Promise<KnowledgeImportStatus>
  getWorkspaceSettings: () => Promise<BonziWorkspaceSettings>
  setWorkspaceFolder: (folderPath: string) => Promise<BonziWorkspaceSettings>
  resetWorkspaceFolder: () => Promise<BonziWorkspaceSettings>
  getHermesSecondaryRuntimeSummary: () => HermesSecondaryRuntimeSummary
  getHermesRuntimeSettings: () => HermesRuntimeSettingsResponse
  updateHermesRuntimeSettings: (
    request: UpdateHermesRuntimeSettingsRequest
  ) => Promise<HermesRuntimeSettingsResponse>
  getHermesModelAuthSettings: () => HermesModelAuthSettingsResponse
  updateHermesModelAuthSettings: (
    request: UpdateHermesModelAuthSettingsRequest
  ) => Promise<HermesModelAuthSettingsResponse>
  checkHermesModelAuthStatus: () => Promise<HermesModelAuthCheckResult>
  checkHermesHealth: (
    request: HermesHealthCheckRequest
  ) => Promise<HermesHealthCheckResult>
  getRuntimeRoutingSettings: () => RuntimeRoutingSettingsResponse
  updateRuntimeRoutingSettings: (
    request: UpdateRuntimeRoutingSettingsRequest
  ) => Promise<RuntimeRoutingSettingsResponse>
  discoverPlugins: (
    request?: ElizaPluginDiscoveryRequest
  ) => Promise<ElizaPluginSettings>
  updatePluginSettings: (
    request: UpdateElizaPluginSettingsRequest
  ) => Promise<ElizaPluginSettings>
  installPlugin: (
    request: ElizaPluginInstallRequest
  ) => Promise<ElizaPluginOperationResult>
  uninstallPlugin: (
    request: ElizaPluginUninstallRequest
  ) => Promise<ElizaPluginOperationResult>
  getAvailableActionTypes: () => AssistantActionType[]
  getHistory: () => Promise<AssistantMessage[]>
  resetConversation: () => Promise<void>
  reloadRuntime: () => Promise<AssistantRuntimeStatus>
  subscribe: (listener: (event: AssistantEvent) => void) => () => void
  getWorkflowRuns: () => BonziWorkflowRunSnapshot[]
  getWorkflowRun: (id: string) => BonziWorkflowRunSnapshot | null
  respondWorkflowApproval: (
    request: RespondWorkflowApprovalRequest
  ) => Promise<RespondWorkflowApprovalResponse>
  cancelWorkflowRun: (
    request: CancelWorkflowRunRequest
  ) => Promise<CancelWorkflowRunResponse>
  sendCommand: (
    request: AssistantCommandRequest
  ) => Promise<AssistantCommandResponse>
  executeAction: (
    request: AssistantActionExecutionRequest
  ) => Promise<AssistantActionExecutionResponse>
  dispose: () => Promise<void>
}

export function createAssistantService(
  options: AssistantServiceOptions
): AssistantService {
  const discordBrowserService = createDiscordBrowserServiceFromEnv()
  const workspaceFileService = new BonziWorkspaceFileService({
    userDataDir: app.getPath('userData')
  })
  const hermesService = new HermesSecondaryRuntimeService()
  const runtimeManager = new BonziRuntimeManager({
    getShellState: options.getShellState,
    getCompanionWindow: options.getCompanionWindow,
    discordBrowserService,
    workspaceFileService,
    hermesService
  })
  let continuationCoordinator: BonziWorkflowContinuationCoordinator
  const pendingActions = new PendingAssistantActions({
    getShellState: options.getShellState,
    getCompanionWindow: options.getCompanionWindow,
    getApprovalSettings: () => runtimeManager.getRuntimeApprovalSettings(),
    discordBrowserService,
    workspaceFileService,
    hermesService,
    linkExternalAction: (action) => {
      runtimeManager.linkExternalAction(action)
    },
    markExternalActionRunning: (action) => {
      runtimeManager.markExternalActionRunning(action)
    },
    onActionUpdated: (action) => {
      runtimeManager.emitAssistantActionUpdated(action)
    },
    onActionExecutionFinished: (input) =>
      continuationCoordinator.handleActionExecutionFinished(input)
  })
  continuationCoordinator = new BonziWorkflowContinuationCoordinator({
    runtimeManager,
    pendingActions,
    createAssistantMessage
  })
  const commandUseCase = new AssistantCommandUseCase({
    runtimeManager,
    pendingActions,
    createAssistantMessage
  })
  const actionUseCase = new AssistantActionUseCase({ pendingActions })
  const workflowUseCase = new AssistantWorkflowUseCase({ runtimeManager })

  return {
    getProviderInfo: () => runtimeManager.getProviderInfo(),
    getStartupWarnings: () => runtimeManager.getStartupWarnings(),
    getRuntimeStatus: () => runtimeManager.getRuntimeStatus(),
    getPluginSettings: () => runtimeManager.getPluginSettings(),
    getRuntimeApprovalSettings: () => runtimeManager.getRuntimeApprovalSettings(),
    getAssistantProviderSettings: () => runtimeManager.getAssistantProviderSettings(),
    async updateAssistantProviderSettings(
      request
    ): Promise<AssistantProviderSettings> {
      return runtimeManager.updateAssistantProviderSettings(request)
    },
    listPiAiModelOptions: (request) => runtimeManager.listPiAiModelOptions(request),
    async updateRuntimeApprovalSettings(request): Promise<RuntimeApprovalSettings> {
      return runtimeManager.updateRuntimeApprovalSettings(request)
    },
    getCharacterSettings: () => runtimeManager.getCharacterSettings(),
    async updateCharacterSettings(request): Promise<ElizaCharacterSettings> {
      return runtimeManager.updateCharacterSettings(request)
    },
    importKnowledgeDocuments: (request) =>
      runtimeManager.importKnowledgeDocuments(request),
    startKnowledgeFolderImport: (request) =>
      runtimeManager.startKnowledgeFolderImport(request),
    cancelKnowledgeImport: (request) =>
      runtimeManager.cancelKnowledgeImport(request),
    getKnowledgeImportStatus: () => runtimeManager.getKnowledgeImportStatus(),
    getWorkspaceSettings: async () => workspaceFileService.getSettings(),
    setWorkspaceFolder: (folderPath) => workspaceFileService.setWorkspaceDir(folderPath),
    resetWorkspaceFolder: () => workspaceFileService.resetWorkspaceDir(),
    getHermesSecondaryRuntimeSummary: () => hermesService.getSummary(),
    getHermesRuntimeSettings: () => hermesService.getHermesRuntimeSettings(),
    updateHermesRuntimeSettings: (request) =>
      hermesService.updateHermesRuntimeSettings(request),
    getHermesModelAuthSettings: () => hermesService.getHermesModelAuthSettings(),
    updateHermesModelAuthSettings: (request) =>
      hermesService.updateHermesModelAuthSettings(request),
    checkHermesModelAuthStatus: async () => hermesService.checkHermesModelAuthStatus(),
    checkHermesHealth: (request) => hermesService.checkHermesHealth(request),
    getRuntimeRoutingSettings: () => runtimeManager.getRuntimeRoutingSettings(),
    async updateRuntimeRoutingSettings(
      request
    ): Promise<RuntimeRoutingSettingsResponse> {
      return runtimeManager.updateRuntimeRoutingSettings(request)
    },
    discoverPlugins: (request) => runtimeManager.discoverPlugins(request),
    updatePluginSettings: (request) => runtimeManager.updatePluginSettings(request),
    installPlugin: (request) => runtimeManager.installPlugin(request),
    uninstallPlugin: (request) => runtimeManager.uninstallPlugin(request),
    getAvailableActionTypes: () => runtimeManager.getAvailableActionTypes(),
    getHistory: () => runtimeManager.getHistory(),
    async resetConversation(): Promise<void> {
      continuationCoordinator.dispose()
      pendingActions.clear()
      await runtimeManager.resetConversation()
    },
    async reloadRuntime(): Promise<AssistantRuntimeStatus> {
      continuationCoordinator.dispose()
      pendingActions.clear()
      const primaryStatus = await runtimeManager.reloadRuntime()
      try {
        await hermesService.reloadRuntime()
      } catch (error) {
        console.warn('Hermes secondary runtime reload failed.', error)
      }
      return primaryStatus
    },
    subscribe: (listener) => runtimeManager.subscribe(listener),
    getWorkflowRuns: () => runtimeManager.getWorkflowRuns(),
    getWorkflowRun: (id) => runtimeManager.getWorkflowRun(id),
    respondWorkflowApproval: (request) =>
      workflowUseCase.respondWorkflowApproval(request),
    cancelWorkflowRun: (request) => workflowUseCase.cancelWorkflowRun(request),
    sendCommand: (request) => commandUseCase.sendCommand(request),
    executeAction: (request) => actionUseCase.executeAction(request),
    async dispose(): Promise<void> {
      continuationCoordinator.dispose()
      pendingActions.clear()
      await runtimeManager.dispose()
      await hermesService.dispose()
      await discordBrowserService.dispose()
    }
  }
}

function createAssistantMessage(
  role: AssistantMessage['role'],
  content: string
): AssistantMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString()
  }
}
