import { contextBridge, ipcRenderer } from 'electron'
import type {
  AssistantActionExecutionRequest,
  AssistantActionExecutionResponse,
  AssistantCommandRequest,
  AssistantCommandResponse,
  AssistantEvent,
  AssistantMessage,
  AssistantRuntimeStatus,
  CancelWorkflowRunRequest,
  CancelWorkflowRunResponse,
  BonziWorkflowRunSnapshot,
  ElizaPluginDiscoveryRequest,
  ElizaPluginInstallRequest,
  RespondWorkflowApprovalRequest,
  RespondWorkflowApprovalResponse,
  ElizaPluginOperationResult,
  ElizaPluginSettings,
  ElizaPluginUninstallRequest,
  UpdateElizaPluginSettingsRequest,
  ShellState
} from '../shared/contracts'

const bonziApi = {
  app: {
    getShellState: (): Promise<ShellState> =>
      ipcRenderer.invoke('app:get-shell-state')
  },
  settings: {
    getElizaPlugins: (): Promise<ElizaPluginSettings> =>
      ipcRenderer.invoke('settings:get-eliza-plugins'),
    updateElizaPlugins: (
      request: UpdateElizaPluginSettingsRequest
    ): Promise<ElizaPluginSettings> =>
      ipcRenderer.invoke('settings:update-eliza-plugins', request)
  },
  plugins: {
    discover: (
      request?: ElizaPluginDiscoveryRequest
    ): Promise<ElizaPluginSettings> =>
      ipcRenderer.invoke('plugins:discover', request),
    install: (
      request: ElizaPluginInstallRequest
    ): Promise<ElizaPluginOperationResult> =>
      ipcRenderer.invoke('plugins:install', request),
    uninstall: (
      request: ElizaPluginUninstallRequest
    ): Promise<ElizaPluginOperationResult> =>
      ipcRenderer.invoke('plugins:uninstall', request)
  },
  window: {
    getBounds: (): Promise<{
      x: number
      y: number
      width: number
      height: number
    } | null> => ipcRenderer.invoke('window:get-bounds'),
    minimize: (): void => ipcRenderer.send('window:minimize'),
    close: (): void => ipcRenderer.send('window:close'),
    setPosition: (x: number, y: number): void =>
      ipcRenderer.send('window:set-position', x, y),
    setBounds: (bounds: {
      x: number
      y: number
      width: number
      height: number
    }): void => ipcRenderer.send('window:set-bounds', bounds)
  },
  assistant: {
    sendCommand: (
      request: AssistantCommandRequest
    ): Promise<AssistantCommandResponse> =>
      ipcRenderer.invoke('assistant:send-command', request),
    executeAction: (
      request: AssistantActionExecutionRequest
    ): Promise<AssistantActionExecutionResponse> =>
      ipcRenderer.invoke('assistant:execute-action', request),
    getHistory: (): Promise<AssistantMessage[]> =>
      ipcRenderer.invoke('assistant:get-history'),
    resetConversation: (): Promise<void> =>
      ipcRenderer.invoke('assistant:reset-conversation'),
    reloadRuntime: (): Promise<AssistantRuntimeStatus> =>
      ipcRenderer.invoke('assistant:reload-runtime'),
    getWorkflowRuns: (): Promise<BonziWorkflowRunSnapshot[]> =>
      ipcRenderer.invoke('assistant:get-workflow-runs'),
    getWorkflowRun: (id: string): Promise<BonziWorkflowRunSnapshot | null> =>
      ipcRenderer.invoke('assistant:get-workflow-run', id),
    respondWorkflowApproval: (
      request: RespondWorkflowApprovalRequest
    ): Promise<RespondWorkflowApprovalResponse> =>
      ipcRenderer.invoke('assistant:respond-workflow-approval', request),
    cancelWorkflowRun: (
      request: CancelWorkflowRunRequest
    ): Promise<CancelWorkflowRunResponse> =>
      ipcRenderer.invoke('assistant:cancel-workflow', request),
    onEvent: (listener: (event: AssistantEvent) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, event: AssistantEvent) => {
        listener(event)
      }

      ipcRenderer.on('assistant:event', handler)

      return (): void => {
        ipcRenderer.off('assistant:event', handler)
      }
    }
  }
}

contextBridge.exposeInMainWorld('bonzi', bonziApi)
