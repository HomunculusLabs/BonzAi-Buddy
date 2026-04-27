import {
  BrowserWindow,
  ipcMain,
  screen,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from 'electron'
import type { AssistantService } from './assistant'
import { buildShellState } from './shell-state'
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

function areFiniteBounds(bounds: WindowBounds): boolean {
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
    BrowserWindow.fromWebContents(event.sender)?.setPosition(
      Math.round(x),
      Math.round(y)
    )
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
