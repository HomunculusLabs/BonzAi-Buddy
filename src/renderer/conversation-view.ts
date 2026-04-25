import type {
  AssistantAction,
  AssistantCommandResponse,
  AssistantMessage
} from '../shared/contracts'

const EXAMPLE_COMMANDS = [
  'show shell state',
  'copy asset path',
  'minimize window',
  'close window'
]

export interface ConversationEntry {
  message: AssistantMessage
  actions: AssistantAction[]
  warnings: string[]
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
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

    if (hasPendingActions || entry.warnings.length > 0) {
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
  return entry?.actions.some((action) => action.status !== 'completed') ?? false
}

export function renderConversation(
  chatLog: HTMLElement,
  entries: ConversationEntry[],
  pendingConfirmations: Set<string>,
  options: {
    isAwaitingAssistant: boolean
    isUiVisible: boolean
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

  const { message, actions, warnings } = activeEntry
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
                  : action.requiresConfirmation &&
                      pendingConfirmations.has(action.id)
                    ? 'Approve & run'
                    : action.requiresConfirmation
                      ? 'Request confirmation'
                      : 'Run action'

              return `
                <div class="action-chip" data-action-card>
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
                    ${action.status === 'completed' ? 'disabled' : ''}
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
      warnings: response.warnings
    })
  }
}
