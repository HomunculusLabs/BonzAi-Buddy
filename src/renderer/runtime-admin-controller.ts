import type { ShellState } from '../shared/contracts/shell'
import { escapeHtml } from './html-utils'

interface RuntimeAdminControllerOptions {
  runtimeAdminEl: HTMLElement
  setStatusMessage(message: string): void
  onShellStateChanged?(state: ShellState): void
  onRuntimeReloaded?(state: ShellState): void
}

interface RuntimeAdminState {
  shellState: ShellState | null
  isHydrated: boolean
  isRefreshing: boolean
  isReloading: boolean
  error: string | null
}

export interface RuntimeAdminController {
  hydrate(): Promise<void>
  refresh(): Promise<void>
  syncShellState(state: ShellState): void
  dispose(): void
}

export function createRuntimeAdminController(
  options: RuntimeAdminControllerOptions
): RuntimeAdminController {
  const state: RuntimeAdminState = {
    shellState: null,
    isHydrated: false,
    isRefreshing: false,
    isReloading: false,
    error: null
  }

  let refreshButton: HTMLButtonElement | null = null
  let reloadButton: HTMLButtonElement | null = null

  const bindControls = (): void => {
    refreshButton?.removeEventListener('click', handleRefreshClick)
    reloadButton?.removeEventListener('click', handleReloadClick)

    refreshButton = options.runtimeAdminEl.querySelector<HTMLButtonElement>(
      '[data-action="runtime-refresh"]'
    )
    reloadButton = options.runtimeAdminEl.querySelector<HTMLButtonElement>(
      '[data-action="runtime-reload"]'
    )

    refreshButton?.addEventListener('click', handleRefreshClick)
    reloadButton?.addEventListener('click', handleReloadClick)
  }

  const render = (): void => {
    options.runtimeAdminEl.innerHTML = renderRuntimeAdmin(state)
    bindControls()
  }

  const syncShellState = (shellState: ShellState): void => {
    state.shellState = shellState
    state.isHydrated = true
    state.error = null
    options.onShellStateChanged?.(shellState)
    render()
  }

  const refresh = async (): Promise<void> => {
    if (!window.bonzi || state.isRefreshing || state.isReloading) {
      return
    }

    state.isRefreshing = true
    state.error = null
    render()
    options.setStatusMessage('Refreshing runtime state…')

    try {
      const shellState = await window.bonzi.app.getShellState()
      state.shellState = shellState
      state.isHydrated = true
      options.onShellStateChanged?.(shellState)
      options.setStatusMessage('Runtime state refreshed.')
    } catch (error) {
      state.error = `Runtime state refresh failed: ${String(error)}`
      options.setStatusMessage(state.error)
    } finally {
      state.isRefreshing = false
      render()
    }
  }

  const reload = async (): Promise<void> => {
    if (!window.bonzi || state.isRefreshing || state.isReloading) {
      return
    }

    state.isReloading = true
    state.error = null
    render()
    options.setStatusMessage('Reloading elizaOS runtime…')

    try {
      await window.bonzi.assistant.reloadRuntime()
      const shellState = await window.bonzi.app.getShellState()
      state.shellState = shellState
      state.isHydrated = true
      options.onShellStateChanged?.(shellState)
      options.onRuntimeReloaded?.(shellState)
      options.setStatusMessage('Runtime reload complete.')
    } catch (error) {
      state.error = `Runtime reload failed: ${String(error)}`
      options.setStatusMessage(state.error)
    } finally {
      state.isReloading = false
      render()
    }
  }

  function handleRefreshClick(): void {
    void refresh()
  }

  function handleReloadClick(): void {
    void reload()
  }

  render()

  return {
    hydrate: refresh,
    refresh,
    syncShellState,
    dispose: () => {
      refreshButton?.removeEventListener('click', handleRefreshClick)
      reloadButton?.removeEventListener('click', handleReloadClick)
      refreshButton = null
      reloadButton = null
    }
  }
}

