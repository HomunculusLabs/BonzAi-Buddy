import { app, BrowserWindow } from 'electron'
import {
  createAssistantService,
  type AssistantService
} from './assistant'
import { registerIpcHandlers } from './ipc'
import { buildShellState } from './shell-state'
import { createCompanionWindow } from './window'

if (process.env.BONZI_USER_DATA_DIR?.trim()) {
  app.setPath('userData', process.env.BONZI_USER_DATA_DIR)
}

if (process.env.BONZI_DISABLE_GPU === '1') {
  app.disableHardwareAcceleration()
}

let companionWindow: BrowserWindow | null = null
let assistantService: AssistantService | null = null
let unsubscribeAssistantEvents: (() => void) | null = null

function getShellState() {
  if (!assistantService) {
    throw new Error('Assistant service is not initialized.')
  }

  return buildShellState(
    assistantService.getProviderInfo(),
    assistantService.getStartupWarnings(),
    assistantService.getRuntimeStatus(),
    assistantService.getAvailableActionTypes()
  )
}

function openCompanionWindow(): void {
  companionWindow = createCompanionWindow()

  companionWindow.on('closed', () => {
    if (companionWindow?.isDestroyed()) {
      companionWindow = null
    }
  })
}

app.whenReady().then(() => {
  assistantService = createAssistantService({
    getCompanionWindow: () => companionWindow,
    getShellState
  })

  unsubscribeAssistantEvents = assistantService.subscribe((event) => {
    if (!companionWindow || companionWindow.isDestroyed()) {
      return
    }

    companionWindow.webContents.send('assistant:event', event)
  })

  registerIpcHandlers({
    assistantService
  })

  void assistantService.getHistory().catch((error) => {
    console.error('Failed to warm Bonzi assistant runtime:', error)
  })

  openCompanionWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      openCompanionWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  unsubscribeAssistantEvents?.()
  unsubscribeAssistantEvents = null
  companionWindow = null

  if (assistantService) {
    void assistantService.dispose().catch((error) => {
      console.error('Failed to dispose Bonzi assistant service:', error)
    })
    assistantService = null
  }
})
