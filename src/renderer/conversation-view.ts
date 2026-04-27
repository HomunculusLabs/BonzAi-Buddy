import type {
  AssistantAction,
  AssistantCommandResponse,
  AssistantMessage,
  BonziWorkflowRunSnapshot,
  BonziWorkflowStepSnapshot
} from '../shared/contracts'
import { escapeHtml } from './html-utils'

const EXAMPLE_COMMANDS = [
  'show shell state',
  'copy asset path',
  'minimize window',
  'close window'
]

const TERMINAL_WORKFLOW_RUN_STATUSES = new Set<BonziWorkflowRunSnapshot['status']>([
  'completed',
  'failed',
  'cancelled',
  'interrupted'
])

export interface ConversationEntry {
  message: AssistantMessage
  actions: AssistantAction[]
  warnings: string[]
  workflowRun?: BonziWorkflowRunSnapshot
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit'
  })
}

function labelForRole(role: AssistantMessage['role']): string {
  switch (role) {
    case 'assistant':
      return 'Bonzi'
    case 'user':
      return 'You'
    case 'system':
      return 'Update'
    default:
      return role
  }
}

function labelForWorkflowStatus(status: string): string {
  return status.replaceAll('_', ' ')
}

function isTerminalWorkflowRunStatus(status: BonziWorkflowRunSnapshot['status']): boolean {
  return TERMINAL_WORKFLOW_RUN_STATUSES.has(status)
}

function isCurrentWorkflowStep(step: BonziWorkflowStepSnapshot): boolean {
  return (
    step.status === 'running' ||
    step.status === 'awaiting_approval' ||
    step.status === 'awaiting_external_action' ||
    step.status === 'awaiting_user' ||
    step.status === 'cancel_requested'
  )
}

function getCurrentWorkflowStep(
  run: BonziWorkflowRunSnapshot
): BonziWorkflowStepSnapshot | null {
  return run.steps.find((step) => isCurrentWorkflowStep(step)) ?? null
}

function shouldRenderWorkflowRun(
  run: BonziWorkflowRunSnapshot | undefined
): run is BonziWorkflowRunSnapshot {
  return Boolean(run && run.steps.length > 0)
}

function renderWorkflowSummary(
  run: BonziWorkflowRunSnapshot,
  options: { approvalsEnabled: boolean }
): string {
  const completedCount = run.steps.filter((step) => step.status === 'completed').length
  const failedCount = run.steps.filter((step) => step.status === 'failed').length
  const awaitingApprovalCount = run.steps.filter(
    (step) => step.status === 'awaiting_approval'
  ).length
  const awaitingExternalActionCount = run.steps.filter(
    (step) => step.status === 'awaiting_external_action'
  ).length

  if (run.status === 'completed') {
    return `${completedCount}/${run.steps.length} steps completed`
  }

  if (run.status === 'failed') {
    return failedCount > 0
      ? `${failedCount} step${failedCount === 1 ? '' : 's'} failed`
      : run.error ?? 'Workflow failed'
  }

  if (run.status === 'cancelled') {
    return 'Workflow cancelled'
  }

  if (run.status === 'interrupted') {
    return 'Workflow interrupted'
  }

  if (awaitingExternalActionCount > 0) {
    return `Waiting for Bonzi action card to run${awaitingExternalActionCount === 1 ? '' : 's'}`
  }

  if (awaitingApprovalCount > 0 && !options.approvalsEnabled) {
    return 'Approvals disabled; continuing automatically'
  }

  if (awaitingApprovalCount > 0) {
    return `Waiting for approval on ${awaitingApprovalCount} step${awaitingApprovalCount === 1 ? '' : 's'}`
  }

  if (run.status === 'running') {
    return completedCount > 0
      ? `${completedCount}/${run.steps.length} steps finished; continuing workflow`
      : 'Workflow is running'
  }

  return completedCount > 0
    ? `${completedCount}/${run.steps.length} steps finished; workflow is not complete yet`
    : labelForWorkflowStatus(run.status)
}

