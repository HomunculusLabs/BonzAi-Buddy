import type {
  AssistantAction,
  AssistantCommandResponse,
  AssistantMessage,
  ShellState
} from '../shared/contracts'
import { createVrmStage } from './vrm-stage'

const EXAMPLE_COMMANDS = [
  'show shell state',
  'copy asset path',
  'minimize window',
  'close window'
]

interface ConversationEntry {
  message: AssistantMessage
  actions: AssistantAction[]
  warnings: string[]
}

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

function renderConversation(
  chatLog: HTMLElement,
  entries: ConversationEntry[],
  pendingConfirmations: Set<string>
): void {
  if (entries.length === 0) {
    chatLog.innerHTML = `
      <div class="empty-state">
        <p>No assistant messages yet.</p>
        <p class="muted">Try: ${EXAMPLE_COMMANDS.join(' · ')}</p>
      </div>
    `
    return
  }

  chatLog.innerHTML = entries
    .map(({ message, actions, warnings }) => {
      const actionMarkup =
        actions.length === 0
          ? ''
          : `
            <div class="message-actions">
              ${actions
                .map((action) => {
                  const label =
                    action.requiresConfirmation &&
                    pendingConfirmations.has(action.id)
                      ? 'Approve & run'
                      : action.requiresConfirmation
                        ? 'Request confirmation'
                        : action.status === 'completed'
                          ? 'Completed'
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

      return `
        <article class="message message--${escapeHtml(message.role)}">
          <header class="message__meta">
            <span class="message__role">${escapeHtml(message.role)}</span>
            <time datetime="${escapeHtml(message.createdAt)}">${escapeHtml(
              formatTimestamp(message.createdAt)
            )}</time>
          </header>
          <p class="message__content">${escapeHtml(message.content)}</p>
          ${warningMarkup}
          ${actionMarkup}
        </article>
      `
    })
    .join('')

  chatLog.scrollTop = chatLog.scrollHeight
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

function conversationHistory(entries: ConversationEntry[]): AssistantMessage[] {
  return entries.map((entry) => entry.message)
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
  root.innerHTML = `
    <main class="shell">
      <header class="titlebar" aria-label="Window controls and drag area">
        <div class="titlebar__brand">
          <span class="titlebar__dot"></span>
          <div>
            <div>Bonzi Companion</div>
            <p class="titlebar__caption">Item 3 — assistant/task layer live</p>
          </div>
        </div>
        <div class="titlebar__actions">
          <button class="window-button" data-action="minimize" type="button">–</button>
          <button class="window-button window-button--danger" data-action="close" type="button">×</button>
        </div>
      </header>

      <section class="card stage-card">
        <div class="stage-card__copy">
          <p class="eyebrow">Transparent VRM stage + assistant shell</p>
          <h1>Bonzi keeps the VRM renderer and now accepts typed assistant commands.</h1>
          <p class="lede">
            The avatar still renders on the transparent Three.js stage while the renderer
            now talks to main through typed IPC for provider-backed replies and safe task execution.
          </p>
          <div class="status-row">
            <span class="status-pill" data-vrm-status>Preparing renderer…</span>
            <span class="status-pill status-pill--subtle" data-provider-label>Loading provider…</span>
            <button class="ghost-button" data-role="vrm-retry" type="button" hidden>
              Retry load
            </button>
          </div>
          <p class="muted" data-vrm-error hidden></p>
          <ul class="feature-list">
            <li>The assistant can propose only allowlisted desktop actions.</li>
            <li>Sensitive actions stay behind an explicit confirmation step.</li>
          </ul>
        </div>

        <div class="stage-shell">
          <div class="stage-shell__glow" aria-hidden="true"></div>
          <canvas class="stage-canvas" data-vrm-canvas aria-label="Bonzi VRM stage"></canvas>
          <div class="stage-overlay" aria-hidden="true">
            <span class="stage-overlay__badge">Three.js + @pixiv/three-vrm</span>
          </div>
        </div>
      </section>

      <section class="grid">
        <article class="card assistant-card">
          <div class="assistant-card__header">
            <div>
              <h2>Assistant</h2>
              <p class="muted">
                Commands route through preload → main IPC → provider service. No unrestricted shell execution.
              </p>
            </div>
            <span class="status-pill status-pill--subtle" data-provider-pill>Awaiting state…</span>
          </div>

          <div class="chat-log" data-chat-log></div>

          <form class="chat-form" data-chat-form>
            <label class="chat-form__label" for="assistant-command">Command</label>
            <div class="chat-form__row">
              <input
                id="assistant-command"
                class="chat-input"
                name="command"
                type="text"
                autocomplete="off"
                placeholder="Ask Bonzi to summarize state, copy the VRM path, or minimize the window"
              />
              <button class="action-button" data-role="assistant-send" type="submit">
                Send
              </button>
            </div>
            <p class="muted">Examples: ${EXAMPLE_COMMANDS.join(' · ')}</p>
          </form>
        </article>

        <article class="card">
          <h2>Shell state</h2>
          <p class="muted">Renderer state, provider selection, and allowlisted actions exposed by main.</p>
          <code class="inline-code" data-vrm-path>Loading asset path…</code>
          <pre class="state-block" data-shell-state>Loading shell metadata…</pre>
        </article>
      </section>

      <section class="grid grid--bottom">
        <article class="card">
          <h2>Provider config notes</h2>
          <ul class="todo-list">
            <li><code>BONZI_ASSISTANT_PROVIDER</code>: <code>mock</code> or <code>openai-compatible</code></li>
            <li><code>BONZI_OPENAI_API_KEY</code>: required for Z.AI / OpenAI-compatible provider</li>
            <li>Z.AI base URL: <code>https://api.z.ai/api/coding/paas/v4</code></li>
            <li>Model examples: <code>GLM-5.1</code>, <code>GLM-5</code>, <code>GLM-5-Turbo</code>, <code>GLM-4.7</code>, <code>GLM-4.5-air</code></li>
          </ul>
        </article>

        <article class="card">
          <h2>Execution safety</h2>
          <ul class="todo-list">
            <li>Only explicit allowlisted actions are executable from assistant replies.</li>
            <li>Close-window actions require confirmation before they run.</li>
            <li>No shell/task runner is exposed in preload or main.</li>
          </ul>
        </article>
      </section>
    </main>
  `

  const shellStateEl = root.querySelector<HTMLElement>('[data-shell-state]')
  const minimizeButton = root.querySelector<HTMLButtonElement>(
    '[data-action="minimize"]'
  )
  const closeButton = root.querySelector<HTMLButtonElement>('[data-action="close"]')
  const vrmCanvas = root.querySelector<HTMLCanvasElement>('[data-vrm-canvas]')
  const vrmStatusEl = root.querySelector<HTMLElement>('[data-vrm-status]')
  const vrmErrorEl = root.querySelector<HTMLElement>('[data-vrm-error]')
  const vrmRetryButton = root.querySelector<HTMLButtonElement>('[data-role="vrm-retry"]')
  const vrmPathEl = root.querySelector<HTMLElement>('[data-vrm-path]')
  const providerLabelEl = root.querySelector<HTMLElement>('[data-provider-label]')
  const providerPillEl = root.querySelector<HTMLElement>('[data-provider-pill]')
  const chatLogEl = root.querySelector<HTMLElement>('[data-chat-log]')
  const chatFormEl = root.querySelector<HTMLFormElement>('[data-chat-form]')
  const chatInputEl = root.querySelector<HTMLInputElement>('#assistant-command')

  if (
    !shellStateEl ||
    !minimizeButton ||
    !closeButton ||
    !vrmCanvas ||
    !vrmStatusEl ||
    !vrmErrorEl ||
    !vrmRetryButton ||
    !vrmPathEl ||
    !providerLabelEl ||
    !providerPillEl ||
    !chatLogEl ||
    !chatFormEl ||
    !chatInputEl
  ) {
    throw new Error('Renderer shell did not mount expected controls.')
  }

  let shellState: ShellState | null = null
  const conversation: ConversationEntry[] = []
  const pendingConfirmations = new Set<string>()

  renderConversation(chatLogEl, conversation, pendingConfirmations)

  const vrmStage = createVrmStage(vrmCanvas, {
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

  const loadVrm = async (): Promise<void> => {
    if (!shellState) {
      return
    }

    try {
      await vrmStage.load(shellState.vrmAssetPath)
    } catch {
      // UI/error state is already updated inside the stage controller.
    }
  }

  const setProviderLabel = (label: string): void => {
    providerLabelEl.textContent = label
    providerPillEl.textContent = label
  }

  const appendSystemMessage = (content: string): void => {
    conversation.push({
      message: createMessage('system', content),
      actions: [],
      warnings: []
    })
    renderConversation(chatLogEl, conversation, pendingConfirmations)
  }

  minimizeButton.addEventListener('click', () => {
    window.bonzi.window.minimize()
  })

  closeButton.addEventListener('click', () => {
    window.bonzi.window.close()
  })

  chatFormEl.addEventListener('submit', async (event) => {
    event.preventDefault()

    const command = chatInputEl.value.trim()

    if (!command) {
      return
    }

    const history = conversationHistory(conversation)
    const userMessage = createMessage('user', command)
    conversation.push({
      message: userMessage,
      actions: [],
      warnings: []
    })
    renderConversation(chatLogEl, conversation, pendingConfirmations)

    chatInputEl.value = ''
    chatInputEl.disabled = true

    try {
      const response = await window.bonzi.assistant.sendCommand({
        command,
        history
      })

      setProviderLabel(response.provider.label)

      if (response.ok && response.reply) {
        addAssistantTurn(conversation, response)
      } else {
        appendSystemMessage(
          response.error ??
            'The assistant did not return a reply for this command.'
        )
      }

      renderConversation(chatLogEl, conversation, pendingConfirmations)
    } catch (error) {
      appendSystemMessage(`Assistant request failed: ${String(error)}`)
    } finally {
      chatInputEl.disabled = false
      chatInputEl.focus()
    }
  })

  chatLogEl.addEventListener('click', async (event) => {
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
      renderConversation(chatLogEl, conversation, pendingConfirmations)
    }
  })

  vrmRetryButton.addEventListener('click', () => {
    void loadVrm()
  })

  if (!window.bonzi) {
    const message = 'Bonzi preload bridge is unavailable. Restart the app after rebuilding.'
    shellStateEl.textContent = message
    vrmPathEl.textContent = 'Unavailable'
    setProviderLabel('Bridge unavailable')
    vrmStatusEl.textContent = 'Renderer blocked'
    vrmErrorEl.hidden = false
    vrmErrorEl.textContent = message
    vrmRetryButton.hidden = true
    appendSystemMessage(message)
    return
  }

  void window.bonzi.app
    .getShellState()
    .then(async (state) => {
      shellState = state
      shellStateEl.textContent = shellStateMarkup(state)
      vrmPathEl.textContent = state.vrmAssetPath
      setProviderLabel(state.assistant.provider.label)

      if (state.assistant.warnings.length > 0) {
        appendSystemMessage(state.assistant.warnings.join(' '))
      }

      void loadVrm()
    })
    .catch((error) => {
      const message = `Failed to load shell state: ${String(error)}`
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
      vrmStage.dispose()
    },
    { once: true }
  )
}
