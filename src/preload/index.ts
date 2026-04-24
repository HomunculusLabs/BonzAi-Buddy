import { contextBridge, ipcRenderer } from 'electron'
import type {
  AssistantActionExecutionRequest,
  AssistantActionExecutionResponse,
  AssistantCommandRequest,
  AssistantCommandResponse,
  ShellState
} from '../shared/contracts'

const bonziApi = {
  app: {
    getShellState: (): Promise<ShellState> =>
      ipcRenderer.invoke('app:get-shell-state')
  },
  window: {
    minimize: (): void => ipcRenderer.send('window:minimize'),
    close: (): void => ipcRenderer.send('window:close')
  },
  assistant: {
    sendCommand: (
      request: AssistantCommandRequest
    ): Promise<AssistantCommandResponse> =>
      ipcRenderer.invoke('assistant:send-command', request),
    executeAction: (
      request: AssistantActionExecutionRequest
    ): Promise<AssistantActionExecutionResponse> =>
      ipcRenderer.invoke('assistant:execute-action', request)
  }
}

contextBridge.exposeInMainWorld('bonzi', bonziApi)