function renderWorkflowRun(
  run: BonziWorkflowRunSnapshot,
  options: { approvalsEnabled: boolean }
): string {
  const currentStep = getCurrentWorkflowStep(run)
  const stepMarkup =
    run.steps.length === 0
      ? '<li class="workflow-card__step workflow-card__step--empty">No workflow steps were reported.</li>'
      : run.steps
          .map((step) => {
            const isCurrent = currentStep?.id === step.id
            const detail = step.detail ? `<p>${escapeHtml(step.detail)}</p>` : ''
            const approvalPrompt =
              step.status === 'awaiting_approval' && step.approvalPrompt
                ? `<p class="workflow-card__approval-prompt">${escapeHtml(step.approvalPrompt)}</p>`
                : ''
            const autoApprovalNote =
              step.status === 'awaiting_approval' && !options.approvalsEnabled
                ? '<p class="workflow-card__approval-prompt">Approvals are disabled. Bonzi will continue automatically when the runtime resumes this step.</p>'
                : ''
            const controls =
              step.status === 'awaiting_approval' && options.approvalsEnabled
                ? `
                    <div class="workflow-card__controls">
                      <button
                        class="ghost-button workflow-button workflow-button--approve"
                        type="button"
                        data-workflow-approve="true"
                        data-workflow-run-id="${escapeHtml(run.id)}"
                        data-workflow-step-id="${escapeHtml(step.id)}"
                      >
                        Approve
                      </button>
                      <button
                        class="ghost-button workflow-button workflow-button--decline"
                        type="button"
                        data-workflow-decline="true"
                        data-workflow-run-id="${escapeHtml(run.id)}"
                        data-workflow-step-id="${escapeHtml(step.id)}"
                      >
                        Decline
                      </button>
                    </div>
                  `
                : ''

            return `
              <li class="workflow-card__step${isCurrent ? ' workflow-card__step--current' : ''}">
                <div class="workflow-card__step-title-row">
                  <strong>${escapeHtml(step.title)}</strong>
                  <span class="workflow-card__step-status">${escapeHtml(labelForWorkflowStatus(step.status))}</span>
                </div>
                ${detail}
                ${approvalPrompt}
                ${autoApprovalNote}
                ${controls}
              </li>
            `
          })
          .join('')

  const cancelMarkup = isTerminalWorkflowRunStatus(run.status)
    ? ''
    : `
        <button
          class="ghost-button workflow-button workflow-button--cancel"
          type="button"
          data-workflow-cancel="true"
          data-workflow-run-id="${escapeHtml(run.id)}"
        >
          Cancel workflow
        </button>
      `

  return `
    <section class="workflow-card" data-workflow-card data-workflow-run-id="${escapeHtml(run.id)}">
      <header class="workflow-card__header">
        <strong>Workflow</strong>
        <span class="workflow-card__run-status">${escapeHtml(labelForWorkflowStatus(run.status))}</span>
      </header>
      <p class="workflow-card__summary">${escapeHtml(renderWorkflowSummary(run, options))}</p>
      ${
        currentStep
          ? `<p class="workflow-card__current">Current step: ${escapeHtml(currentStep.title)}</p>`
          : !isTerminalWorkflowRunStatus(run.status)
            ? '<p class="workflow-card__current">Bonzi is preparing the next step…</p>'
            : ''
      }
      ${run.error ? `<p class="workflow-card__error">${escapeHtml(run.error)}</p>` : ''}
      <ol class="workflow-card__steps">
        ${stepMarkup}
      </ol>
      ${cancelMarkup}
    </section>
  `
}

export function getActiveConversationEntry(
  entries: ConversationEntry[]
): ConversationEntry | null {
  if (entries.length === 0) {
    return null
  }

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    const hasPendingActions = entry.actions.some(
      (action) => action.status !== 'completed' && action.status !== 'failed'
    )
    const hasActiveWorkflowRun =
      shouldRenderWorkflowRun(entry.workflowRun) &&
      !isTerminalWorkflowRunStatus(entry.workflowRun.status)

    if (hasPendingActions || entry.warnings.length > 0 || hasActiveWorkflowRun) {
      return entry
    }
  }

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry.message.role !== 'user') {
      return entry
    }
  }

  return entries[entries.length - 1]
}

export function hasPendingBubbleActions(
  entry: ConversationEntry | null
): boolean {
  if (!entry) {
    return false
  }

  const hasPendingActions = entry.actions.some(
    (action) => action.status !== 'completed' && action.status !== 'failed'
  )
  const hasActiveWorkflowRun =
    shouldRenderWorkflowRun(entry.workflowRun) &&
    !isTerminalWorkflowRunStatus(entry.workflowRun.status)

  return hasPendingActions || Boolean(hasActiveWorkflowRun)
}

