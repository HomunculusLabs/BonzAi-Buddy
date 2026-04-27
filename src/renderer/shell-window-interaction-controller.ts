const POST_BUBBLE_PASSTHROUGH_SUPPRESSION_MS = 1500
const RENDERER_MOUSE_IGNORE_LEASE_MS = 250
const EXPLICIT_INTERACTIVE_TARGET_SELECTOR =
  '.speech-bubble, .command-dock, .settings-panel'

export interface ShellWindowInteractionController {
  canInteractWithStageFromEvent(event: MouseEvent): boolean
  dispose(): void
  forceMouseEventsEnabled(): void
  handleShellBubbleVisibilityChange(visible: boolean): void
  setWindowDragging(dragging: boolean): void
  syncDesktopMouseEventMode(event: MouseEvent): void
}

export interface ShellWindowInteractionControllerOptions {
  hasVrmError(): boolean
  hitTestClientPoint(clientX: number, clientY: number): boolean | null
  isUiVisible(): boolean
  shellEl: HTMLElement
}

export function createShellWindowInteractionController(
  options: ShellWindowInteractionControllerOptions
): ShellWindowInteractionController {
  const { shellEl } = options
  let isWindowDragging = false
  let areMouseEventsIgnored: boolean | null = null
  let mouseIgnoreLeaseTimer: number | null = null
  let mouseIgnoreLeaseId = 0
  let mousePassthroughSuppressedUntilMs = 0

  const clearMouseIgnoreLeaseTimer = (): void => {
    if (mouseIgnoreLeaseTimer !== null) {
      window.clearTimeout(mouseIgnoreLeaseTimer)
      mouseIgnoreLeaseTimer = null
    }
  }

  const setMouseEventsIgnored = (ignored: boolean): void => {
    if (areMouseEventsIgnored === ignored || !window.bonzi) {
      return
    }

    areMouseEventsIgnored = ignored
    window.bonzi.window.setMouseEventsIgnored(ignored)
  }

  const forceMouseEventsEnabled = (): void => {
    mouseIgnoreLeaseId += 1
    clearMouseIgnoreLeaseTimer()
    setMouseEventsIgnored(false)
  }

  const isMousePassthroughSuppressed = (): boolean =>
    window.performance.now() < mousePassthroughSuppressedUntilMs

  const suppressMousePassthrough = (durationMs: number): void => {
    mousePassthroughSuppressedUntilMs = Math.max(
      mousePassthroughSuppressedUntilMs,
      window.performance.now() + durationMs
    )
    forceMouseEventsEnabled()
  }

  const requestMouseIgnoreLease = (): void => {
    if (isMousePassthroughSuppressed()) {
      forceMouseEventsEnabled()
      return
    }

    const leaseId = ++mouseIgnoreLeaseId
    setMouseEventsIgnored(true)
    clearMouseIgnoreLeaseTimer()
    mouseIgnoreLeaseTimer = window.setTimeout(() => {
      if (leaseId !== mouseIgnoreLeaseId) {
        return
      }

      mouseIgnoreLeaseTimer = null
      setMouseEventsIgnored(false)
    }, RENDERER_MOUSE_IGNORE_LEASE_MS)
  }

  const isExplicitInteractiveTarget = (target: EventTarget | null): boolean =>
    target instanceof HTMLElement &&
    Boolean(target.closest(EXPLICIT_INTERACTIVE_TARGET_SELECTOR))

  const canInteractWithStageFromEvent = (event: MouseEvent): boolean => {
    if (options.isUiVisible() || options.hasVrmError()) {
      return true
    }

    return options.hitTestClientPoint(event.clientX, event.clientY) ?? true
  }

  return {
    canInteractWithStageFromEvent,
    dispose() {
      forceMouseEventsEnabled()
      clearMouseIgnoreLeaseTimer()
    },
    forceMouseEventsEnabled,
    handleShellBubbleVisibilityChange(visible) {
      if (visible) {
        forceMouseEventsEnabled()
        return
      }

      suppressMousePassthrough(POST_BUBBLE_PASSTHROUGH_SUPPRESSION_MS)
    },
    setWindowDragging(dragging) {
      isWindowDragging = dragging

      if (dragging) {
        forceMouseEventsEnabled()
      }
    },
    syncDesktopMouseEventMode(event) {
      if (
        options.isUiVisible() ||
        options.hasVrmError() ||
        isWindowDragging ||
        shellEl.classList.contains('shell--bubble-visible') ||
        isExplicitInteractiveTarget(event.target)
      ) {
        forceMouseEventsEnabled()
        return
      }

      if (isMousePassthroughSuppressed()) {
        forceMouseEventsEnabled()
        return
      }

      const hitTestResult = options.hitTestClientPoint(
        event.clientX,
        event.clientY
      )

      if (hitTestResult === false) {
        requestMouseIgnoreLease()
        return
      }

      forceMouseEventsEnabled()
    }
  }
}
