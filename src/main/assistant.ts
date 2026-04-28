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
  type ElizaPluginInstallRequest,
  type ElizaPluginOperationResult,
  type ElizaPluginSettings,
  type ElizaPluginUninstallRequest,
  type ImportKnowledgeDocumentsRequest,
  type ImportKnowledgeFoldersRequest,
  type KnowledgeImportResult,
  type KnowledgeImportStatus,
  type UpdateElizaCharacterSettingsRequest,
  type UpdateElizaPluginSettingsRequest,
  type UpdateRuntimeApprovalSettingsRequest,
  type ShellState,
  type StartKnowledgeImportResult
} from '../shared/contracts'
import { normalizeError } from '../shared/value-utils'
import { BonziRuntimeManager } from './eliza/runtime-manager'
import {
  normalizeActionExecutionRequest,
  normalizeCancelWorkflowRequest,
  normalizeCommandRequest,
  normalizeWorkflowApprovalRequest
} from './assistant-request-normalization'
import { createDiscordBrowserServiceFromEnv } from './discord-browser-service'
import { BonziWorkspaceFileService } from './bonzi-workspace-file-service'
import { PendingAssistantActions } from './pending-assistant-actions'
import { BonziWorkflowContinuationCoordinator } from './workflow-continuation-coordinator'

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
  const runtimeManager = new BonziRuntimeManager({
    getShellState: options.getShellState,
    getCompanionWindow: options.getCompanionWindow,
    discordBrowserService,
    workspaceFileService
  })
  let continuationCoordinator: BonziWorkflowContinuationCoordinator
  const pendingActions = new PendingAssistantActions({
    getShellState: options.getShellState,
    getCompanionWindow: options.getCompanionWindow,
    getApprovalSettings: () => runtimeManager.getRuntimeApprovalSettings(),
    discordBrowserService,
    workspaceFileService,
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

  return {
    getProviderInfo: () => runtimeManager.getProviderInfo(),
    getStartupWarnings: () => runtimeManager.getStartupWarnings(),
    getRuntimeStatus: () => runtimeManager.getRuntimeStatus(),
    getPluginSettings: () => runtimeManager.getPluginSettings(),
    getRuntimeApprovalSettings: () => runtimeManager.getRuntimeApprovalSettings(),
    async updateRuntimeApprovalSettings(
      request: UpdateRuntimeApprovalSettingsRequest
    ): Promise<RuntimeApprovalSettings> {
      return runtimeManager.updateRuntimeApprovalSettings(request)
    },
    getCharacterSettings: () => runtimeManager.getCharacterSettings(),
    async updateCharacterSettings(
      request: UpdateElizaCharacterSettingsRequest
    ): Promise<ElizaCharacterSettings> {
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
      return runtimeManager.reloadRuntime()
    },
    subscribe: (listener) => runtimeManager.subscribe(listener),
    getWorkflowRuns: () => runtimeManager.getWorkflowRuns(),
    getWorkflowRun: (id) => runtimeManager.getWorkflowRun(id),
    async respondWorkflowApproval(
      request: RespondWorkflowApprovalRequest
    ): Promise<RespondWorkflowApprovalResponse> {
      const normalized = normalizeWorkflowApprovalRequest(request)

      if (normalized.error) {
        return {
          ok: false,
          message: normalized.error
        }
      }

      const run = runtimeManager.respondToWorkflowApproval(normalized)

      if (!run) {
        return {
          ok: false,
          message: 'Workflow run or step could not be found.'
        }
      }

      return {
        ok: true,
        message: normalized.approved
          ? 'Workflow action approved.'
          : 'Workflow action declined.',
        run
      }
    },
    async cancelWorkflowRun(
      request: CancelWorkflowRunRequest
    ): Promise<CancelWorkflowRunResponse> {
      const normalized = normalizeCancelWorkflowRequest(request)

      if (normalized.error) {
        return {
          ok: false,
          message: normalized.error
        }
      }

      const run = runtimeManager.cancelWorkflowRun(normalized.runId)

      if (!run) {
        return {
          ok: false,
          message: 'Workflow run could not be found.'
        }
      }

      return {
        ok: true,
        message: 'Workflow cancellation requested.',
        run
      }
    },
    async sendCommand(
      request: AssistantCommandRequest
    ): Promise<AssistantCommandResponse> {
      const normalizedRequest = normalizeCommandRequest(request)
      const provider = runtimeManager.getProviderInfo()
      const startupWarnings = runtimeManager.getStartupWarnings()

      if (normalizedRequest.error) {
        return {
          ok: false,
          provider,
          error: normalizedRequest.error,
          actions: [],
          warnings: startupWarnings
        }
      }

      try {
        const runtimeTurn = await runtimeManager.sendCommand(normalizedRequest.command)
        const actions = await pendingActions.createActionsForRuntimeTurn(
          runtimeTurn.actions
        )

        const latestWorkflowRun = runtimeTurn.workflowRun?.id
          ? runtimeManager.getWorkflowRun(runtimeTurn.workflowRun.id) ?? runtimeTurn.workflowRun
          : undefined

        return {
          ok: true,
          provider: runtimeManager.getProviderInfo(),
          reply: createAssistantMessage('assistant', runtimeTurn.reply),
          actions,
          warnings: [...runtimeManager.getStartupWarnings(), ...runtimeTurn.warnings],
          workflowRun: latestWorkflowRun
        }
      } catch (error) {
        return {
          ok: false,
          provider: runtimeManager.getProviderInfo(),
          error: normalizeError(error),
          actions: [],
          warnings: runtimeManager.getStartupWarnings()
        }
      }
    },
    async executeAction(
      request: AssistantActionExecutionRequest
    ): Promise<AssistantActionExecutionResponse> {
      const normalizedRequest = normalizeActionExecutionRequest(request)

      if (normalizedRequest.error) {
        return {
          ok: false,
          message: normalizedRequest.error,
          confirmationRequired: false
        }
      }

      return pendingActions.execute(normalizedRequest)
    },
    async dispose(): Promise<void> {
      continuationCoordinator.dispose()
      pendingActions.clear()
      await runtimeManager.dispose()
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
