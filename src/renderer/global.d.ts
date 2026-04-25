/// <reference types="vite/client" />

import type {
  AssistantActionExecutionRequest,
  AssistantActionExecutionResponse,
  AssistantCommandRequest,
  AssistantCommandResponse,
  AssistantEvent,
  AssistantMessage,
  ElizaPluginSettings,
  UpdateElizaPluginSettingsRequest,
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
        onEvent: (listener: (event: AssistantEvent) => void) => () => void
      }
    }
  }
}

export {}