function renderRuntimeAdmin(state: RuntimeAdminState): string {
  const isBusy = state.isRefreshing || state.isReloading
  const shellState = state.shellState

  return `
    <div class="settings-panel__section-header">
      <h2 class="settings-panel__section-title">Runtime overview</h2>
      <p class="settings-panel__section-copy">Refresh shell state or reload the elizaOS runtime without leaving the admin surface.</p>
    </div>

    <div class="runtime-admin__actions">
      <button class="ghost-button" data-action="runtime-refresh" type="button" ${isBusy ? 'disabled' : ''}>
        ${state.isRefreshing ? 'Refreshing…' : 'Refresh state'}
      </button>
      <button class="action-button" data-action="runtime-reload" type="button" ${isBusy ? 'disabled' : ''}>
        ${state.isReloading ? 'Reloading…' : 'Reload runtime'}
      </button>
    </div>

    ${state.error ? `<p class="settings-panel__empty runtime-admin__error">${escapeHtml(state.error)}</p>` : ''}
    ${!state.isHydrated && isBusy ? '<p class="settings-panel__empty">Loading runtime state…</p>' : ''}
    ${shellState ? renderShellState(shellState) : renderEmptyState(state)}
  `
}

function renderEmptyState(state: RuntimeAdminState): string {
  if (state.isHydrated || state.isRefreshing || state.isReloading) {
    return ''
  }

  return '<p class="settings-panel__empty">Runtime state has not been loaded yet.</p>'
}

function renderShellState(shellState: ShellState): string {
  const runtime = shellState.assistant.runtime
  const approvals = shellState.assistant.approvals
  const warningsAndNotes = [...shellState.assistant.warnings, ...shellState.notes]

  return `
    <div class="runtime-admin__grid">
      <article class="settings-card runtime-admin__card">
        <h3>Shell</h3>
        ${renderDefinitionList([
          ['Stage', shellState.stage],
          ['Platform', shellState.platform],
          ['VRM asset', shellState.vrmAssetPath]
        ])}
      </article>

      <article class="settings-card runtime-admin__card">
        <h3>Provider</h3>
        ${renderDefinitionList([
          ['Label', shellState.assistant.provider.label],
          ['Kind', shellState.assistant.provider.kind]
        ])}
      </article>

      <article class="settings-card runtime-admin__card">
        <h3>Runtime</h3>
        ${renderDefinitionList([
          ['Backend', runtime.backend],
          ['State', runtime.state],
          ['Persistence', runtime.persistence],
          ['Last error', runtime.lastError ?? 'None']
        ])}
        <pre class="runtime-admin__json">${escapeHtml(JSON.stringify(runtime, null, 2))}</pre>
      </article>

      <article class="settings-card runtime-admin__card">
        <h3>Approvals</h3>
        ${renderDefinitionList([
          ['Mode', approvals.approvalsEnabled ? 'Approvals required' : 'Autonomous'],
          ['Max steps', String(approvals.continuation.maxSteps)],
          ['Max runtime', `${approvals.continuation.maxRuntimeMs} ms`],
          ['Post-action delay', `${approvals.continuation.postActionDelayMs} ms`]
        ])}
      </article>

      <article class="settings-card runtime-admin__card runtime-admin__card--wide">
        <h3>Available actions</h3>
        ${renderTagList(shellState.assistant.availableActions)}
      </article>

      <article class="settings-card runtime-admin__card runtime-admin__card--wide">
        <h3>Warnings and notes</h3>
        ${renderMessageList(warningsAndNotes, 'No runtime warnings or shell notes.')}
      </article>
    </div>
  `
}

function renderDefinitionList(entries: Array<[string, string]>): string {
  return `
    <dl class="runtime-admin__facts">
      ${entries
        .map(
          ([label, value]) => `
            <div>
              <dt>${escapeHtml(label)}</dt>
              <dd>${escapeHtml(value)}</dd>
            </div>
          `
        )
        .join('')}
    </dl>
  `
}

function renderTagList(values: readonly string[]): string {
  if (values.length === 0) {
    return '<p class="settings-panel__empty">No actions are currently advertised.</p>'
  }

  return `
    <ul class="runtime-admin__tags">
      ${values.map((value) => `<li>${escapeHtml(value)}</li>`).join('')}
    </ul>
  `
}

function renderMessageList(values: readonly string[], emptyMessage: string): string {
  if (values.length === 0) {
    return `<p class="settings-panel__empty">${escapeHtml(emptyMessage)}</p>`
  }

  return `
    <ul class="runtime-admin__messages">
      ${values.map((value) => `<li>${escapeHtml(value)}</li>`).join('')}
    </ul>
  `
}
