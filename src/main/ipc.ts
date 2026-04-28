import {
  BrowserWindow,
  dialog,
  ipcMain,
  screen,
  type IpcMainEvent,
  type OpenDialogOptions,
  type IpcMainInvokeEvent
} from 'electron'
import { basename } from 'node:path'
import type { AssistantService } from './assistant'
import { buildShellState } from './shell-state'
import type { KnowledgeImportFolderSelection } from '../shared/contracts'
import {
  IPC_CHANNELS,
  type IpcInvokeArgs,
  type IpcInvokeChannel,
  type IpcInvokeResponse,
  type IpcSendArgs,
  type IpcSendChannel,
  type WindowBounds
} from '../shared/ipc-contracts'

interface RegisterIpcHandlersOptions {
  assistantService: AssistantService
}

let handlersRegistered = false

const MAIN_MOUSE_IGNORE_FAILSAFE_MS = 750
const mouseIgnoreResetTimers = new WeakMap<
  BrowserWindow,
  ReturnType<typeof setTimeout>
>()
const knowledgeFolderSelections = new Map<string, KnowledgeImportFolderSelection[]>()

function clearMouseIgnoreResetTimer(targetWindow: BrowserWindow): void {
  const timer = mouseIgnoreResetTimers.get(targetWindow)

  if (!timer) {
    return
  }

  clearTimeout(timer)
  mouseIgnoreResetTimers.delete(targetWindow)
}

function applyMouseEventsIgnored(
  targetWindow: BrowserWindow,
  ignored: boolean
): void {
  clearMouseIgnoreResetTimer(targetWindow)

  if (!ignored) {
    targetWindow.setIgnoreMouseEvents(false)
    return
  }

  targetWindow.setIgnoreMouseEvents(true, { forward: true })

  const timer = setTimeout(() => {
    mouseIgnoreResetTimers.delete(targetWindow)

    if (targetWindow.isDestroyed()) {
      return
    }

    targetWindow.setIgnoreMouseEvents(false)
  }, MAIN_MOUSE_IGNORE_FAILSAFE_MS)

  mouseIgnoreResetTimers.set(targetWindow, timer)
}

