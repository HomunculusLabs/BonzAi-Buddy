import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CHANNELS,
  type BonziBridge,
  type IpcInvokeArgs,
  type IpcInvokeChannel,
  type IpcInvokeResponse,
  type IpcRendererEventArgs,
  type IpcRendererEventChannel,
  type IpcSendArgs,
  type IpcSendChannel
} from '../shared/ipc-contracts'

function invoke<Channel extends IpcInvokeChannel>(
  channel: Channel,
  ...args: IpcInvokeArgs<Channel>
): Promise<IpcInvokeResponse<Channel>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<IpcInvokeResponse<Channel>>
}

function send<Channel extends IpcSendChannel>(
  channel: Channel,
  ...args: IpcSendArgs<Channel>
): void {
  ipcRenderer.send(channel, ...args)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function onRendererEvent<Channel extends IpcRendererEventChannel>(
  channel: Channel,
  listener: (...args: IpcRendererEventArgs<Channel>) => void
): (() => void) {
  const handler = (
    _event: Electron.IpcRendererEvent,
    ...args: IpcRendererEventArgs<Channel>
  ): void => {
    listener(...args)
  }

  ipcRenderer.on(
    channel,
    handler as (event: Electron.IpcRendererEvent, ...args: unknown[]) => void
  )

  return (): void => {
    ipcRenderer.off(
      channel,
      handler as (event: Electron.IpcRendererEvent, ...args: unknown[]) => void
    )
  }
}

const bonziApi = {
  app: {
    getShellState: () => invoke(IPC_CHANNELS.app.getShellState)
  },
  settings: {
    getElizaPlugins: () => invoke(IPC_CHANNELS.settings.getElizaPlugins),
    updateElizaPlugins: (request) =>
      invoke(IPC_CHANNELS.settings.updateElizaPlugins, request),
    getRuntimeApprovalSettings: () =>
      invoke(IPC_CHANNELS.settings.getRuntimeApprovalSettings),
    updateRuntimeApprovalSettings: (request) =>
      invoke(IPC_CHANNELS.settings.updateRuntimeApprovalSettings, request),
    getElizaCharacterSettings: () =>
      invoke(IPC_CHANNELS.settings.getElizaCharacterSettings),
    updateElizaCharacterSettings: (request) =>
      invoke(IPC_CHANNELS.settings.updateElizaCharacterSettings, request),
    importKnowledgeDocuments: (request) =>
      invoke(IPC_CHANNELS.settings.importKnowledgeDocuments, request),
    getKnowledgeImportStatus: () =>
      invoke(IPC_CHANNELS.settings.getKnowledgeImportStatus)
  },
  plugins: {
    discover: (request) => invoke(IPC_CHANNELS.plugins.discover, request),
    install: (request) => invoke(IPC_CHANNELS.plugins.install, request),
    uninstall: (request) => invoke(IPC_CHANNELS.plugins.uninstall, request)
  },
  window: {
    getBounds: () => invoke(IPC_CHANNELS.window.getBounds),
    minimize: () => send(IPC_CHANNELS.window.minimize),
    close: () => send(IPC_CHANNELS.window.close),
    setPosition: (x, y) => {
      if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
        return
      }

      send(IPC_CHANNELS.window.setPosition, x, y)
    },
    setBounds: (bounds) => send(IPC_CHANNELS.window.setBounds, bounds),
    setMouseEventsIgnored: (ignored) =>
      send(IPC_CHANNELS.window.setMouseEventsIgnored, ignored)
  },
  assistant: {
    sendCommand: (request) =>
      invoke(IPC_CHANNELS.assistant.sendCommand, request),
    executeAction: (request) =>
      invoke(IPC_CHANNELS.assistant.executeAction, request),
    getHistory: () => invoke(IPC_CHANNELS.assistant.getHistory),
    resetConversation: () =>
      invoke(IPC_CHANNELS.assistant.resetConversation),
    reloadRuntime: () => invoke(IPC_CHANNELS.assistant.reloadRuntime),
    getWorkflowRuns: () => invoke(IPC_CHANNELS.assistant.getWorkflowRuns),
    getWorkflowRun: (id) => invoke(IPC_CHANNELS.assistant.getWorkflowRun, id),
    respondWorkflowApproval: (request) =>
      invoke(IPC_CHANNELS.assistant.respondWorkflowApproval, request),
    cancelWorkflowRun: (request) =>
      invoke(IPC_CHANNELS.assistant.cancelWorkflow, request),
    onEvent: (listener) =>
      onRendererEvent(IPC_CHANNELS.assistant.event, listener)
  }
} satisfies BonziBridge

contextBridge.exposeInMainWorld('bonzi', bonziApi)
