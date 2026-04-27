import type { AssistantEvent } from '../shared/contracts'
import { mountAppDom } from './app-dom'
import { createAssistantCommandController } from './assistant-command-controller'
import { createAssistantEventController } from './assistant-event-controller'
import {
  createConversationController,
  type ConversationController
} from './conversation-controller'
import { createBubbleWindowLayoutController } from './bubble-window-layout'
import {
  createSettingsPanelController,
  type SettingsPanelController
} from './settings-panel-controller'
import { createShellStateController } from './shell-state-controller'
import { createVrmController } from './vrm-controller'
import { createWindowDragController } from './window-drag-controller'

const POST_BUBBLE_PASSTHROUGH_SUPPRESSION_MS = 1500
const RENDERER_MOUSE_IGNORE_LEASE_MS = 250

export function renderApp(root: HTMLDivElement): void {
  const searchParams = new URLSearchParams(window.location.search)
  const disableVrm = searchParams.get('bonziDisableVrm') === '1'
  const bubbleExpiryMs = parseOptionalNonNegativeNumber(
    searchParams.get('bonziBubbleExpiryMs')
  )

  const elements = mountAppDom(root)
  const {
    shellStateEl,
    settingsButton,
    settingsCloseButton,
    minimizeButton,
    closeButton,
    stageShellEl,
    shellEl,
    vrmStatusEl,
    vrmErrorEl,
    vrmRetryButton,
    vrmPathEl,
    chatLogEl,
    chatFormEl,
    chatInputEl,
    assistantSendButton,
    settingsPanelEl,
    approvalSettingsEl,
    pluginSettingsEl,
    settingsStatusEl,
    applyRuntimeChangesButton
  } = elements

  let hasVrmError = false
  let isWindowDragging = false
  let areMouseEventsIgnored: boolean | null = null
  let mouseIgnoreLeaseTimer: number | null = null
  let mouseIgnoreLeaseId = 0
  let mousePassthroughSuppressedUntilMs = 0
  let settingsPanelController: SettingsPanelController
  let conversationController: ConversationController

  const bubbleWindowLayout = createBubbleWindowLayoutController({
    bubbleExpiryMs,
    chatLogEl,
    onShellBubbleVisibilityChange: (visible) => {
      if (visible) {
        forceMouseEventsEnabled()
        return
      }

      suppressMousePassthrough(POST_BUBBLE_PASSTHROUGH_SUPPRESSION_MS)
    },
    shellEl
  })

  const syncBubbleWindowLayout = (): void => {
    const isUiVisible = conversationController.isUiVisible()

    settingsButton.hidden = !isUiVisible

    bubbleWindowLayout.sync({
      entries: conversationController.getEntries(),
      isUiVisible,
      isAwaitingAssistant: conversationController.isAwaitingAssistant(),
      hasVrmError
    })

    if (isUiVisible || hasVrmError) {
      forceMouseEventsEnabled()
    }
  }

  const shellStateController = createShellStateController({
    elements,
    onSyncApprovalSettings: (settings) => {
      settingsPanelController.syncApprovalSettings(settings)
    }
  })

  conversationController = createConversationController({
    chatLogEl,
    getApprovalsEnabled: () => settingsPanelController.isApprovalsEnabled(),
    onStateChanged: syncBubbleWindowLayout,
    onUiShown: () => {
      window.requestAnimationFrame(() => {
        chatInputEl.focus()
        chatInputEl.select()
      })
    }
  })

  settingsPanelController = createSettingsPanelController({
    elements: {
      settingsButton,
      settingsCloseButton,
      settingsPanelEl,
      approvalSettingsEl,
      pluginSettingsEl,
      settingsStatusEl,
      applyRuntimeChangesButton,
      shellEl
    },
    onOpenSettingsUi: () => {
      conversationController.setUiVisible(true)
    },
    onApplyShellState: (state) => {
      shellStateController.applyShellState(state)
    },
    onApprovalSettingsChanged: () => {},
    onApprovalsDisabled: async () => {
      conversationController.clearPendingConfirmations()
      await conversationController.autoRunPendingActionCards()
    },
    onConversationNeedsRender: () => {
      conversationController.render()
    }
  })

  const vrmController = createVrmController({
    disableVrm,
    elements,
    onErrorVisibilityChange: () => {
      hasVrmError = !vrmErrorEl.hidden
      syncBubbleWindowLayout()
    }
  })

  const commandController = createAssistantCommandController({
    chatFormEl,
    chatInputEl,
    assistantSendButton,
    conversationController,
    shellStateController
  })

  function clearMouseIgnoreLeaseTimer(): void {
    if (mouseIgnoreLeaseTimer !== null) {
      window.clearTimeout(mouseIgnoreLeaseTimer)
      mouseIgnoreLeaseTimer = null
    }
  }

  function setMouseEventsIgnored(ignored: boolean): void {
    if (areMouseEventsIgnored === ignored || !window.bonzi) {
      return
    }

    areMouseEventsIgnored = ignored
    window.bonzi.window.setMouseEventsIgnored(ignored)
  }

  function forceMouseEventsEnabled(): void {
    mouseIgnoreLeaseId += 1
    clearMouseIgnoreLeaseTimer()
    setMouseEventsIgnored(false)
  }

  function isMousePassthroughSuppressed(): boolean {
    return window.performance.now() < mousePassthroughSuppressedUntilMs
  }

  function suppressMousePassthrough(durationMs: number): void {
    mousePassthroughSuppressedUntilMs = Math.max(
      mousePassthroughSuppressedUntilMs,
      window.performance.now() + durationMs
    )
    forceMouseEventsEnabled()
  }

  function requestMouseIgnoreLease(): void {
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

  function canInteractWithStageFromEvent(event: MouseEvent): boolean {
    if (conversationController.isUiVisible() || vrmController.hasError()) {
      return true
    }

    return vrmController.hitTestClientPoint(event.clientX, event.clientY) ?? true
  }

  function isExplicitInteractiveTarget(target: EventTarget | null): boolean {
    return (
      target instanceof HTMLElement &&
      Boolean(target.closest('.speech-bubble, .command-dock, .settings-panel'))
    )
  }

  function syncDesktopMouseEventMode(event: MouseEvent): void {
    if (
      conversationController.isUiVisible() ||
      vrmController.hasError() ||
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

    const hitTestResult = vrmController.hitTestClientPoint(
      event.clientX,
      event.clientY
    )

    if (hitTestResult === false) {
      requestMouseIgnoreLease()
      return
    }

    forceMouseEventsEnabled()
  }

  const windowDragController = createWindowDragController({
    canStartDrag: canInteractWithStageFromEvent,
    onDragStateChange: (dragging) => {
      isWindowDragging = dragging

      if (dragging) {
        forceMouseEventsEnabled()
      }
    },
    stageShellEl
  })

  let assistantEventController: ReturnType<typeof createAssistantEventController> | null = null

  const loadVrm = async (): Promise<void> => {
    await vrmController.load(shellStateController.getShellState()?.vrmAssetPath)
  }

  const handleAssistantEvent = (event: AssistantEvent): void => {
    switch (event.type) {
      case 'runtime-status':
        shellStateController.syncRuntimeStatus(event.status)
        return
      case 'play-emote':
        vrmController.playOrQueueEmote(event.emoteId)
        return
      case 'workflow-run-updated':
        if (conversationController.applyWorkflowRunUpdate(event.run)) {
          conversationController.render()
        }
        return
    }
  }

  const handleMinimizeClick = (): void => {
    if (!window.bonzi) {
      return
    }

    window.bonzi.window.minimize()
  }

  const handleCloseClick = (): void => {
    if (!window.bonzi) {
      return
    }

    window.bonzi.window.close()
  }

  const handleStageDoubleClick = (event: MouseEvent): void => {
    if (event.target instanceof HTMLElement && event.target.closest('.speech-bubble')) {
      return
    }

    if (!canInteractWithStageFromEvent(event)) {
      return
    }

    event.preventDefault()

    const nextUiVisible = !conversationController.isUiVisible()

    if (!nextUiVisible) {
      settingsPanelController.setVisible(false)
    }

    conversationController.setUiVisible(nextUiVisible)
  }

  const handleWindowKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      settingsPanelController.setVisible(false)
      conversationController.setUiVisible(false)
    }
  }

  const handleVrmRetryClick = (): void => {
    void loadVrm()
  }

  const handleWindowMouseMove = (event: MouseEvent): void => {
    syncDesktopMouseEventMode(event)
  }

  minimizeButton.addEventListener('click', handleMinimizeClick)
  closeButton.addEventListener('click', handleCloseClick)
  stageShellEl.addEventListener('dblclick', handleStageDoubleClick)
  window.addEventListener('keydown', handleWindowKeydown)
  window.addEventListener('mousemove', handleWindowMouseMove)
  vrmRetryButton.addEventListener('click', handleVrmRetryClick)

  commandController.setInputEnabled(false)
  shellStateController.setAppReadyState('loading')
  conversationController.render()

  if (!window.bonzi) {
    const message = 'Bonzi preload bridge is unavailable. Restart the app after rebuilding.'
    shellStateController.setAppReadyState('error')
    shellStateEl.textContent = message
    vrmPathEl.textContent = 'Unavailable'
    shellStateController.setProviderLabel('Bridge unavailable')
    vrmStatusEl.textContent = 'Renderer blocked'
    vrmErrorEl.hidden = false
    vrmErrorEl.textContent = message
    vrmRetryButton.hidden = true
    settingsButton.disabled = true
    settingsCloseButton.disabled = true
    minimizeButton.disabled = true
    closeButton.disabled = true
    commandController.setInputEnabled(false)
    conversationController.appendSystemMessage(message)
    hasVrmError = !vrmErrorEl.hidden
    syncBubbleWindowLayout()
    return
  }

  assistantEventController = createAssistantEventController({
    onAssistantEvent: handleAssistantEvent
  })

  void (async () => {
    const [shellStateResult, historyResult] = await Promise.allSettled([
      window.bonzi.app.getShellState(),
      window.bonzi.assistant.getHistory()
    ])

    if (shellStateResult.status === 'rejected') {
      const message = `Failed to load shell state: ${String(shellStateResult.reason)}`
      shellStateController.setAppReadyState('error')
      shellStateEl.textContent = message
      vrmPathEl.textContent = 'Unavailable'
      vrmStatusEl.textContent = 'VRM failed to initialize'
      vrmErrorEl.hidden = false
      vrmErrorEl.textContent = message
      vrmRetryButton.hidden = true
      conversationController.appendSystemMessage(message)
      hasVrmError = !vrmErrorEl.hidden
      syncBubbleWindowLayout()
      return
    }

    shellStateController.applyShellState(shellStateResult.value)

    if (historyResult.status === 'fulfilled') {
      conversationController.hydrateConversation(historyResult.value)
    } else {
      conversationController.appendSystemMessage(
        `Failed to load assistant history: ${String(historyResult.reason)}`
      )
    }

    await settingsPanelController.hydratePluginSettings({
      preserveStatus: true,
      fallbackToSavedSettings: false
    })

    if (
      conversationController.getEntryCount() === 0 &&
      shellStateResult.value.assistant.warnings.length > 0
    ) {
      conversationController.appendSystemMessage(
        shellStateResult.value.assistant.warnings.join(' ')
      )
    }

    commandController.setInputEnabled(true)
    shellStateController.setAppReadyState('ready')
    void loadVrm()
  })().catch((error: unknown) => {
    const message = `Failed to hydrate Bonzi shell: ${String(error)}`
    shellStateController.setAppReadyState('error')
    shellStateEl.textContent = message
    vrmPathEl.textContent = 'Unavailable'
    vrmStatusEl.textContent = 'VRM failed to initialize'
    vrmErrorEl.hidden = false
    vrmErrorEl.textContent = message
    vrmRetryButton.hidden = true
    conversationController.appendSystemMessage(message)
    hasVrmError = !vrmErrorEl.hidden
    syncBubbleWindowLayout()
  })

  window.addEventListener(
    'beforeunload',
    () => {
      assistantEventController?.dispose()
      assistantEventController = null
      minimizeButton.removeEventListener('click', handleMinimizeClick)
      closeButton.removeEventListener('click', handleCloseClick)
      stageShellEl.removeEventListener('dblclick', handleStageDoubleClick)
      window.removeEventListener('keydown', handleWindowKeydown)
      window.removeEventListener('mousemove', handleWindowMouseMove)
      forceMouseEventsEnabled()
      vrmRetryButton.removeEventListener('click', handleVrmRetryClick)
      commandController.dispose()
      conversationController.dispose()
      bubbleWindowLayout.dispose()
      settingsPanelController.dispose()
      windowDragController.dispose()
      vrmController.dispose()
    },
    { once: true }
  )

  syncBubbleWindowLayout()
}

function parseOptionalNonNegativeNumber(value: string | null): number | undefined {
  if (value === null || value.trim() === '') {
    return undefined
  }

  const parsed = Number(value)

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}
