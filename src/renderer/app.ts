import {
  type AssistantEvent,
  type AssistantEventEmoteId,
  type AssistantMessage,
  type AssistantRuntimeStatus,
  type BonziWorkflowRunSnapshot,
  type ShellState
} from '../shared/contracts'
import {
  shellStageForRuntimeStatus,
  shellStateMarkup
} from './app-shell-state'
import { mountAppDom } from './app-dom'
import { createBubbleWindowLayoutController } from './bubble-window-layout'
import {
  addAssistantTurn,
  applyActionUpdate,
  conversationEntriesFromHistory,
  createMessage,
  renderConversation,
  type ConversationEntry
} from './conversation-view'
import { createSettingsPanelController } from './settings-panel-controller'
import { createVrmStage, type VrmStageController } from './vrm-stage'
import { createWindowDragController } from './window-drag-controller'

type AppReadyState = 'loading' | 'ready' | 'error'

export function renderApp(root: HTMLDivElement): void {
  const disableVrm =
    new URLSearchParams(window.location.search).get('bonziDisableVrm') === '1'

  const {
    shellStateEl,
    settingsButton,
    settingsCloseButton,
    minimizeButton,
    closeButton,
    vrmCanvas,
    stageShellEl,
    shellEl,
    vrmStatusEl,
    vrmErrorEl,
    vrmRetryButton,
    vrmPathEl,
    providerLabelEl,
    providerPillEl,
    chatLogEl,
    chatFormEl,
    chatInputEl,
    assistantSendButton,
    settingsPanelEl,
    approvalSettingsEl,
    pluginSettingsEl,
    settingsStatusEl,
    applyRuntimeChangesButton
  } = mountAppDom(root)

  const setAssistantInputEnabled = (enabled: boolean): void => {
    chatInputEl.disabled = !enabled
    assistantSendButton.disabled = !enabled
  }

  const setAppReadyState = (state: AppReadyState): void => {
    shellEl.dataset.appReady = state
  }


  let shellState: ShellState | null = null
  const conversation: ConversationEntry[] = []
  const workflowRunsById = new Map<string, BonziWorkflowRunSnapshot>()
  const pendingConfirmations = new Set<string>()
  let isUiVisible = false
  let isAwaitingAssistant = false
  let pendingStageEmote: AssistantEventEmoteId | null = null
  let pendingRuntimeStatus: AssistantRuntimeStatus | null = null
  let unsubscribeAssistantEvents: (() => void) | null = null

  const bubbleWindowLayout = createBubbleWindowLayoutController({
    chatLogEl,
    shellEl
  })

  const syncBubbleWindowLayout = (): void => {
    bubbleWindowLayout.sync({
      entries: conversation,
      isUiVisible,
      isAwaitingAssistant,
      hasVrmError: !vrmErrorEl.hidden
    })
  }

  setAssistantInputEnabled(false)
  setAppReadyState('loading')

  renderConversation(chatLogEl, conversation, pendingConfirmations, {
    isAwaitingAssistant,
    isUiVisible,
    approvalsEnabled: true
  })
  const setUiVisible = (visible: boolean): void => {
    isUiVisible = visible
    rerenderConversation()

    if (visible) {
      window.requestAnimationFrame(() => {
        chatInputEl.focus()
        chatInputEl.select()
      })
    }
  }

  const rerenderConversation = (): void => {
    renderConversation(chatLogEl, conversation, pendingConfirmations, {
      isAwaitingAssistant,
      isUiVisible,
      approvalsEnabled: settingsPanelController.isApprovalsEnabled()
    })
    syncBubbleWindowLayout()
  }

  const rememberWorkflowRun = (
    run: BonziWorkflowRunSnapshot
  ): BonziWorkflowRunSnapshot => {
    const existing = workflowRunsById.get(run.id)

    if (existing && existing.revision >= run.revision) {
      return existing
    }

    workflowRunsById.set(run.id, run)

    for (const entry of conversation) {
      if (entry.workflowRun?.id === run.id) {
        entry.workflowRun = run
      }
    }

    return run
  }

  const applyWorkflowRunUpdate = (run: BonziWorkflowRunSnapshot): boolean => {
    const existing = workflowRunsById.get(run.id)

    if (existing && existing.revision >= run.revision) {
      return false
    }

    rememberWorkflowRun(run)
    return true
  }

  const hydrateConversation = (messages: AssistantMessage[]): void => {
    conversation.splice(
      0,
      conversation.length,
      ...conversationEntriesFromHistory(messages)
    )
    rerenderConversation()
  }

  const setProviderLabel = (label: string): void => {
    providerLabelEl.textContent = label
    providerPillEl.textContent = label
  }

  const applyShellState = (state: ShellState): void => {
    const nextState =
      pendingRuntimeStatus === null
        ? state
        : {
            ...state,
            stage: shellStageForRuntimeStatus(pendingRuntimeStatus),
            assistant: {
              ...state.assistant,
              runtime: pendingRuntimeStatus
            }
          }

    shellState = nextState
    settingsPanelController.syncApprovalSettings(nextState.assistant.approvals)
    shellStateEl.textContent = shellStateMarkup(nextState)
    vrmPathEl.textContent = nextState.vrmAssetPath
    setProviderLabel(nextState.assistant.provider.label)
  }


  const syncRuntimeStatus = (status: AssistantRuntimeStatus): void => {
    pendingRuntimeStatus = status

    if (!shellState) {
      return
    }

    applyShellState({
      ...shellState,
      stage: shellStageForRuntimeStatus(status),
      assistant: {
        ...shellState.assistant,
        runtime: status
      }
    })
  }

  const vrmStage: VrmStageController = disableVrm
    ? {
        dispose: () => {},
        load: async () => {
          vrmStatusEl.textContent = 'VRM disabled for automated tests'
          vrmErrorEl.hidden = true
          vrmErrorEl.textContent = ''
          vrmRetryButton.hidden = true
        },
        playBuiltInEmote: () => false
      }
    : createVrmStage(vrmCanvas, {
        onStatusChange: (message) => {
          vrmStatusEl.textContent = message
        },
        onErrorChange: (message) => {
          if (!message) {
            vrmErrorEl.hidden = true
            vrmErrorEl.textContent = ''
            vrmRetryButton.hidden = true
            syncBubbleWindowLayout()
            return
          }

          vrmErrorEl.hidden = false
          vrmErrorEl.textContent = `VRM load error: ${message}`
          vrmRetryButton.hidden = false
          syncBubbleWindowLayout()
        }
      })

  if (disableVrm) {
    vrmStatusEl.textContent = 'VRM disabled for automated tests'
    vrmErrorEl.hidden = true
    vrmErrorEl.textContent = ''
    vrmRetryButton.hidden = true
  }

  const flushPendingStageEmote = (): void => {
    if (!pendingStageEmote) {
      return
    }

    if (vrmStage.playBuiltInEmote(pendingStageEmote)) {
      pendingStageEmote = null
    }
  }

  const handleAssistantEvent = (event: AssistantEvent): void => {
    switch (event.type) {
      case 'runtime-status':
        syncRuntimeStatus(event.status)
        return
      case 'play-emote':
        if (disableVrm) {
          return
        }

        if (vrmStage.playBuiltInEmote(event.emoteId)) {
          pendingStageEmote = null
          return
        }

        pendingStageEmote = event.emoteId
        return
      case 'workflow-run-updated':
        if (applyWorkflowRunUpdate(event.run)) {
          rerenderConversation()
        }
        return
    }
  }

  const loadVrm = async (): Promise<void> => {
    if (!shellState) {
      return
    }

    try {
      await vrmStage.load(shellState.vrmAssetPath)

      if (!disableVrm) {
        flushPendingStageEmote()
      }
    } catch {
      // UI/error state is already updated inside the stage controller.
    }
  }

  const appendSystemMessage = (content: string): void => {
    conversation.push({
      message: createMessage('system', content),
      actions: [],
      warnings: []
    })
    rerenderConversation()
  }

  const autoRunPendingActionCards = async (): Promise<void> => {
    if (!window.bonzi) {
      return
    }

    const pendingActions = conversation.flatMap((entry) =>
      entry.actions.filter(
        (action) =>
          action.status === 'pending' || action.status === 'needs_confirmation'
      )
    )

    for (const action of pendingActions) {
      try {
        const response = await window.bonzi.assistant.executeAction({
          actionId: action.id,
          confirmed: true
        })

        if (response.action) {
          applyActionUpdate(conversation, response.action)
        }
      } catch (error) {
        appendSystemMessage(`Action failed: ${String(error)}`)
      }
    }

    rerenderConversation()
  }


  const settingsPanelController = createSettingsPanelController({
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
      setUiVisible(true)
    },
    onApplyShellState: (state) => {
      applyShellState(state)
    },
    onApprovalSettingsChanged: () => {},
    onApprovalsDisabled: async () => {
      pendingConfirmations.clear()
      await autoRunPendingActionCards()
    },
    onConversationNeedsRender: () => {
      rerenderConversation()
    }
  })

  minimizeButton.addEventListener('click', () => {
    if (!window.bonzi) {
      return
    }

    window.bonzi.window.minimize()
  })

  closeButton.addEventListener('click', () => {
    if (!window.bonzi) {
      return
    }

    window.bonzi.window.close()
  })

  chatFormEl.addEventListener('submit', async (event) => {
    event.preventDefault()

    if (!window.bonzi) {
      return
    }

    const command = chatInputEl.value.trim()

    if (!command) {
      return
    }

    const userMessage = createMessage('user', command)
    conversation.push({
      message: userMessage,
      actions: [],
      warnings: []
    })
    isAwaitingAssistant = true
    rerenderConversation()

    chatInputEl.value = ''
    setAssistantInputEnabled(false)

    try {
      const response = await window.bonzi.assistant.sendCommand({ command })

      setProviderLabel(response.provider.label)

      if (response.ok && response.reply) {
        addAssistantTurn(conversation, response)

        if (response.workflowRun) {
          const existingWorkflowRun = workflowRunsById.get(response.workflowRun.id)
          const latestWorkflowRun = rememberWorkflowRun(
            existingWorkflowRun && existingWorkflowRun.revision > response.workflowRun.revision
              ? existingWorkflowRun
              : response.workflowRun
          )
          const latestEntry = conversation.at(-1)

          if (latestEntry && !latestEntry.workflowRun) {
            latestEntry.workflowRun = latestWorkflowRun
          } else if (latestEntry?.workflowRun?.id === latestWorkflowRun.id) {
            latestEntry.workflowRun = latestWorkflowRun
          }
        }
      } else {
        appendSystemMessage(
          response.error ??
            'The assistant did not return a reply for this command.'
        )
      }

      isAwaitingAssistant = false
      rerenderConversation()
      setUiVisible(false)
    } catch (error) {
      isAwaitingAssistant = false
      appendSystemMessage(`Assistant request failed: ${String(error)}`)
    } finally {
      isAwaitingAssistant = false
      setAssistantInputEnabled(true)
      if (isUiVisible) {
        chatInputEl.focus()
      }
    }
  })

  chatLogEl.addEventListener('click', async (event) => {
    if (!window.bonzi) {
      return
    }

    const target = event.target

    if (!(target instanceof HTMLElement)) {
      return
    }

    const workflowApprovalButton = target.closest<HTMLButtonElement>(
      '[data-workflow-approve], [data-workflow-decline]'
    )

    if (workflowApprovalButton) {
      const runId = workflowApprovalButton.dataset.workflowRunId
      const stepId = workflowApprovalButton.dataset.workflowStepId
      const approved = workflowApprovalButton.hasAttribute('data-workflow-approve')

      if (!runId || !stepId) {
        return
      }

      const siblingButtons = chatLogEl.querySelectorAll<HTMLButtonElement>(
        '[data-workflow-run-id][data-workflow-step-id]'
      )
      siblingButtons.forEach((button) => {
        if (
          button.dataset.workflowRunId === runId &&
          button.dataset.workflowStepId === stepId
        ) {
          button.disabled = true
        }
      })

      try {
        const response = await window.bonzi.assistant.respondWorkflowApproval({
          runId,
          stepId,
          approved
        })

        if (response.run) {
          if (applyWorkflowRunUpdate(response.run)) {
            rerenderConversation()
          }
        }

        if (!response.ok) {
          appendSystemMessage(response.message)
        }
      } catch (error) {
        appendSystemMessage(`Workflow approval failed: ${String(error)}`)
      } finally {
        rerenderConversation()
      }

      return
    }

    const workflowCancelButton = target.closest<HTMLButtonElement>(
      '[data-workflow-cancel]'
    )

    if (workflowCancelButton) {
      const runId = workflowCancelButton.dataset.workflowRunId

      if (!runId) {
        return
      }

      workflowCancelButton.disabled = true

      try {
        const response = await window.bonzi.assistant.cancelWorkflowRun({ runId })

        if (response.run) {
          if (applyWorkflowRunUpdate(response.run)) {
            rerenderConversation()
          }
        }

        if (!response.ok) {
          appendSystemMessage(response.message)
        }
      } catch (error) {
        appendSystemMessage(`Workflow cancel failed: ${String(error)}`)
      } finally {
        rerenderConversation()
      }

      return
    }

    const actionButton = target.closest<HTMLButtonElement>('[data-action-id]')

    if (!actionButton) {
      return
    }

    const actionId = actionButton.dataset.actionId

    if (!actionId) {
      return
    }

    const isConfirmed = pendingConfirmations.has(actionId)
    actionButton.disabled = true

    try {
      const response = await window.bonzi.assistant.executeAction({
        actionId,
        confirmed: isConfirmed
      })

      if (response.action) {
        applyActionUpdate(conversation, response.action)
      }

      if (response.confirmationRequired) {
        pendingConfirmations.add(actionId)
      } else {
        pendingConfirmations.delete(actionId)
      }

      appendSystemMessage(response.message)
    } catch (error) {
      appendSystemMessage(`Action failed: ${String(error)}`)
    } finally {
      rerenderConversation()
    }
  })

  stageShellEl.addEventListener('dblclick', (event) => {
    if (event.target instanceof HTMLElement && event.target.closest('.speech-bubble')) {
      return
    }

    event.preventDefault()
    setUiVisible(!isUiVisible)
  })

  const windowDragController = createWindowDragController({ stageShellEl })

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      settingsPanelController.setVisible(false)
      setUiVisible(false)
    }
  })

  vrmRetryButton.addEventListener('click', () => {
    void loadVrm()
  })

  if (!window.bonzi) {
    const message = 'Bonzi preload bridge is unavailable. Restart the app after rebuilding.'
    setAppReadyState('error')
    shellStateEl.textContent = message
    vrmPathEl.textContent = 'Unavailable'
    setProviderLabel('Bridge unavailable')
    vrmStatusEl.textContent = 'Renderer blocked'
    vrmErrorEl.hidden = false
    vrmErrorEl.textContent = message
    vrmRetryButton.hidden = true
    settingsButton.disabled = true
    settingsCloseButton.disabled = true
    minimizeButton.disabled = true
    closeButton.disabled = true
    chatInputEl.disabled = true
    assistantSendButton.disabled = true
    appendSystemMessage(message)
    syncBubbleWindowLayout()
    return
  }

  unsubscribeAssistantEvents = window.bonzi.assistant.onEvent(handleAssistantEvent)

  void (async () => {
    const [shellStateResult, historyResult] = await Promise.allSettled([
      window.bonzi.app.getShellState(),
      window.bonzi.assistant.getHistory()
    ])

    if (shellStateResult.status === 'rejected') {
      const message = `Failed to load shell state: ${String(shellStateResult.reason)}`
      setAppReadyState('error')
      shellStateEl.textContent = message
      vrmPathEl.textContent = 'Unavailable'
      vrmStatusEl.textContent = 'VRM failed to initialize'
      vrmErrorEl.hidden = false
      vrmErrorEl.textContent = message
      vrmRetryButton.hidden = true
      appendSystemMessage(message)
      return
    }

    applyShellState(shellStateResult.value)

    if (historyResult.status === 'fulfilled') {
      hydrateConversation(historyResult.value)
    } else {
      appendSystemMessage(
        `Failed to load assistant history: ${String(historyResult.reason)}`
      )
    }

    await settingsPanelController.hydratePluginSettings({
      preserveStatus: true,
      fallbackToSavedSettings: false
    })

    if (
      conversation.length === 0 &&
      shellStateResult.value.assistant.warnings.length > 0
    ) {
      appendSystemMessage(shellStateResult.value.assistant.warnings.join(' '))
    }

    setAssistantInputEnabled(true)
    setAppReadyState('ready')
    void loadVrm()
  })().catch((error: unknown) => {
    const message = `Failed to hydrate Bonzi shell: ${String(error)}`
    setAppReadyState('error')
    shellStateEl.textContent = message
    vrmPathEl.textContent = 'Unavailable'
    vrmStatusEl.textContent = 'VRM failed to initialize'
    vrmErrorEl.hidden = false
    vrmErrorEl.textContent = message
    vrmRetryButton.hidden = true
    appendSystemMessage(message)
  })

  window.addEventListener(
    'beforeunload',
    () => {
      unsubscribeAssistantEvents?.()
      unsubscribeAssistantEvents = null
      bubbleWindowLayout.dispose()
      settingsPanelController.dispose()
      windowDragController.dispose()
      vrmStage.dispose()
    },
    { once: true }
  )

  syncBubbleWindowLayout()
}
