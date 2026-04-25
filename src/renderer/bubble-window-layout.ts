import {
  getActiveConversationEntry,
  hasPendingBubbleActions,
  type ConversationEntry
} from './conversation-view'

const BUBBLE_EXPIRY_MS = 12000
const BASE_WINDOW_HEIGHT = 640
const BUBBLE_WINDOW_TOP_MARGIN = 16
const BUBBLE_WINDOW_BOTTOM_SPACE = 356
const BUBBLE_TAIL_HEIGHT = 18
const WINDOW_RESIZE_EPSILON = 4

export interface BubbleWindowLayoutSyncArgs {
  entries: ConversationEntry[]
  isUiVisible: boolean
  isAwaitingAssistant: boolean
  hasVrmError: boolean
}

export interface BubbleWindowLayoutController {
  sync(args: BubbleWindowLayoutSyncArgs): void
  dispose(): void
}

export function createBubbleWindowLayoutController(options: {
  chatLogEl: HTMLElement
  shellEl: HTMLElement
}): BubbleWindowLayoutController {
  const { chatLogEl, shellEl } = options
  let isBubbleVisible = false
  let bubbleExpiryTimer: number | null = null
  let bubbleResizeFrame: number | null = null
  let lastArgs: BubbleWindowLayoutSyncArgs = {
    entries: [],
    isUiVisible: false,
    isAwaitingAssistant: false,
    hasVrmError: false
  }

  const clearBubbleExpiry = (): void => {
    if (bubbleExpiryTimer !== null) {
      window.clearTimeout(bubbleExpiryTimer)
      bubbleExpiryTimer = null
    }
  }

  const syncUiVisibility = (args: BubbleWindowLayoutSyncArgs): void => {
    shellEl.classList.toggle('shell--ui-hidden', !args.isUiVisible)
    shellEl.classList.toggle('shell--ui-active', args.isUiVisible)
    shellEl.classList.toggle(
      'shell--bubble-visible',
      args.isUiVisible ||
        isBubbleVisible ||
        args.isAwaitingAssistant ||
        args.hasVrmError
    )
  }

  const resizeWindowToFitBubble = async (): Promise<void> => {
    if (!window.bonzi) {
      return
    }

    const bounds = await window.bonzi.window.getBounds()

    if (!bounds) {
      return
    }

    const contentEl = chatLogEl.querySelector<HTMLElement>(
      '.bubble-entry__content'
    )
    contentEl?.classList.remove('bubble-entry__content--scrollable')
    contentEl?.style.removeProperty('max-height')

    const hasVisibleBubble =
      lastArgs.isUiVisible ||
      isBubbleVisible ||
      lastArgs.isAwaitingAssistant ||
      lastArgs.hasVrmError
    const visibleBubbleHeight = hasVisibleBubble
      ? Math.ceil(chatLogEl.scrollHeight + BUBBLE_TAIL_HEIGHT)
      : 0
    const reservedBubbleSpace =
      BUBBLE_WINDOW_TOP_MARGIN + BUBBLE_WINDOW_BOTTOM_SPACE
    const maxWindowHeight = Math.max(
      BASE_WINDOW_HEIGHT,
      Math.floor(window.screen.availHeight || BASE_WINDOW_HEIGHT)
    )
    let desiredHeight = Math.max(
      BASE_WINDOW_HEIGHT,
      visibleBubbleHeight + reservedBubbleSpace
    )

    if (desiredHeight > maxWindowHeight && contentEl) {
      const nonContentHeight = Math.max(
        0,
        visibleBubbleHeight - contentEl.scrollHeight
      )
      const maxContentHeight = Math.max(
        96,
        maxWindowHeight - reservedBubbleSpace - nonContentHeight
      )
      contentEl.style.maxHeight = `${maxContentHeight}px`
      contentEl.classList.add('bubble-entry__content--scrollable')
      desiredHeight = maxWindowHeight
    }

    if (Math.abs(bounds.height - desiredHeight) < WINDOW_RESIZE_EPSILON) {
      return
    }

    const bottom = bounds.y + bounds.height
    window.bonzi.window.setBounds({
      x: bounds.x,
      y: bottom - desiredHeight,
      width: bounds.width,
      height: desiredHeight
    })
  }

  const syncWindowBoundsToBubble = (): void => {
    if (!window.bonzi) {
      return
    }

    if (bubbleResizeFrame !== null) {
      window.cancelAnimationFrame(bubbleResizeFrame)
    }

    bubbleResizeFrame = window.requestAnimationFrame(() => {
      bubbleResizeFrame = null
      void resizeWindowToFitBubble()
    })
  }

  const refreshBubbleVisibility = (
    args: BubbleWindowLayoutSyncArgs
  ): void => {
    clearBubbleExpiry()

    if (args.isAwaitingAssistant) {
      isBubbleVisible = true
      return
    }

    const activeEntry = getActiveConversationEntry(args.entries)

    if (!activeEntry) {
      isBubbleVisible = false
      return
    }

    isBubbleVisible = true

    if (args.isUiVisible || hasPendingBubbleActions(activeEntry)) {
      return
    }

    bubbleExpiryTimer = window.setTimeout(() => {
      if (lastArgs.isUiVisible || lastArgs.isAwaitingAssistant) {
        return
      }

      isBubbleVisible = false
      syncUiVisibility(lastArgs)
      syncWindowBoundsToBubble()
    }, BUBBLE_EXPIRY_MS)
  }

  return {
    sync(args) {
      lastArgs = args
      refreshBubbleVisibility(args)
      syncUiVisibility(args)
      syncWindowBoundsToBubble()
    },
    dispose() {
      clearBubbleExpiry()

      if (bubbleResizeFrame !== null) {
        window.cancelAnimationFrame(bubbleResizeFrame)
        bubbleResizeFrame = null
      }
    }
  }
}