export function renderConversation(
  chatLog: HTMLElement,
  entries: ConversationEntry[],
  pendingConfirmations: Set<string>,
  options: {
    isAwaitingAssistant: boolean
    isUiVisible: boolean
    approvalsEnabled: boolean
  }
): void {
  if (options.isAwaitingAssistant) {
    chatLog.dataset.bubbleTone = 'assistant'
    chatLog.innerHTML = `
      <article class="bubble-entry bubble-entry--assistant bubble-entry--pending">
        <p class="bubble-entry__content bubble-entry__content--pending">Bonzi is thinking<span class="typing-dots" aria-hidden="true"></span></p>
      </article>
    `
    return
  }

  const activeEntry = getActiveConversationEntry(entries)

  if (!activeEntry) {
    if (!options.isUiVisible) {
      chatLog.dataset.bubbleTone = 'assistant'
      chatLog.innerHTML = ''
      return
    }

    chatLog.dataset.bubbleTone = 'assistant'
    chatLog.innerHTML = `
      <div class="empty-state">
        <p>Ask Bonzi anything.</p>
        <p class="muted">${EXAMPLE_COMMANDS.join(' · ')}</p>
      </div>
    `
    return
  }

  const { message, actions, warnings, workflowRun } = activeEntry
  const actionMarkup =
    actions.length === 0
      ? ''
      : `
        <div class="message-actions">
          ${actions
            .map((action) => {
              const label =
                action.status === 'completed'
                  ? 'Completed'
                  : action.status === 'failed'
                    ? 'Failed'
                    : action.status === 'running'
                      ? 'Running…'
                      : options.approvalsEnabled &&
                    action.requiresConfirmation &&
                      pendingConfirmations.has(action.id)
                    ? 'Approve & run'
                    : options.approvalsEnabled && action.requiresConfirmation
                      ? 'Request confirmation'
                      : 'Run action'

              return `
                <div
                  class="action-chip"
                  data-action-card
                  data-action-status="${escapeHtml(action.status)}"
                  data-workflow-run-id="${escapeHtml(action.workflowRunId ?? '')}"
                  data-workflow-step-id="${escapeHtml(action.workflowStepId ?? '')}"
                >
                  <div class="action-chip__copy">
                    <strong>${escapeHtml(action.title)}</strong>
                    <p>${escapeHtml(action.description)}</p>
                    <span class="action-chip__status">${escapeHtml(action.status)}</span>
                    ${action.resultMessage ? `<p class="action-chip__result">${escapeHtml(action.resultMessage)}</p>` : ''}
                  </div>
                  <button
                    class="ghost-button"
                    type="button"
                    data-action-id="${escapeHtml(action.id)}"
                    ${action.status === 'completed' || action.status === 'failed' || action.status === 'running' ? 'disabled' : ''}
                  >
                    ${escapeHtml(label)}
                  </button>
                </div>
              `
            })
            .join('')}
        </div>
      `

  const warningMarkup = warnings
    .map(
      (warning) =>
        `<p class="message-warning">${escapeHtml(warning)}</p>`
    )
    .join('')

  const workflowMarkup = shouldRenderWorkflowRun(workflowRun)
    ? renderWorkflowRun(workflowRun, {
        approvalsEnabled: options.approvalsEnabled
      })
    : ''

  chatLog.dataset.bubbleTone = message.role
  chatLog.innerHTML = `
    <article class="bubble-entry bubble-entry--${escapeHtml(message.role)}">
      <header class="bubble-entry__meta">
        <span class="bubble-entry__role">${escapeHtml(labelForRole(message.role))}</span>
        <time datetime="${escapeHtml(message.createdAt)}">${escapeHtml(
          formatTimestamp(message.createdAt)
        )}</time>
      </header>
      <p class="bubble-entry__content">${escapeHtml(message.content)}</p>
      ${warningMarkup}
      ${actionMarkup}
      ${workflowMarkup}
    </article>
  `
}

export function createMessage(
  role: AssistantMessage['role'],
  content: string
): AssistantMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString()
  }
}

export function conversationEntriesFromHistory(
  messages: AssistantMessage[]
): ConversationEntry[] {
  return messages.map((message) => ({
    message,
    actions: [],
    warnings: []
  }))
}

export function applyActionUpdate(
  entries: ConversationEntry[],
  updatedAction: AssistantAction
): void {
  for (const entry of entries) {
    const actionIndex = entry.actions.findIndex(
      (action) => action.id === updatedAction.id
    )

    if (actionIndex >= 0) {
      entry.actions[actionIndex] = updatedAction
      return
    }
  }
}

export function addAssistantTurn(
  entries: ConversationEntry[],
  response: AssistantCommandResponse
): void {
  if (response.reply) {
    entries.push({
      message: response.reply,
      actions: response.actions,
      warnings: response.warnings,
      workflowRun: response.workflowRun
    })
  }
}
