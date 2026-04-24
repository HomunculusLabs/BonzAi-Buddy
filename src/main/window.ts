import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

export function createCompanionWindow(): BrowserWindow {
  const companionWindow = new BrowserWindow({
    width: 380,
    height: 640,
    minWidth: 320,
    minHeight: 480,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    movable: true,
    fullscreenable: false,
    backgroundColor: '#00000000',
    title: 'Bonzi Desktop Companion',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  companionWindow.setAlwaysOnTop(true, 'floating')

  if (process.platform === 'darwin') {
    companionWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true
    })
    companionWindow.setWindowButtonVisibility(false)
  }

  if (app.isPackaged) {
    void companionWindow.loadFile(join(__dirname, '../renderer/index.html'))
  } else {
    void companionWindow.loadURL(
      process.env.ELECTRON_RENDERER_URL ?? 'http://127.0.0.1:5173'
    )
  }

  return companionWindow
}

