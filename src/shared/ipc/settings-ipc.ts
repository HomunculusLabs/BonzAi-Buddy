import type {
  RuntimeApprovalSettings,
  UpdateRuntimeApprovalSettingsRequest
} from '../contracts/approvals'
import type {
  ElizaCharacterSettings,
  UpdateElizaCharacterSettingsRequest
} from '../contracts/character'
import type {
  CancelKnowledgeImportRequest,
  CancelKnowledgeImportResult,
  ImportKnowledgeDocumentsRequest,
  ImportKnowledgeFoldersRequest,
  KnowledgeImportResult,
  KnowledgeImportStatus,
  SelectKnowledgeImportFoldersResult,
  StartKnowledgeImportResult
} from '../contracts/knowledge'
import type {
  HermesHealthCheckRequest,
  HermesHealthCheckResult,
  HermesModelAuthCheckResult,
  HermesModelAuthSettingsResponse,
  HermesRuntimeSettingsResponse,
  UpdateHermesModelAuthSettingsRequest,
  UpdateHermesRuntimeSettingsRequest
} from '../contracts/hermes'
import type {
  ElizaPluginSettings,
  UpdateElizaPluginSettingsRequest
} from '../contracts/plugins'
import type {
  RuntimeRoutingSettingsResponse,
  UpdateRuntimeRoutingSettingsRequest
} from '../contracts/routing-rules'
import type {
  AssistantProviderSettings,
  ListPiAiModelOptionsRequest,
  ListPiAiModelOptionsResult,
  UpdateAssistantProviderSettingsRequest
} from '../contracts/provider'
import type {
  BonziWorkspaceSettings,
  ResetBonziWorkspaceFolderResult,
  SelectBonziWorkspaceFolderResult
} from '../contracts/workspace'
import { IPC_CHANNELS } from './channels'

export type SettingsIpcInvokeChannelMap = {
  [IPC_CHANNELS.settings.getElizaPlugins]: {
    args: []
    response: ElizaPluginSettings
  }
  [IPC_CHANNELS.settings.updateElizaPlugins]: {
    args: [request: UpdateElizaPluginSettingsRequest]
    response: ElizaPluginSettings
  }
  [IPC_CHANNELS.settings.getAssistantProviderSettings]: {
    args: []
    response: AssistantProviderSettings
  }
  [IPC_CHANNELS.settings.updateAssistantProviderSettings]: {
    args: [request: UpdateAssistantProviderSettingsRequest]
    response: AssistantProviderSettings
  }
  [IPC_CHANNELS.settings.listPiAiModelOptions]: {
    args: [request?: ListPiAiModelOptionsRequest]
    response: ListPiAiModelOptionsResult
  }
  [IPC_CHANNELS.settings.getRuntimeApprovalSettings]: {
    args: []
    response: RuntimeApprovalSettings
  }
  [IPC_CHANNELS.settings.updateRuntimeApprovalSettings]: {
    args: [request: UpdateRuntimeApprovalSettingsRequest]
    response: RuntimeApprovalSettings
  }
  [IPC_CHANNELS.settings.getElizaCharacterSettings]: {
    args: []
    response: ElizaCharacterSettings
  }
  [IPC_CHANNELS.settings.updateElizaCharacterSettings]: {
    args: [request: UpdateElizaCharacterSettingsRequest]
    response: ElizaCharacterSettings
  }
  [IPC_CHANNELS.settings.importKnowledgeDocuments]: {
    args: [request: ImportKnowledgeDocumentsRequest]
    response: KnowledgeImportResult
  }
  [IPC_CHANNELS.settings.selectKnowledgeImportFolders]: {
    args: []
    response: SelectKnowledgeImportFoldersResult
  }
  [IPC_CHANNELS.settings.importKnowledgeFolders]: {
    args: [request: ImportKnowledgeFoldersRequest]
    response: StartKnowledgeImportResult
  }
  [IPC_CHANNELS.settings.cancelKnowledgeImport]: {
    args: [request: CancelKnowledgeImportRequest]
    response: CancelKnowledgeImportResult
  }
  [IPC_CHANNELS.settings.getKnowledgeImportStatus]: {
    args: []
    response: KnowledgeImportStatus
  }
  [IPC_CHANNELS.settings.getWorkspaceSettings]: {
    args: []
    response: BonziWorkspaceSettings
  }
  [IPC_CHANNELS.settings.selectWorkspaceFolder]: {
    args: []
    response: SelectBonziWorkspaceFolderResult
  }
  [IPC_CHANNELS.settings.resetWorkspaceFolder]: {
    args: []
    response: ResetBonziWorkspaceFolderResult
  }
  [IPC_CHANNELS.settings.getHermesRuntimeSettings]: {
    args: []
    response: HermesRuntimeSettingsResponse
  }
  [IPC_CHANNELS.settings.updateHermesRuntimeSettings]: {
    args: [request: UpdateHermesRuntimeSettingsRequest]
    response: HermesRuntimeSettingsResponse
  }
  [IPC_CHANNELS.settings.getHermesModelAuthSettings]: {
    args: []
    response: HermesModelAuthSettingsResponse
  }
  [IPC_CHANNELS.settings.updateHermesModelAuthSettings]: {
    args: [request: UpdateHermesModelAuthSettingsRequest]
    response: HermesModelAuthSettingsResponse
  }
  [IPC_CHANNELS.settings.checkHermesModelAuthStatus]: {
    args: []
    response: HermesModelAuthCheckResult
  }
  [IPC_CHANNELS.settings.checkHermesHealth]: {
    args: [request: HermesHealthCheckRequest]
    response: HermesHealthCheckResult
  }
  [IPC_CHANNELS.settings.getRuntimeRoutingSettings]: {
    args: []
    response: RuntimeRoutingSettingsResponse
  }
  [IPC_CHANNELS.settings.updateRuntimeRoutingSettings]: {
    args: [request: UpdateRuntimeRoutingSettingsRequest]
    response: RuntimeRoutingSettingsResponse
  }
}

