export interface MountedAdminAppElements {
  adminShellEl: HTMLElement
  runtimeAdminEl: HTMLElement
  providerSettingsEl: HTMLElement
  characterSettingsEl: HTMLElement
  knowledgeSettingsEl: HTMLElement
  workspaceSettingsEl: HTMLElement
  hermesSettingsEl: HTMLElement
  routingSettingsEl: HTMLElement
  approvalSettingsEl: HTMLElement
  pluginSettingsEl: HTMLElement
  settingsStatusEl: HTMLElement
  applyRuntimeChangesButton: HTMLButtonElement
}

export function mountAdminAppDom(root: HTMLDivElement): MountedAdminAppElements {
  root.innerHTML = `
    <main class="web-admin">
      <section class="settings-panel web-admin__shell" data-admin-shell aria-labelledby="web-admin-title">
        <header class="settings-panel__header web-admin__header">
          <div>
            <p class="settings-panel__eyebrow">Bonzi Admin</p>
            <h1 id="web-admin-title" class="web-admin__title">Runtime management</h1>
            <p>Inspect runtime state and manage Bonzi settings, approvals, character, knowledge, and plugins.</p>
          </div>
          <div class="settings-panel__header-actions">
            <a class="ghost-button settings-panel__nav-link" href="?">Back to Companion</a>
          </div>
        </header>

        <div class="settings-panel__layout">
          <nav class="settings-panel__nav" role="tablist" aria-label="Admin sections">
            <button
              class="settings-panel__tab"
              data-settings-tab="runtime"
              id="admin-tab-runtime"
              type="button"
              role="tab"
              aria-controls="admin-pane-runtime"
              aria-selected="true"
            >
              <span class="settings-panel__tab-icon" aria-hidden="true">↻</span>
              <span class="settings-panel__tab-copy">
                <span class="settings-panel__tab-label">Runtime</span>
                <small>Status</small>
              </span>
            </button>
            <button
              class="settings-panel__tab"
              data-settings-tab="general"
              id="admin-tab-general"
              type="button"
              role="tab"
              aria-controls="admin-pane-general"
              aria-selected="false"
              tabindex="-1"
            >
              <span class="settings-panel__tab-icon" aria-hidden="true">⚙</span>
              <span class="settings-panel__tab-copy">
                <span class="settings-panel__tab-label">General</span>
                <small>Workspace</small>
              </span>
            </button>
            <button
              class="settings-panel__tab"
              data-settings-tab="approvals"
              id="admin-tab-approvals"
              type="button"
              role="tab"
              aria-controls="admin-pane-approvals"
              aria-selected="false"
              tabindex="-1"
            >
              <span class="settings-panel__tab-icon" aria-hidden="true">✓</span>
              <span class="settings-panel__tab-copy">
                <span class="settings-panel__tab-label">Approvals</span>
                <small>Autonomy</small>
              </span>
            </button>
            <button
              class="settings-panel__tab"
              data-settings-tab="character"
              id="admin-tab-character"
              type="button"
              role="tab"
              aria-controls="admin-pane-character"
              aria-selected="false"
              tabindex="-1"
            >
              <span class="settings-panel__tab-icon" aria-hidden="true">☻</span>
              <span class="settings-panel__tab-copy">
                <span class="settings-panel__tab-label">Character</span>
                <small>Eliza JSON</small>
              </span>
            </button>
            <button
              class="settings-panel__tab"
              data-settings-tab="knowledge"
              id="admin-tab-knowledge"
              type="button"
              role="tab"
              aria-controls="admin-pane-knowledge"
              aria-selected="false"
              tabindex="-1"
            >
              <span class="settings-panel__tab-icon" aria-hidden="true">◇</span>
              <span class="settings-panel__tab-copy">
                <span class="settings-panel__tab-label">Knowledge</span>
                <small>Markdown</small>
              </span>
            </button>
            <button
              class="settings-panel__tab"
              data-settings-tab="hermes"
              id="admin-tab-hermes"
              type="button"
              role="tab"
              aria-controls="admin-pane-hermes"
              aria-selected="false"
              tabindex="-1"
            >
              <span class="settings-panel__tab-icon" aria-hidden="true">✦</span>
              <span class="settings-panel__tab-copy">
                <span class="settings-panel__tab-label">Hermes</span>
                <small>Secondary</small>
              </span>
            </button>
            <button
              class="settings-panel__tab"
              data-settings-tab="routing"
              id="admin-tab-routing"
              type="button"
              role="tab"
              aria-controls="admin-pane-routing"
              aria-selected="false"
              tabindex="-1"
            >
              <span class="settings-panel__tab-icon" aria-hidden="true">⤳</span>
              <span class="settings-panel__tab-copy">
                <span class="settings-panel__tab-label">Routing</span>
                <small>Rules</small>
              </span>
            </button>
            <button
              class="settings-panel__tab"
              data-settings-tab="plugins"
              id="admin-tab-plugins"
              type="button"
              role="tab"
              aria-controls="admin-pane-plugins"
              aria-selected="false"
              tabindex="-1"
            >
              <span class="settings-panel__tab-icon" aria-hidden="true">▣</span>
              <span class="settings-panel__tab-copy">
                <span class="settings-panel__tab-label">Plugins</span>
                <small>Runtime</small>
              </span>
            </button>
          </nav>

          <div class="settings-panel__content">
            <section
              class="settings-panel__pane"
              data-settings-pane="runtime"
              id="admin-pane-runtime"
              role="tabpanel"
              aria-labelledby="admin-tab-runtime"
            >
              <div class="runtime-admin" data-runtime-admin></div>
            </section>

            <section
              class="settings-panel__pane"
              data-settings-pane="general"
              id="admin-pane-general"
              role="tabpanel"
              aria-labelledby="admin-tab-general"
              hidden
            >
              <div class="settings-panel__section provider-settings" data-provider-settings></div>
              <div class="settings-panel__section workspace-settings" data-workspace-settings></div>
            </section>

            <section
              class="settings-panel__pane"
              data-settings-pane="approvals"
              id="admin-pane-approvals"
              role="tabpanel"
              aria-labelledby="admin-tab-approvals"
              hidden
            >
              <div class="settings-panel__section" data-approval-settings></div>
            </section>

            <section
              class="settings-panel__pane"
              data-settings-pane="character"
              id="admin-pane-character"
              role="tabpanel"
              aria-labelledby="admin-tab-character"
              hidden
            >
              <div class="settings-panel__section character-settings" data-character-settings></div>
            </section>

            <section
              class="settings-panel__pane"
              data-settings-pane="knowledge"
              id="admin-pane-knowledge"
              role="tabpanel"
              aria-labelledby="admin-tab-knowledge"
              hidden
            >
              <div class="settings-panel__section knowledge-settings" data-knowledge-settings></div>
            </section>

            <section
              class="settings-panel__pane"
              data-settings-pane="hermes"
              id="admin-pane-hermes"
              role="tabpanel"
              aria-labelledby="admin-tab-hermes"
              hidden
            >
              <div class="settings-panel__section hermes-settings" data-hermes-settings></div>
            </section>

            <section
              class="settings-panel__pane"
              data-settings-pane="routing"
              id="admin-pane-routing"
              role="tabpanel"
              aria-labelledby="admin-tab-routing"
              hidden
            >
              <div class="settings-panel__section routing-settings" data-routing-settings></div>
            </section>

            <section
              class="settings-panel__pane"
              data-settings-pane="plugins"
              id="admin-pane-plugins"
              role="tabpanel"
              aria-labelledby="admin-tab-plugins"
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
      </section>
    </main>
  `

  const adminShellEl = root.querySelector<HTMLElement>('[data-admin-shell]')
  const runtimeAdminEl = root.querySelector<HTMLElement>('[data-runtime-admin]')
  const providerSettingsEl = root.querySelector<HTMLElement>('[data-provider-settings]')
  const characterSettingsEl = root.querySelector<HTMLElement>('[data-character-settings]')
  const approvalSettingsEl = root.querySelector<HTMLElement>('[data-approval-settings]')
  const knowledgeSettingsEl = root.querySelector<HTMLElement>('[data-knowledge-settings]')
  const workspaceSettingsEl = root.querySelector<HTMLElement>('[data-workspace-settings]')
  const hermesSettingsEl = root.querySelector<HTMLElement>('[data-hermes-settings]')
  const routingSettingsEl = root.querySelector<HTMLElement>('[data-routing-settings]')
  const pluginSettingsEl = root.querySelector<HTMLElement>('[data-plugin-settings]')
  const settingsStatusEl = root.querySelector<HTMLElement>('[data-settings-status]')
  const applyRuntimeChangesButton = root.querySelector<HTMLButtonElement>(
    '[data-action="apply-runtime-changes"]'
  )

  if (
    !adminShellEl ||
    !runtimeAdminEl ||
    !providerSettingsEl ||
    !characterSettingsEl ||
    !approvalSettingsEl ||
    !knowledgeSettingsEl ||
    !workspaceSettingsEl ||
    !hermesSettingsEl ||
    !routingSettingsEl ||
    !pluginSettingsEl ||
    !settingsStatusEl ||
    !applyRuntimeChangesButton
  ) {
    throw new Error('Admin renderer did not mount expected controls.')
  }

  return {
    adminShellEl,
    runtimeAdminEl,
    providerSettingsEl,
    characterSettingsEl,
    knowledgeSettingsEl,
    workspaceSettingsEl,
    hermesSettingsEl,
    routingSettingsEl,
    approvalSettingsEl,
    pluginSettingsEl,
    settingsStatusEl,
    applyRuntimeChangesButton
  }
}
