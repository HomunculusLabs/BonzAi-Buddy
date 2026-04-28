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
  ElizaPluginSettings,
  UpdateElizaPluginSettingsRequest
} from '../contracts/plugins'
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
}

export interface SettingsBridge {
  settings: {
    getElizaPlugins: () => Promise<ElizaPluginSettings>
    updateElizaPlugins: (
      request: UpdateElizaPluginSettingsRequest
    ) => Promise<ElizaPluginSettings>
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
  }
}
