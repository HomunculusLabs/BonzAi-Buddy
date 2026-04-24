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
    getBounds: (): Promise<{
      x: number
      y: number
      width: number
      height: number
    } | null> => ipcRenderer.invoke('window:get-bounds'),
    minimize: (): void => ipcRenderer.send('window:minimize'),
    close: (): void => ipcRenderer.send('window:close'),
    setPosition: (x: number, y: number): void =>
      ipcRenderer.send('window:set-position', x, y)
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
