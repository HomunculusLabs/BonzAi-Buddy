import type {
  AssistantActionExecutionRequest,
  AssistantActionExecutionResponse,
  AssistantCommandRequest,
  AssistantCommandResponse,
  AssistantEvent,
  AssistantMessage,
  AssistantRuntimeStatus
} from './contracts/assistant'
import type {
  RuntimeApprovalSettings,
  UpdateRuntimeApprovalSettingsRequest
} from './contracts/approvals'
import type {
  ElizaCharacterSettings,
  UpdateElizaCharacterSettingsRequest
} from './contracts/character'
import type {
  ElizaPluginDiscoveryRequest,
  ElizaPluginInstallRequest,
  ElizaPluginOperationResult,
  ElizaPluginSettings,
  ElizaPluginUninstallRequest,
  UpdateElizaPluginSettingsRequest
} from './contracts/plugins'
import type { ShellState } from './contracts/shell'
import type {
  BonziWorkflowRunSnapshot,
  CancelWorkflowRunRequest,
  CancelWorkflowRunResponse,
  RespondWorkflowApprovalRequest,
  RespondWorkflowApprovalResponse
} from './contracts/workflow'

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export const IPC_CHANNELS = {
  app: {
    getShellState: 'app:get-shell-state'
  },
  settings: {
    getElizaPlugins: 'settings:get-eliza-plugins',
    updateElizaPlugins: 'settings:update-eliza-plugins',
    getRuntimeApprovalSettings: 'settings:get-runtime-approval-settings',
    updateRuntimeApprovalSettings: 'settings:update-runtime-approval-settings',
    getElizaCharacterSettings: 'settings:get-eliza-character-settings',
    updateElizaCharacterSettings: 'settings:update-eliza-character-settings'
  },
  plugins: {
    discover: 'plugins:discover',
    install: 'plugins:install',
    uninstall: 'plugins:uninstall'
  },
  window: {
    getBounds: 'window:get-bounds',
    minimize: 'window:minimize',
    close: 'window:close',
    setPosition: 'window:set-position',
    setBounds: 'window:set-bounds',
    setMouseEventsIgnored: 'window:set-mouse-events-ignored'
  },
  assistant: {
    sendCommand: 'assistant:send-command',
    executeAction: 'assistant:execute-action',
    getHistory: 'assistant:get-history',
    resetConversation: 'assistant:reset-conversation',
    reloadRuntime: 'assistant:reload-runtime',
    getWorkflowRuns: 'assistant:get-workflow-runs',
    getWorkflowRun: 'assistant:get-workflow-run',
    respondWorkflowApproval: 'assistant:respond-workflow-approval',
    cancelWorkflow: 'assistant:cancel-workflow',
    event: 'assistant:event'
  }
} as const

export type IpcInvokeChannelMap = {
  [IPC_CHANNELS.app.getShellState]: {
    args: []
    response: ShellState
  }
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
  [IPC_CHANNELS.plugins.discover]: {
    args: [request?: ElizaPluginDiscoveryRequest]
    response: ElizaPluginSettings
  }
  [IPC_CHANNELS.plugins.install]: {
    args: [request: ElizaPluginInstallRequest]
    response: ElizaPluginOperationResult
  }
  [IPC_CHANNELS.plugins.uninstall]: {
    args: [request: ElizaPluginUninstallRequest]
    response: ElizaPluginOperationResult
  }
  [IPC_CHANNELS.window.getBounds]: {
    args: []
    response: WindowBounds | null
  }
  [IPC_CHANNELS.assistant.sendCommand]: {
    args: [request: AssistantCommandRequest]
    response: AssistantCommandResponse
  }
  [IPC_CHANNELS.assistant.executeAction]: {
    args: [request: AssistantActionExecutionRequest]
    response: AssistantActionExecutionResponse
  }
  [IPC_CHANNELS.assistant.getHistory]: {
    args: []
    response: AssistantMessage[]
  }
  [IPC_CHANNELS.assistant.resetConversation]: {
    args: []
    response: void
  }
  [IPC_CHANNELS.assistant.reloadRuntime]: {
    args: []
    response: AssistantRuntimeStatus
  }
  [IPC_CHANNELS.assistant.getWorkflowRuns]: {
    args: []
    response: BonziWorkflowRunSnapshot[]
  }
  [IPC_CHANNELS.assistant.getWorkflowRun]: {
    args: [id: string]
    response: BonziWorkflowRunSnapshot | null
  }
  [IPC_CHANNELS.assistant.respondWorkflowApproval]: {
    args: [request: RespondWorkflowApprovalRequest]
    response: RespondWorkflowApprovalResponse
  }
  [IPC_CHANNELS.assistant.cancelWorkflow]: {
    args: [request: CancelWorkflowRunRequest]
    response: CancelWorkflowRunResponse
  }
}