export interface SettingsBridge {
  settings: {
    getElizaPlugins: () => Promise<ElizaPluginSettings>
    updateElizaPlugins: (
      request: UpdateElizaPluginSettingsRequest
    ) => Promise<ElizaPluginSettings>
    getAssistantProviderSettings: () => Promise<AssistantProviderSettings>
    updateAssistantProviderSettings: (
      request: UpdateAssistantProviderSettingsRequest
    ) => Promise<AssistantProviderSettings>
    listPiAiModelOptions: (
      request?: ListPiAiModelOptionsRequest
    ) => Promise<ListPiAiModelOptionsResult>
    getRuntimeApprovalSettings: () => Promise<RuntimeApprovalSettings>
    updateRuntimeApprovalSettings: (
      request: UpdateRuntimeApprovalSettingsRequest
    ) => Promise<RuntimeApprovalSettings>
    getElizaCharacterSettings: () => Promise<ElizaCharacterSettings>
    updateElizaCharacterSettings: (
      request: UpdateElizaCharacterSettingsRequest
    ) => Promise<ElizaCharacterSettings>
    importKnowledgeDocuments: (
      request: ImportKnowledgeDocumentsRequest
    ) => Promise<KnowledgeImportResult>
    selectKnowledgeImportFolders: () => Promise<SelectKnowledgeImportFoldersResult>
    importKnowledgeFolders: (
      request: ImportKnowledgeFoldersRequest
    ) => Promise<StartKnowledgeImportResult>
    cancelKnowledgeImport: (
      request: CancelKnowledgeImportRequest
    ) => Promise<CancelKnowledgeImportResult>
    getKnowledgeImportStatus: () => Promise<KnowledgeImportStatus>
    getWorkspaceSettings: () => Promise<BonziWorkspaceSettings>
    selectWorkspaceFolder: () => Promise<SelectBonziWorkspaceFolderResult>
    resetWorkspaceFolder: () => Promise<ResetBonziWorkspaceFolderResult>
    getHermesRuntimeSettings: () => Promise<HermesRuntimeSettingsResponse>
    updateHermesRuntimeSettings: (
      request: UpdateHermesRuntimeSettingsRequest
    ) => Promise<HermesRuntimeSettingsResponse>
    getHermesModelAuthSettings: () => Promise<HermesModelAuthSettingsResponse>
    updateHermesModelAuthSettings: (
      request: UpdateHermesModelAuthSettingsRequest
    ) => Promise<HermesModelAuthSettingsResponse>
    checkHermesModelAuthStatus: () => Promise<HermesModelAuthCheckResult>
    checkHermesHealth: (
      request: HermesHealthCheckRequest
    ) => Promise<HermesHealthCheckResult>
    getRuntimeRoutingSettings: () => Promise<RuntimeRoutingSettingsResponse>
    updateRuntimeRoutingSettings: (
      request: UpdateRuntimeRoutingSettingsRequest
    ) => Promise<RuntimeRoutingSettingsResponse>
  }
}
