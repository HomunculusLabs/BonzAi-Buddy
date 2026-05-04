import {
  BrowserWindow,
  dialog,
  type OpenDialogOptions
} from 'electron'
import { basename } from 'node:path'
import type { KnowledgeImportFolderSelection } from '../../shared/contracts/knowledge'
import { IPC_CHANNELS } from '../../shared/ipc-contracts'
import { handleInvoke, type IpcHandlerContext } from './ipc-handler-utils'

const knowledgeFolderSelections = new Map<
  string,
  KnowledgeImportFolderSelection[]
>()

export function registerSettingsIpcHandlers({
  assistantService
}: IpcHandlerContext): void {
  handleInvoke(IPC_CHANNELS.settings.getElizaPlugins, () => {
    return assistantService.getPluginSettings()
  })

  handleInvoke(
    IPC_CHANNELS.settings.updateElizaPlugins,
    async (_event, request) => {
      return assistantService.updatePluginSettings(request)
    }
  )

  handleInvoke(IPC_CHANNELS.settings.getAssistantProviderSettings, () => {
    return assistantService.getAssistantProviderSettings()
  })

  handleInvoke(
    IPC_CHANNELS.settings.updateAssistantProviderSettings,
    async (_event, request) => {
      return assistantService.updateAssistantProviderSettings(request)
    }
  )

  handleInvoke(
    IPC_CHANNELS.settings.listPiAiModelOptions,
    async (_event, request) => {
      return assistantService.listPiAiModelOptions(request)
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

  handleInvoke(IPC_CHANNELS.settings.getHermesRuntimeSettings, async () => {
    return assistantService.getHermesRuntimeSettings()
  })

  handleInvoke(
    IPC_CHANNELS.settings.updateHermesRuntimeSettings,
    async (_event, request) => {
      return assistantService.updateHermesRuntimeSettings(request)
    }
  )

  handleInvoke(IPC_CHANNELS.settings.getHermesModelAuthSettings, async () => {
    return assistantService.getHermesModelAuthSettings()
  })

  handleInvoke(
    IPC_CHANNELS.settings.updateHermesModelAuthSettings,
    async (_event, request) => {
      return assistantService.updateHermesModelAuthSettings(request)
    }
  )

  handleInvoke(IPC_CHANNELS.settings.checkHermesModelAuthStatus, async () => {
    return assistantService.checkHermesModelAuthStatus()
  })

  handleInvoke(IPC_CHANNELS.settings.checkHermesHealth, async (_event, request) => {
    return assistantService.checkHermesHealth(request)
  })

  handleInvoke(IPC_CHANNELS.settings.getRuntimeRoutingSettings, () => {
    return assistantService.getRuntimeRoutingSettings()
  })

  handleInvoke(
    IPC_CHANNELS.settings.updateRuntimeRoutingSettings,
    async (_event, request) => {
      return assistantService.updateRuntimeRoutingSettings(request)
    }
  )

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
}
