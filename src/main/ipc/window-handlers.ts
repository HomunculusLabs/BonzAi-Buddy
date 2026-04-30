import { BrowserWindow, screen } from 'electron'
import {
  IPC_CHANNELS,
  type WindowBounds
} from '../../shared/ipc-contracts'
import { handleInvoke, isFiniteNumber, onSend } from './ipc-handler-utils'

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

export function registerWindowIpcHandlers(): void {
  onSend(IPC_CHANNELS.window.minimize, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  onSend(IPC_CHANNELS.window.close, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  onSend(IPC_CHANNELS.window.focus, (event) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender)

    if (!targetWindow || targetWindow.isDestroyed()) {
      return
    }

    if (!targetWindow.isVisible()) {
      targetWindow.show()
    }

    targetWindow.focus()
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
}