export type IpcSendChannelMap = {
  [IPC_CHANNELS.window.minimize]: {
    args: []
  }
  [IPC_CHANNELS.window.close]: {
    args: []
  }
  [IPC_CHANNELS.window.setPosition]: {
    args: [x: number, y: number]
  }
  [IPC_CHANNELS.window.setBounds]: {
    args: [bounds: WindowBounds]
  }
  [IPC_CHANNELS.window.setMouseEventsIgnored]: {
    args: [ignored: boolean]
  }
}

export type IpcRendererEventChannelMap = {
  [IPC_CHANNELS.assistant.event]: {
    args: [event: AssistantEvent]
  }
}

export type IpcInvokeChannel = keyof IpcInvokeChannelMap
export type IpcSendChannel = keyof IpcSendChannelMap
export type IpcRendererEventChannel = keyof IpcRendererEventChannelMap

export type IpcInvokeArgs<Channel extends IpcInvokeChannel> =
  IpcInvokeChannelMap[Channel]['args']

export type IpcInvokeResponse<Channel extends IpcInvokeChannel> =
  IpcInvokeChannelMap[Channel]['response']

export type IpcSendArgs<Channel extends IpcSendChannel> =
  IpcSendChannelMap[Channel]['args']

export type IpcRendererEventArgs<Channel extends IpcRendererEventChannel> =
  IpcRendererEventChannelMap[Channel]['args']

export interface BonziBridge {
  app: {
    getShellState: () => Promise<ShellState>
  }
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
  }
  plugins: {
    discover: (request?: ElizaPluginDiscoveryRequest) => Promise<ElizaPluginSettings>
    install: (
      request: ElizaPluginInstallRequest
    ) => Promise<ElizaPluginOperationResult>
    uninstall: (
      request: ElizaPluginUninstallRequest
    ) => Promise<ElizaPluginOperationResult>
  }
  window: {
    getBounds: () => Promise<WindowBounds | null>
    minimize: () => void
    close: () => void
    setPosition: (x: number, y: number) => void
    setBounds: (bounds: WindowBounds) => void
    setMouseEventsIgnored: (ignored: boolean) => void
  }
  assistant: {
    sendCommand: (
      request: AssistantCommandRequest
    ) => Promise<AssistantCommandResponse>
    executeAction: (
      request: AssistantActionExecutionRequest
    ) => Promise<AssistantActionExecutionResponse>
    getHistory: () => Promise<AssistantMessage[]>
    resetConversation: () => Promise<void>
    reloadRuntime: () => Promise<AssistantRuntimeStatus>
    getWorkflowRuns: () => Promise<BonziWorkflowRunSnapshot[]>
    getWorkflowRun: (id: string) => Promise<BonziWorkflowRunSnapshot | null>
    respondWorkflowApproval: (
      request: RespondWorkflowApprovalRequest
    ) => Promise<RespondWorkflowApprovalResponse>
    cancelWorkflowRun: (
      request: CancelWorkflowRunRequest
    ) => Promise<CancelWorkflowRunResponse>
    onEvent: (listener: (event: AssistantEvent) => void) => () => void
  }
}
