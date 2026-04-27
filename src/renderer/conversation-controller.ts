import {
  type AssistantCommandResponse,
  type AssistantMessage,
  type AssistantTurnEventPayload,
  type BonziWorkflowRunSnapshot
} from '../shared/contracts'
import {
  addAssistantTurn as addAssistantResponseEntry,
  applyActionUpdate,
  conversationEntriesFromHistory,
  createMessage,
  renderConversation,
  type ConversationEntry
} from './conversation-view'

export interface ConversationController {
  getEntries(): ConversationEntry[]
  getEntryCount(): number
  isUiVisible(): boolean
  isAwaitingAssistant(): boolean
  render(): void
  setUiVisible(visible: boolean): void
  setAwaitingAssistant(awaiting: boolean): void
  hydrateConversation(messages: AssistantMessage[]): void
  addUserMessage(content: string): void
  addAssistantResponse(response: AssistantCommandResponse): void
  addAssistantTurn(turn: AssistantTurnEventPayload): void
  applyActionUpdate(action: AssistantTurnEventPayload['actions'][number]): void
  appendSystemMessage(content: string): void
  clearPendingConfirmations(): void
  applyWorkflowRunUpdate(run: BonziWorkflowRunSnapshot): boolean
  autoRunPendingActionCards(): Promise<void>
  dispose(): void
}

export interface ConversationControllerOptions {
  chatLogEl: HTMLElement
  getApprovalsEnabled(): boolean
  onStateChanged(): void
  onUiShown?(): void
}

export function createConversationController(
  options: ConversationControllerOptions
): ConversationController {
  const { chatLogEl } = options
  const conversation: ConversationEntry[] = []
  const workflowRunsById = new Map<string, BonziWorkflowRunSnapshot>()
  const pendingConfirmations = new Set<string>()
  let isUiVisible = false
  let isAwaitingAssistant = false

  const render = (): void => {
    renderConversation(chatLogEl, conversation, pendingConfirmations, {
      isAwaitingAssistant,
      isUiVisible,
      approvalsEnabled: options.getApprovalsEnabled()
    })
    options.onStateChanged()
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

  const appendSystemMessage = (content: string): void => {
    conversation.push({
      message: createMessage('system', content),
      actions: [],
      warnings: []
    })
    render()
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

        if (response.workflowRun) {
          applyWorkflowRunUpdate(response.workflowRun)
        }
      } catch (error) {
        appendSystemMessage(`Action failed: ${String(error)}`)
      }
    }

    render()
  }

  const handleChatLogClick = async (event: MouseEvent): Promise<void> => {
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
            render()
          }
        }

        if (!response.ok) {
          appendSystemMessage(response.message)
        }
      } catch (error) {
        appendSystemMessage(`Workflow approval failed: ${String(error)}`)
      } finally {
        render()
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
            render()
          }
        }

        if (!response.ok) {
          appendSystemMessage(response.message)
        }
      } catch (error) {
        appendSystemMessage(`Workflow cancel failed: ${String(error)}`)
      } finally {
        render()
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

      if (response.workflowRun) {
        applyWorkflowRunUpdate(response.workflowRun)
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
      render()
    }
  }

  chatLogEl.addEventListener('click', handleChatLogClick)

  return {
    getEntries: () => conversation,
    getEntryCount: () => conversation.length,
    isUiVisible: () => isUiVisible,
    isAwaitingAssistant: () => isAwaitingAssistant,
    render,
    setUiVisible: (visible) => {
      isUiVisible = visible
      render()

      if (visible) {
        options.onUiShown?.()
      }
    },
    setAwaitingAssistant: (awaiting) => {
      isAwaitingAssistant = awaiting
      render()
    },
    hydrateConversation: (messages) => {
      conversation.splice(
        0,
        conversation.length,
        ...conversationEntriesFromHistory(messages)
      )
      render()
    },
    addUserMessage: (content) => {
      conversation.push({
        message: createMessage('user', content),
        actions: [],
        warnings: []
      })
      render()
    },
    addAssistantResponse: (response) => {
      addAssistantResponseEntry(conversation, response)
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

      render()
    },
    addAssistantTurn: (turn) => {
      const workflowRun = turn.workflowRun
        ? rememberWorkflowRun(turn.workflowRun)
        : undefined
      conversation.push({
        message: turn.message,
        actions: turn.actions,
        warnings: turn.warnings,
        workflowRun
      })
      render()
    },
    applyActionUpdate: (action) => {
      applyActionUpdate(conversation, action)
      pendingConfirmations.delete(action.id)
    },
    appendSystemMessage,
    clearPendingConfirmations: () => {
      pendingConfirmations.clear()
    },
    applyWorkflowRunUpdate,
    autoRunPendingActionCards,
    dispose: () => {
      chatLogEl.removeEventListener('click', handleChatLogClick)
    }
  }
}
