import { BrowserWindow, ipcMain } from 'electron'
import {
  createAssistantService,
  type AssistantService
} from './assistant'
import { buildShellState } from './shell-state'
import type {
  AssistantActionExecutionRequest,
  AssistantCommandRequest,
  ShellState
} from '../shared/contracts'

let handlersRegistered = false

export function registerIpcHandlers(
  getCompanionWindow: () => BrowserWindow | null
): void {
  if (handlersRegistered) {
    return
  }

  handlersRegistered = true
  let assistantService!: AssistantService

  assistantService = createAssistantService({
    getCompanionWindow,
    getShellState: (): ShellState =>
      buildShellState(
        assistantService.getProviderInfo(),
        assistantService.getStartupWarnings()
      )
  })

  ipcMain.handle('app:get-shell-state', (): ShellState => {
    return buildShellState(
      assistantService.getProviderInfo(),
      assistantService.getStartupWarnings()
    )
  })

  ipcMain.on('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.on('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.handle('window:get-bounds', (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.getBounds() ?? null
  })

  ipcMain.on('window:set-position', (event, x: number, y: number) => {
    BrowserWindow.fromWebContents(event.sender)?.setPosition(
      Math.round(x),
      Math.round(y)
    )
  })

  ipcMain.handle(
    'assistant:send-command',
    async (
      _event,
      request: AssistantCommandRequest
    ) => {
      return assistantService.sendCommand(request)
    }
  )

  ipcMain.handle(
    'assistant:execute-action',
    async (
      _event,
      request: AssistantActionExecutionRequest
    ) => {
      return assistantService.executeAction(request)
    }
  )
}
