import type { AssistantEvent } from '../shared/contracts/assistant'
import { mountAppDom } from './app-dom'
import { createAppHydrationController } from './app-hydration-controller'
import { createAppWindowControls } from './app-window-controls'
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
import { createShellWindowInteractionController } from './shell-window-interaction-controller'
import { createVrmController, type BuddyKind } from './vrm-controller'
import { createWindowDragController } from './window-drag-controller'

const BUDDY_KIND_STORAGE_KEY = 'bonzi.buddyKind'

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
    providerSettingsEl,
    characterSettingsEl,
    knowledgeSettingsEl,
    workspaceSettingsEl,
    hermesSettingsEl,
    routingSettingsEl,
    approvalSettingsEl,
    pluginSettingsEl,
    settingsStatusEl,
    buddySelectEl,
    applyRuntimeChangesButton
  } = elements

  let hasVrmError = false
  let settingsPanelController: SettingsPanelController
  let conversationController: ConversationController
  let shellWindowInteractionController: ReturnType<
    typeof createShellWindowInteractionController
  >
  let currentBuddyKind = readSavedBuddyKind()

  buddySelectEl.value = currentBuddyKind

  const bubbleWindowLayout = createBubbleWindowLayoutController({
    bubbleExpiryMs,
    chatLogEl,
    onShellBubbleVisibilityChange: (visible) => {
      shellWindowInteractionController.handleShellBubbleVisibilityChange(visible)
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
      shellWindowInteractionController.forceMouseEventsEnabled()
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
      providerSettingsEl,
      characterSettingsEl,
      knowledgeSettingsEl,
      workspaceSettingsEl,
      hermesSettingsEl,
      routingSettingsEl,
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

  let vrmController: ReturnType<typeof createVrmController>
  shellWindowInteractionController = createShellWindowInteractionController({
    hasVrmError: () => hasVrmError,
    hitTestClientPoint: (clientX, clientY) =>
      vrmController.hitTestClientPoint(clientX, clientY),
    isUiVisible: () => conversationController.isUiVisible(),
    shellEl
  })

  vrmController = createVrmController({
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

  const restoreChatInputIfVisible = (): void => {
    commandController.setInputEnabled(true)

    if (conversationController.isUiVisible()) {
      window.bonzi?.window.focus()
      window.requestAnimationFrame(() => {
        chatInputEl.focus()
      })
    }
  }

  const windowDragController = createWindowDragController({
    canStartDrag: shellWindowInteractionController.canInteractWithStageFromEvent,
    onDragStateChange: (dragging) => {
      vrmController.setDragging(dragging)
      shellWindowInteractionController.setWindowDragging(dragging)
    },
    stageShellEl
  })

  let assistantEventController: ReturnType<typeof createAssistantEventController> | null = null

  const windowControls = createAppWindowControls({
    minimizeButton,
    closeButton
  })

  const loadVrm = async (): Promise<void> => {
    await vrmController.load(
      shellStateController.getShellState()?.vrmAssetPath,
      currentBuddyKind
    )
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
        if (isTerminalWorkflowStatus(event.run.status)) {
          conversationController.setAwaitingAssistant(false)
          restoreChatInputIfVisible()
        }
        return
      case 'assistant-action-updated':
        conversationController.applyActionUpdate(event.action)
        conversationController.render()
        if (isTerminalAssistantActionStatus(event.action.status)) {
          conversationController.setAwaitingAssistant(false)
          restoreChatInputIfVisible()
        }
        return
      case 'assistant-turn-created':
        conversationController.addAssistantTurn(event.turn)
        conversationController.setAwaitingAssistant(false)
        restoreChatInputIfVisible()
        return
    }
  }

  const handleStageDoubleClick = (event: MouseEvent): void => {
    if (event.target instanceof HTMLElement && event.target.closest('.speech-bubble')) {
      return
    }

    if (!shellWindowInteractionController.canInteractWithStageFromEvent(event)) {
      return
    }

    event.preventDefault()
    vrmController.playDoubleClickAnimation()

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

  const handleChatLogClick = (event: MouseEvent): void => {
    const target = event.target

    if (!(target instanceof HTMLElement)) {
      return
    }

    if (
      target.closest(
        'button, a, input, textarea, select, [role="button"], [data-action-card], [data-workflow-run-id]'
      )
    ) {
      return
    }

    bubbleWindowLayout.dismiss()
  }

  const handleVrmRetryClick = (): void => {
    void loadVrm()
  }

  const handleBuddySelectChange = (): void => {
    const nextBuddyKind = normalizeBuddyKind(buddySelectEl.value)

    if (nextBuddyKind === currentBuddyKind) {
      return
    }

    currentBuddyKind = nextBuddyKind

    try {
      window.localStorage.setItem(BUDDY_KIND_STORAGE_KEY, currentBuddyKind)
    } catch {
      // Non-fatal: the selector can still switch for the current session.
    }

    void loadVrm()
  }

  const handleWindowMouseMove = (event: MouseEvent): void => {
    shellWindowInteractionController.syncDesktopMouseEventMode(event)
  }

  stageShellEl.addEventListener('dblclick', handleStageDoubleClick)
  chatLogEl.addEventListener('click', handleChatLogClick)
  window.addEventListener('keydown', handleWindowKeydown)
  window.addEventListener('mousemove', handleWindowMouseMove)
  vrmRetryButton.addEventListener('click', handleVrmRetryClick)
  buddySelectEl.addEventListener('change', handleBuddySelectChange)

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

  createAppHydrationController({
    shellStateEl,
    vrmPathEl,
    vrmStatusEl,
    vrmErrorEl,
    vrmRetryButton,
    getShellState: () => window.bonzi!.app.getShellState(),
    getAssistantHistory: () => window.bonzi!.assistant.getHistory(),
    applyShellState: shellStateController.applyShellState,
    hydrateConversation: conversationController.hydrateConversation,
    appendSystemMessage: conversationController.appendSystemMessage,
    getConversationEntryCount: conversationController.getEntryCount,
    hydrateProviderSettings: settingsPanelController.hydrateProviderSettings,
    hydrateCharacterSettings: settingsPanelController.hydrateCharacterSettings,
    hydrateKnowledgeSettings: settingsPanelController.hydrateKnowledgeSettings,
    hydratePluginSettings: settingsPanelController.hydratePluginSettings,
    setInputEnabled: commandController.setInputEnabled,
    setAppReadyState: shellStateController.setAppReadyState,
    syncBubbleWindowLayout: () => {
      hasVrmError = !vrmErrorEl.hidden
      syncBubbleWindowLayout()
    },
    loadVrm
  }).hydrate()

  window.addEventListener(
    'beforeunload',
    () => {
      assistantEventController?.dispose()
      assistantEventController = null
      windowControls.dispose()
      stageShellEl.removeEventListener('dblclick', handleStageDoubleClick)
      chatLogEl.removeEventListener('click', handleChatLogClick)
      window.removeEventListener('keydown', handleWindowKeydown)
      window.removeEventListener('mousemove', handleWindowMouseMove)
      shellWindowInteractionController.dispose()
      vrmRetryButton.removeEventListener('click', handleVrmRetryClick)
      buddySelectEl.removeEventListener('change', handleBuddySelectChange)
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

function isTerminalWorkflowStatus(status: string): boolean {
  return status === 'completed'
    || status === 'failed'
    || status === 'cancelled'
    || status === 'interrupted'
}

function isTerminalAssistantActionStatus(status: string): boolean {
  return status === 'completed' || status === 'failed'
}

function normalizeBuddyKind(value: string | null | undefined): BuddyKind {
  return value === 'jellyfish' ? 'jellyfish' : 'bonzi'
}

function readSavedBuddyKind(): BuddyKind {
  try {
    return normalizeBuddyKind(window.localStorage.getItem(BUDDY_KIND_STORAGE_KEY))
  } catch {
    return 'bonzi'
  }
}

function parseOptionalNonNegativeNumber(value: string | null): number | undefined {
  if (value === null || value.trim() === '') {
    return undefined
  }

  const parsed = Number(value)

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}
