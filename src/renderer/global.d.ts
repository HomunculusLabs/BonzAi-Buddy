/// <reference types="vite/client" />

import type {
  AssistantActionExecutionRequest,
  AssistantActionExecutionResponse,
  AssistantCommandRequest,
  AssistantCommandResponse,
  ShellState
} from '../shared/contracts'

declare global {
  interface Window {
    bonzi: {
      app: {
        getShellState: () => Promise<ShellState>
      }
      window: {
        minimize: () => void
        close: () => void
      }
      assistant: {
        sendCommand: (
          request: AssistantCommandRequest
        ) => Promise<AssistantCommandResponse>
        executeAction: (
          request: AssistantActionExecutionRequest
        ) => Promise<AssistantActionExecutionResponse>
      }
    }
  }
}

export {}
