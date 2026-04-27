export interface MountedAppElements {
  shellStateEl: HTMLElement
  settingsButton: HTMLButtonElement
  settingsCloseButton: HTMLButtonElement
  minimizeButton: HTMLButtonElement
  closeButton: HTMLButtonElement
  vrmCanvas: HTMLCanvasElement
  stageShellEl: HTMLElement
  shellEl: HTMLElement
  vrmStatusEl: HTMLElement
  vrmErrorEl: HTMLElement
  vrmRetryButton: HTMLButtonElement
  vrmPathEl: HTMLElement
  providerLabelEl: HTMLElement
  providerPillEl: HTMLElement
  chatLogEl: HTMLElement
  chatFormEl: HTMLFormElement
  chatInputEl: HTMLInputElement
  assistantSendButton: HTMLButtonElement
  settingsPanelEl: HTMLElement
  approvalSettingsEl: HTMLElement
  pluginSettingsEl: HTMLElement
  settingsStatusEl: HTMLElement
  applyRuntimeChangesButton: HTMLButtonElement
}

export function mountAppDom(root: HTMLDivElement): MountedAppElements {
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
          <button class="window-button" data-action="settings" type="button" aria-label="Open settings" hidden>⚙</button>
          <button class="window-button" data-action="minimize" type="button">–</button>
          <button class="window-button window-button--danger" data-action="close" type="button">×</button>
        </div>
      </header>

      <aside class="settings-panel" data-settings-panel hidden aria-label="Settings">
        <header class="settings-panel__header">
          <div>
            <h2>Settings</h2>
            <p>Manage autonomy and elizaOS plugins loaded by Bonzi.</p>
          </div>
          <button class="window-button" data-action="settings-close" type="button" aria-label="Close settings">×</button>
        </header>
        <div class="settings-panel__section" data-approval-settings></div>
        <div class="settings-panel__plugins" data-plugin-settings></div>
        <p class="settings-panel__status" data-settings-status aria-live="polite"></p>
        <button
          class="ghost-button"
          data-action="apply-runtime-changes"
          type="button"
          hidden
        >
          Apply Runtime Changes
        </button>
      </aside>

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
  const settingsButton = root.querySelector<HTMLButtonElement>(
    '[data-action="settings"]'
  )
  const settingsCloseButton = root.querySelector<HTMLButtonElement>(
    '[data-action="settings-close"]'
  )
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
  const settingsPanelEl = root.querySelector<HTMLElement>('[data-settings-panel]')
  const approvalSettingsEl = root.querySelector<HTMLElement>(
    '[data-approval-settings]'
  )
  const pluginSettingsEl = root.querySelector<HTMLElement>('[data-plugin-settings]')
  const settingsStatusEl = root.querySelector<HTMLElement>('[data-settings-status]')
  const applyRuntimeChangesButton = root.querySelector<HTMLButtonElement>(
    '[data-action="apply-runtime-changes"]'
  )

  if (
    !shellStateEl ||
    !settingsButton ||
    !settingsCloseButton ||
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
    !assistantSendButton ||
    !settingsPanelEl ||
    !approvalSettingsEl ||
    !pluginSettingsEl ||
    !settingsStatusEl ||
    !applyRuntimeChangesButton
  ) {
    throw new Error('Renderer shell did not mount expected controls.')
  }

  return {
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
  }
}
