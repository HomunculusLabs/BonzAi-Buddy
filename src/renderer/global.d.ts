/// <reference types="vite/client" />

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
  RuntimeApprovalSettings,
  UpdateElizaPluginSettingsRequest,
  UpdateRuntimeApprovalSettingsRequest,
  ShellState
} from '../shared/contracts'

declare global {
  interface Window {
    bonzi: {
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
      }
      plugins: {
        discover: (
          request?: ElizaPluginDiscoveryRequest
        ) => Promise<ElizaPluginSettings>
        install: (
          request: ElizaPluginInstallRequest
        ) => Promise<ElizaPluginOperationResult>
        uninstall: (
          request: ElizaPluginUninstallRequest
        ) => Promise<ElizaPluginOperationResult>
      }
      window: {
        getBounds: () => Promise<{
          x: number
          y: number
          width: number
          height: number
        } | null>
        minimize: () => void
        close: () => void
        setPosition: (x: number, y: number) => void
        setBounds: (bounds: {
          x: number
          y: number
          width: number
          height: number
        }) => void
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
  }
}

export {}
