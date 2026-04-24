import { app, BrowserWindow } from 'electron'
import { registerIpcHandlers } from './ipc'
import { createCompanionWindow } from './window'

let companionWindow: BrowserWindow | null = null

function openCompanionWindow(): void {
  companionWindow = createCompanionWindow()
}

app.whenReady().then(() => {
  registerIpcHandlers(() => companionWindow)
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
  companionWindow = null
})