function handleInvoke<Channel extends IpcInvokeChannel>(
  channel: Channel,
  listener: (
    event: IpcMainInvokeEvent,
    ...args: IpcInvokeArgs<Channel>
  ) => IpcInvokeResponse<Channel> | Promise<IpcInvokeResponse<Channel>>
): void {
  ipcMain.handle(
    channel,
    listener as (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  )
}

function onSend<Channel extends IpcSendChannel>(
  channel: Channel,
  listener: (event: IpcMainEvent, ...args: IpcSendArgs<Channel>) => void
): void {
  ipcMain.on(
    channel,
    listener as (event: IpcMainEvent, ...args: unknown[]) => void
  )
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function areFiniteBounds(bounds: unknown): bounds is WindowBounds {
  return (
    typeof bounds === 'object' &&
    bounds !== null &&
    isFiniteNumber((bounds as WindowBounds).x) &&
    isFiniteNumber((bounds as WindowBounds).y) &&
    isFiniteNumber((bounds as WindowBounds).width) &&
    isFiniteNumber((bounds as WindowBounds).height)
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

  handleInvoke(IPC_CHANNELS.app.getShellState, () => {
    return buildShellState(
      assistantService.getProviderInfo(),
      assistantService.getStartupWarnings(),
      assistantService.getRuntimeStatus(),
      assistantService.getAvailableActionTypes(),
      assistantService.getRuntimeApprovalSettings()
    )
  })

  handleInvoke(IPC_CHANNELS.settings.getElizaPlugins, () => {
    return assistantService.getPluginSettings()
  })

  handleInvoke(IPC_CHANNELS.plugins.discover, async (_event, request) => {
    return assistantService.discoverPlugins(request)
  })

  handleInvoke(
    IPC_CHANNELS.settings.updateElizaPlugins,
    async (_event, request) => {
      return assistantService.updatePluginSettings(request)
    }
  )

  handleInvoke(IPC_CHANNELS.settings.getRuntimeApprovalSettings, () => {
    return assistantService.getRuntimeApprovalSettings()
  })

  handleInvoke(
    IPC_CHANNELS.settings.updateRuntimeApprovalSettings,
    async (_event, request) => {
      return assistantService.updateRuntimeApprovalSettings(request)
    }
  )

  handleInvoke(IPC_CHANNELS.settings.getElizaCharacterSettings, () => {
    return assistantService.getCharacterSettings()
  })

  handleInvoke(
    IPC_CHANNELS.settings.updateElizaCharacterSettings,
    async (_event, request) => {
      return assistantService.updateCharacterSettings(request)
    }
  )

  handleInvoke(
    IPC_CHANNELS.settings.importKnowledgeDocuments,
    async (_event, request) => {
      return assistantService.importKnowledgeDocuments(request)
    }
  )

  handleInvoke(
    IPC_CHANNELS.settings.selectKnowledgeImportFolders,
    async (event) => {
      const targetWindow = BrowserWindow.fromWebContents(event.sender)
      const dialogOptions: OpenDialogOptions = {
        properties: ['openDirectory', 'multiSelections'],
        title: 'Choose Markdown knowledge folders'
      }
      const result = targetWindow
        ? await dialog.showOpenDialog(targetWindow, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions)

      if (result.canceled) {
        return {
          ok: true,
          cancelled: true,
          folders: [],
          message: 'Folder selection cancelled.'
        }
      }

      const folders = result.filePaths.map((folderPath) => ({
        path: folderPath,
        name: basename(folderPath) || folderPath
      }))
      const selectionId = crypto.randomUUID()
      knowledgeFolderSelections.set(selectionId, folders)

      return {
        ok: true,
        cancelled: false,
        folders,
        selectionId,
        message: `${result.filePaths.length} folder${result.filePaths.length === 1 ? '' : 's'} selected.`
      }
    }
  )

  handleInvoke(
    IPC_CHANNELS.settings.importKnowledgeFolders,
    async (_event, request) => {
      if (request.folderSelectionId) {
        const folders = knowledgeFolderSelections.get(request.folderSelectionId)
        knowledgeFolderSelections.delete(request.folderSelectionId)

        if (!folders) {
          const status = await assistantService.getKnowledgeImportStatus()
          return {
            ok: false,
            status,
            message: 'Choose folders again before starting a knowledge import.',
            error: 'Knowledge folder selection was not found or has expired.'
          }
        }

        return assistantService.startKnowledgeFolderImport({
          folderPaths: folders.map((folder) => folder.path)
        })
      }

      if (
        (process.env.BONZI_E2E_MODE === '1' ||
          process.env.BONZI_E2E_ALLOW_RAW_KNOWLEDGE_FOLDER_PATHS === '1') &&
        Array.isArray(request.folderPaths)
      ) {
        return assistantService.startKnowledgeFolderImport({
          folderPaths: request.folderPaths
        })
      }

      const status = await assistantService.getKnowledgeImportStatus()
      return {
        ok: false,
        status,
        message: 'Use the folder picker before starting a knowledge import.',
        error: 'Folder import paths must come from the main-process folder picker.'
      }
    }
  )

  handleInvoke(
    IPC_CHANNELS.settings.cancelKnowledgeImport,
    async (_event, request) => {
      return assistantService.cancelKnowledgeImport(request)
    }
  )

  handleInvoke(IPC_CHANNELS.settings.getKnowledgeImportStatus, async () => {
    return assistantService.getKnowledgeImportStatus()
  })

  handleInvoke(IPC_CHANNELS.settings.getWorkspaceSettings, async () => {
    return assistantService.getWorkspaceSettings()
  })

  handleInvoke(IPC_CHANNELS.settings.selectWorkspaceFolder, async (event) => {
    const currentSettings = await assistantService.getWorkspaceSettings()

    if (currentSettings.envLocked) {
      return {
        ok: false,
        cancelled: false,
        settings: currentSettings,
        message: 'Workspace folder is controlled by BONZI_WRITABLE_WORKSPACE_DIR.',
        error: 'Unset BONZI_WRITABLE_WORKSPACE_DIR before changing this in Settings.'
      }
    }

    const targetWindow = BrowserWindow.fromWebContents(event.sender)
    const dialogOptions: OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose Bonzi writable workspace folder',
      defaultPath: currentSettings.workspaceDir
    }
    const result = targetWindow
      ? await dialog.showOpenDialog(targetWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled || result.filePaths.length === 0) {
      return {
        ok: true,
        cancelled: true,
        settings: currentSettings,
        message: 'Workspace folder selection cancelled.'
      }
    }

    try {
      const settings = await assistantService.setWorkspaceFolder(result.filePaths[0])
      return {
        ok: true,
        cancelled: false,
        settings,
        message: `Workspace folder set to ${settings.workspaceDir}.`
      }
    } catch (error) {
      return {
        ok: false,
        cancelled: false,
        settings: await assistantService.getWorkspaceSettings(),
        message: 'Failed to update workspace folder.',
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  handleInvoke(IPC_CHANNELS.settings.resetWorkspaceFolder, async () => {
    try {
      const settings = await assistantService.resetWorkspaceFolder()
      return {
        ok: true,
        settings,
        message: `Workspace folder reset to ${settings.workspaceDir}.`
      }
    } catch (error) {
      return {
        ok: false,
        settings: await assistantService.getWorkspaceSettings(),
        message: 'Failed to reset workspace folder.',
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  handleInvoke(IPC_CHANNELS.plugins.install, async (_event, request) => {
    return assistantService.installPlugin(request)
  })

  handleInvoke(IPC_CHANNELS.plugins.uninstall, async (_event, request) => {
    return assistantService.uninstallPlugin(request)
  })

  onSend(IPC_CHANNELS.window.minimize, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  onSend(IPC_CHANNELS.window.close, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  handleInvoke(IPC_CHANNELS.window.getBounds, (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.getBounds() ?? null
  })

  onSend(IPC_CHANNELS.window.setPosition, (event, x, y) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender)

    if (!targetWindow || !isFiniteNumber(x) || !isFiniteNumber(y)) {
      return
    }

    targetWindow.setPosition(Math.round(x), Math.round(y))
  })

  onSend(IPC_CHANNELS.window.setMouseEventsIgnored, (event, ignored) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender)

    if (!targetWindow) {
      return
    }

    applyMouseEventsIgnored(targetWindow, ignored)
  })

  onSend(IPC_CHANNELS.window.setBounds, (event, bounds) => {
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
  })

  handleInvoke(IPC_CHANNELS.assistant.sendCommand, async (_event, request) => {
    return assistantService.sendCommand(request)
  })

  handleInvoke(IPC_CHANNELS.assistant.executeAction, async (_event, request) => {
    return assistantService.executeAction(request)
  })

  handleInvoke(IPC_CHANNELS.assistant.getHistory, async () => {
    return assistantService.getHistory()
  })

  handleInvoke(IPC_CHANNELS.assistant.resetConversation, async () => {
    await assistantService.resetConversation()
  })

  handleInvoke(IPC_CHANNELS.assistant.reloadRuntime, async () => {
    return assistantService.reloadRuntime()
  })

  handleInvoke(IPC_CHANNELS.assistant.getWorkflowRuns, () => {
    return assistantService.getWorkflowRuns()
  })

  handleInvoke(IPC_CHANNELS.assistant.getWorkflowRun, (_event, id) => {
    if (typeof id !== 'string' || !id.trim()) {
      return null
    }

    return assistantService.getWorkflowRun(id)
  })

  handleInvoke(
    IPC_CHANNELS.assistant.respondWorkflowApproval,
    async (_event, request) => {
      return assistantService.respondWorkflowApproval(request)
    }
  )

  handleInvoke(IPC_CHANNELS.assistant.cancelWorkflow, async (_event, request) => {
    return assistantService.cancelWorkflowRun(request)
  })
}
