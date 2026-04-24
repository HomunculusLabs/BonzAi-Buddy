import type {
  AssistantAction,
  AssistantCommandResponse,
  AssistantEvent,
  AssistantEventEmoteId,
  AssistantMessage,
  AssistantRuntimeStatus,
  ShellState
} from '../shared/contracts'
import { createVrmStage, type VrmStageController } from './vrm-stage'

const EXAMPLE_COMMANDS = [
  'show shell state',
  'copy asset path',
  'minimize window',
  'close window'
]

const BUBBLE_EXPIRY_MS = 12000

interface ConversationEntry {
  message: AssistantMessage
  actions: AssistantAction[]
  warnings: string[]
}

interface WindowDragState {
  pointerId: number
  startBounds: {
    x: number
    y: number
  }
  startScreen: {
    x: number
    y: number
  }
}

type AppReadyState = 'loading' | 'ready' | 'error'

function shellStateMarkup(state: ShellState): string {
  return JSON.stringify(state, null, 2)
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

function getActiveConversationEntry(
  entries: ConversationEntry[]
): ConversationEntry | null {
  if (entries.length === 0) {
    return null
  }

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry.actions.length > 0 || entry.warnings.length > 0) {
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

function hasPendingBubbleActions(entry: ConversationEntry | null): boolean {
  return entry?.actions.some((action) => action.status !== 'completed') ?? false
}

function renderConversation(
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

function createMessage(
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

function conversationEntriesFromHistory(
  messages: AssistantMessage[]
): ConversationEntry[] {
  return messages.map((message) => ({
    message,
    actions: [],
    warnings: []
  }))
}

function shellStageForRuntimeStatus(
  status: AssistantRuntimeStatus
): ShellState['stage'] {
  switch (status.state) {
    case 'starting':
      return 'runtime-starting'
    case 'ready':
      return 'assistant-ready'
    case 'error':
      return 'runtime-error'
  }
}

function applyActionUpdate(
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

function addAssistantTurn(
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

export function renderApp(root: HTMLDivElement): void {
  const disableVrm =
    new URLSearchParams(window.location.search).get('bonziDisableVrm') === '1'

  root.innerHTML = `
    <main class="shell shell--ui-hidden" data-app-ready="loading">
      <header class="titlebar" aria-label="Window controls and drag area">
        <div class="titlebar__brand">
          <span class="titlebar__dot"></span>
          <div>
            <div>Bonzi Companion</div>
            <p class="titlebar__caption">UI Item 1 — speech bubble assistant</p>
          </div>
        </div>
        <div class="titlebar__actions">
          <button class="window-button" data-action="minimize" type="button">–</button>
          <button class="window-button window-button--danger" data-action="close" type="button">×</button>
        </div>
      </header>

      <section class="stage-card">
        <div class="stage-card__copy" aria-live="polite">
          <span class="sr-only" data-vrm-status>Preparing renderer…</span>
          <span class="sr-only" data-provider-label>Loading provider…</span>
          <button class="ghost-button" data-role="vrm-retry" type="button" hidden>
            Retry load
          </button>
          <p class="muted stage-card__error" data-vrm-error hidden></p>
        </div>

        <div class="speech-bubble-shell" aria-live="polite">
          <div class="speech-bubble" data-chat-log aria-label="Bonzi speech bubble"></div>
        </div>

        <div class="stage-shell">
          <canvas class="stage-canvas" data-vrm-canvas aria-label="Bonzi VRM stage"></canvas>
        </div>
      </section>

      <section class="command-dock" aria-label="Assistant command launcher">
        <div class="debug-readouts" hidden>
          <span data-provider-pill>Awaiting state…</span>
        </div>

        <form class="chat-form chat-form--dock" data-chat-form>
          <label class="sr-only" for="assistant-command">Command</label>
          <div class="chat-form__row">
            <input
              id="assistant-command"
              class="chat-input"
              name="command"
              type="text"
              autocomplete="off"
              placeholder="Type a command for Bonzi"
            />
            <button class="action-button" data-role="assistant-send" type="submit">
              Send
            </button>
          </div>
        </form>

        <div class="debug-readouts" hidden>
          <code class="inline-code" data-vrm-path>Loading asset path…</code>
          <pre class="state-block" data-shell-state>Loading shell metadata…</pre>
        </div>
      </section>
    </main>
  `

  const shellStateEl = root.querySelector<HTMLElement>('[data-shell-state]')
  const minimizeButton = root.querySelector<HTMLButtonElement>(
    '[data-action="minimize"]'
  )
  const closeButton = root.querySelector<HTMLButtonElement>('[data-action="close"]')
  const vrmCanvas = root.querySelector<HTMLCanvasElement>('[data-vrm-canvas]')
  const stageShellEl = root.querySelector<HTMLElement>('.stage-shell')
  const shellEl = root.querySelector<HTMLElement>('.shell')
  const vrmStatusEl = root.querySelector<HTMLElement>('[data-vrm-status]')
  const vrmErrorEl = root.querySelector<HTMLElement>('[data-vrm-error]')
  const vrmRetryButton = root.querySelector<HTMLButtonElement>('[data-role="vrm-retry"]')
  const vrmPathEl = root.querySelector<HTMLElement>('[data-vrm-path]')
  const providerLabelEl = root.querySelector<HTMLElement>('[data-provider-label]')
  const providerPillEl = root.querySelector<HTMLElement>('[data-provider-pill]')
  const chatLogEl = root.querySelector<HTMLElement>('[data-chat-log]')
  const chatFormEl = root.querySelector<HTMLFormElement>('[data-chat-form]')
  const chatInputEl = root.querySelector<HTMLInputElement>('#assistant-command')
  const assistantSendButton = root.querySelector<HTMLButtonElement>(
    '[data-role="assistant-send"]'
  )

  if (
    !shellStateEl ||
    !minimizeButton ||
    !closeButton ||
    !vrmCanvas ||
    !stageShellEl ||
    !shellEl ||
    !vrmStatusEl ||
    !vrmErrorEl ||
    !vrmRetryButton ||
    !vrmPathEl ||
    !providerLabelEl ||
    !providerPillEl ||
    !chatLogEl ||
    !chatFormEl ||
    !chatInputEl ||
    !assistantSendButton
  ) {
    throw new Error('Renderer shell did not mount expected controls.')
  }

  const setAssistantInputEnabled = (enabled: boolean): void => {
    chatInputEl.disabled = !enabled
    assistantSendButton.disabled = !enabled
  }

  const setAppReadyState = (state: AppReadyState): void => {
    shellEl.dataset.appReady = state
  }

  let shellState: ShellState | null = null
  const conversation: ConversationEntry[] = []
  const pendingConfirmations = new Set<string>()
  let isUiVisible = false
  let isAwaitingAssistant = false
  let isBubbleVisible = false
  let bubbleExpiryTimer: number | null = null
  let dragState: WindowDragState | null = null
  let pendingStageEmote: AssistantEventEmoteId | null = null
  let pendingRuntimeStatus: AssistantRuntimeStatus | null = null
  let unsubscribeAssistantEvents: (() => void) | null = null

  setAssistantInputEnabled(false)
  setAppReadyState('loading')

  renderConversation(chatLogEl, conversation, pendingConfirmations, {
    isAwaitingAssistant,
    isUiVisible
  })

  const clearBubbleExpiry = (): void => {
    if (bubbleExpiryTimer !== null) {
      window.clearTimeout(bubbleExpiryTimer)
      bubbleExpiryTimer = null
    }
  }

  const refreshBubbleVisibility = (): void => {
    clearBubbleExpiry()

    if (isAwaitingAssistant) {
      isBubbleVisible = true
      return
    }

    const activeEntry = getActiveConversationEntry(conversation)

    if (!activeEntry) {
      isBubbleVisible = false
      return
    }

    isBubbleVisible = true

    if (isUiVisible || hasPendingBubbleActions(activeEntry)) {
      return
    }

    bubbleExpiryTimer = window.setTimeout(() => {
      if (isUiVisible || isAwaitingAssistant) {
        return
      }

      isBubbleVisible = false
      syncUiVisibility()
    }, BUBBLE_EXPIRY_MS)
  }

  const syncUiVisibility = (): void => {
    const hasError = !vrmErrorEl.hidden
    shellEl.classList.toggle('shell--ui-hidden', !isUiVisible)
    shellEl.classList.toggle('shell--ui-active', isUiVisible)
    shellEl.classList.toggle(
      'shell--bubble-visible',
      isUiVisible || isBubbleVisible || isAwaitingAssistant || hasError
    )
  }

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
      isUiVisible
    })
    refreshBubbleVisibility()
    syncUiVisibility()
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
            return
          }

          vrmErrorEl.hidden = false
          vrmErrorEl.textContent = `VRM load error: ${message}`
          vrmRetryButton.hidden = false
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

  stageShellEl.addEventListener('pointerdown', async (event) => {
    if (event.button !== 0 || event.detail > 1) {
      return
    }

    if (!window.bonzi) {
      return
    }

    if (
      event.target instanceof HTMLElement &&
      (event.target.closest('.speech-bubble') || event.target.closest('.command-dock'))
    ) {
      return
    }

    const bounds = await window.bonzi.window.getBounds()

    if (!bounds) {
      return
    }

    dragState = {
      pointerId: event.pointerId,
      startBounds: {
        x: bounds.x,
        y: bounds.y
      },
      startScreen: {
        x: event.screenX,
        y: event.screenY
      }
    }

    stageShellEl.setPointerCapture(event.pointerId)
  })

  stageShellEl.addEventListener('pointermove', (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId || !window.bonzi) {
      return
    }

    const deltaX = event.screenX - dragState.startScreen.x
    const deltaY = event.screenY - dragState.startScreen.y

    window.bonzi.window.setPosition(
      dragState.startBounds.x + deltaX,
      dragState.startBounds.y + deltaY
    )
  })

  const clearDragState = (event: PointerEvent): void => {
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return
    }

    if (stageShellEl.hasPointerCapture(event.pointerId)) {
      stageShellEl.releasePointerCapture(event.pointerId)
    }

    dragState = null
  }

  stageShellEl.addEventListener('pointerup', clearDragState)
  stageShellEl.addEventListener('pointercancel', clearDragState)

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
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
    minimizeButton.disabled = true
    closeButton.disabled = true
    chatInputEl.disabled = true
    assistantSendButton.disabled = true
    appendSystemMessage(message)
    syncUiVisibility()
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
      clearBubbleExpiry()
      vrmStage.dispose()
    },
    { once: true }
  )

  syncUiVisibility()
}
