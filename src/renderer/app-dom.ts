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
  characterSettingsEl: HTMLElement
  approvalSettingsEl: HTMLElement
  pluginSettingsEl: HTMLElement
  settingsStatusEl: HTMLElement
  buddySelectEl: HTMLSelectElement
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

      <aside
        class="settings-panel"
        data-settings-panel
        hidden
        role="dialog"
        aria-modal="false"
        aria-labelledby="settings-panel-title"
      >
        <header class="settings-panel__header">
          <div>
            <p class="settings-panel__eyebrow">Bonzi Companion</p>
            <h2 id="settings-panel-title">Settings</h2>
            <p>Manage Bonzi's companion, autonomy, character, and elizaOS plugins.</p>
          </div>
          <button class="window-button" data-action="settings-close" type="button" aria-label="Close settings">×</button>
        </header>

        <div class="settings-panel__layout">
          <nav class="settings-panel__nav" role="tablist" aria-label="Settings sections">
            <button
              class="settings-panel__tab"
              data-settings-tab="general"
              id="settings-tab-general"
              type="button"
              role="tab"
              aria-controls="settings-pane-general"
              aria-selected="true"
            >
              <span>General</span>
              <small>Buddy</small>
            </button>
            <button
              class="settings-panel__tab"
              data-settings-tab="approvals"
              id="settings-tab-approvals"
              type="button"
              role="tab"
              aria-controls="settings-pane-approvals"
              aria-selected="false"
              tabindex="-1"
            >
              <span>Approvals</span>
              <small>Autonomy</small>
            </button>
            <button
              class="settings-panel__tab"
              data-settings-tab="character"
              id="settings-tab-character"
              type="button"
              role="tab"
              aria-controls="settings-pane-character"
              aria-selected="false"
              tabindex="-1"
            >
              <span>Character</span>
              <small>Eliza JSON</small>
            </button>
            <button
              class="settings-panel__tab"
              data-settings-tab="plugins"
              id="settings-tab-plugins"
              type="button"
              role="tab"
              aria-controls="settings-pane-plugins"
              aria-selected="false"
              tabindex="-1"
            >
              <span>Plugins</span>
              <small>Runtime</small>
            </button>
          </nav>

          <div class="settings-panel__content">
            <section
              class="settings-panel__pane settings-panel__pane--general"
              data-settings-pane="general"
              id="settings-pane-general"
              role="tabpanel"
              aria-labelledby="settings-tab-general"
            >
              <div class="settings-panel__section companion-settings" data-companion-settings>
                <div class="settings-panel__section-header">
                  <h3 class="settings-panel__section-title">Buddy</h3>
                  <p class="settings-panel__section-copy">Choose which desktop companion to render.</p>
                </div>
                <label class="companion-settings__field settings-card">
                  <span>
                    <strong>Character</strong>
                    <small>Controls the visible desktop companion.</small>
                  </span>
                  <select class="companion-settings__select" data-buddy-select>
                    <option value="bonzi">Bonzi Buddy</option>
                    <option value="jellyfish">Jellyfish Buddy</option>
                  </select>
                </label>
              </div>
            </section>

            <section
              class="settings-panel__pane"
              data-settings-pane="approvals"
              id="settings-pane-approvals"
              role="tabpanel"
              aria-labelledby="settings-tab-approvals"
              hidden
            >
              <div class="settings-panel__section" data-approval-settings></div>
            </section>

            <section
              class="settings-panel__pane"
              data-settings-pane="character"
              id="settings-pane-character"
              role="tabpanel"
              aria-labelledby="settings-tab-character"
              hidden
            >
              <div class="settings-panel__section character-settings" data-character-settings></div>
            </section>

            <section
              class="settings-panel__pane"
              data-settings-pane="plugins"
              id="settings-pane-plugins"
              role="tabpanel"
              aria-labelledby="settings-tab-plugins"
              hidden
            >
              <div class="settings-panel__plugins" data-plugin-settings></div>
            </section>
          </div>
        </div>

        <footer class="settings-panel__footer">
          <p class="settings-panel__status" data-settings-status aria-live="polite"></p>
          <button
            class="ghost-button settings-panel__apply"
            data-action="apply-runtime-changes"
            type="button"
            hidden
          >
            Apply Runtime Changes
          </button>
        </footer>
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
  const characterSettingsEl = root.querySelector<HTMLElement>(
    '[data-character-settings]'
  )
  const approvalSettingsEl = root.querySelector<HTMLElement>(
    '[data-approval-settings]'
  )
  const pluginSettingsEl = root.querySelector<HTMLElement>('[data-plugin-settings]')
  const settingsStatusEl = root.querySelector<HTMLElement>('[data-settings-status]')
  const buddySelectEl = root.querySelector<HTMLSelectElement>('[data-buddy-select]')
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
    !characterSettingsEl ||
    !approvalSettingsEl ||
    !pluginSettingsEl ||
    !settingsStatusEl ||
    !buddySelectEl ||
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
    characterSettingsEl,
    approvalSettingsEl,
    pluginSettingsEl,
    settingsStatusEl,
    buddySelectEl,
    applyRuntimeChangesButton
  }
}
