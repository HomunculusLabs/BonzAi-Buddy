import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

export function createCompanionWindow(): BrowserWindow {
  const useTransparentWindow = process.env.BONZI_OPAQUE_WINDOW !== '1'
  const companionWindow = new BrowserWindow({
    width: 380,
    height: 640,
    minWidth: 320,
    minHeight: 480,
    transparent: useTransparentWindow,
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    movable: true,
    fullscreenable: false,
    hasShadow: false,
    backgroundColor: useTransparentWindow ? '#00000000' : '#161824',
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
    companionWindow.setHasShadow(false)
    companionWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true
    })
    companionWindow.setWindowButtonVisibility(false)

    if (useTransparentWindow) {
      const invalidateWindowShadow = (): void => {
        companionWindow.invalidateShadow()
      }

      companionWindow.once('ready-to-show', invalidateWindowShadow)
      companionWindow.webContents.on('did-finish-load', invalidateWindowShadow)
      companionWindow.on('resize', invalidateWindowShadow)
    }
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

