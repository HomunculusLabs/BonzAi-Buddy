import { BrowserWindow, ipcMain, screen } from 'electron'
import type { AssistantService } from './assistant'
import { buildShellState } from './shell-state'
import type {
  AssistantActionExecutionRequest,
  AssistantCommandRequest,
  AssistantMessage,
  ShellState,
  UpdateElizaPluginSettingsRequest
} from '../shared/contracts'

interface RegisterIpcHandlersOptions {
  assistantService: AssistantService
}

let handlersRegistered = false

function areFiniteBounds(bounds: {
  x: number
  y: number
  width: number
  height: number
}): boolean {
  return (
    Number.isFinite(bounds.x) &&
    Number.isFinite(bounds.y) &&
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height)
  )
}

export function registerIpcHandlers(
  options: RegisterIpcHandlersOptions
): void {
  if (handlersRegistered) {
    return
  }

  handlersRegistered = true
  const { assistantService } = options

  ipcMain.handle('app:get-shell-state', (): ShellState => {
    return buildShellState(
      assistantService.getProviderInfo(),
      assistantService.getStartupWarnings(),
      assistantService.getRuntimeStatus(),
      assistantService.getAvailableActionTypes()
    )
  })

  ipcMain.handle('settings:get-eliza-plugins', () => {
    return assistantService.getPluginSettings()
  })

  ipcMain.handle(
    'settings:update-eliza-plugins',
    async (_event, request: UpdateElizaPluginSettingsRequest) => {
      return assistantService.updatePluginSettings(request)
    }
  )

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

  ipcMain.on(
    'window:set-bounds',
    (
      event,
      bounds: {
        x: number
        y: number
        width: number
        height: number
      }
    ) => {
      const targetWindow = BrowserWindow.fromWebContents(event.sender)

      if (!targetWindow || !areFiniteBounds(bounds)) {
        return
      }

      const currentBounds = targetWindow.getBounds()
      const display = screen.getDisplayMatching(currentBounds)
      const { workArea } = display
      const width = Math.max(320, Math.round(bounds.width))
      const height = Math.min(
        workArea.height,
        Math.max(480, Math.round(bounds.height))
      )
      const x = Math.round(bounds.x)
      const y = Math.max(
        workArea.y,
        Math.min(Math.round(bounds.y), workArea.y + workArea.height - height)
      )

      targetWindow.setBounds({ x, y, width, height })
    }
  )

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

  ipcMain.handle('assistant:get-history', async (): Promise<AssistantMessage[]> => {
    return assistantService.getHistory()
  })

  ipcMain.handle('assistant:reset-conversation', async (): Promise<void> => {
    await assistantService.resetConversation()
  })
}
