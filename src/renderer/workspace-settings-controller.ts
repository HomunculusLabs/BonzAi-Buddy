import type { BonziWorkspaceSettings, ShellState } from '../shared/contracts'
import { escapeHtml } from './html-utils'

interface WorkspaceSettingsControllerOptions {
  workspaceSettingsEl: HTMLElement
  setStatusMessage(message: string): void
  onApplyShellState(state: ShellState): void
  onSavingChange(saving: boolean): void
}

export interface WorkspaceSettingsController {
  hydrate(): Promise<void>
  dispose(): void
}

export function createWorkspaceSettingsController(
  options: WorkspaceSettingsControllerOptions
): WorkspaceSettingsController {
  const { workspaceSettingsEl } = options
  let settings: BonziWorkspaceSettings | null = null
  let isHydrated = false
  let isSaving = false

  const setSaving = (saving: boolean): void => {
    isSaving = saving
    options.onSavingChange(saving)
  }

  const hydrate = async (): Promise<void> => {
    if (!window.bonzi) {
      isHydrated = true
      render()
      return
    }

    try {
      settings = await window.bonzi.settings.getWorkspaceSettings()
      isHydrated = true
      render()
    } catch (error) {
      isHydrated = true
      options.setStatusMessage(`Failed to load workspace settings: ${String(error)}`)
      render()
    }
  }

  const render = (): void => {
    const bridgeAvailable = Boolean(window.bonzi)
    const disabled =
      !bridgeAvailable || !isHydrated || !settings || isSaving || settings.envLocked
        ? 'disabled'
        : ''
    const sourceLabel = settings ? workspaceSourceLabel(settings) : 'Loading…'
    const workspacePath = settings?.workspaceDir ?? 'Loading…'

    workspaceSettingsEl.innerHTML = `
      <div class="settings-panel__section-header">
        <h3 class="settings-panel__section-title">Writable workspace</h3>
        <p class="settings-panel__section-copy">Choose the only folder Bonzi can read/write through workspace file actions.</p>
      </div>
      <div class="settings-card workspace-settings__card">
        <div class="workspace-settings__path-row">
          <span>
            <strong>Folder</strong>
            <small>${escapeHtml(sourceLabel)}</small>
          </span>
          <code>${escapeHtml(workspacePath)}</code>
        </div>
        ${settings?.envLocked
          ? '<p class="workspace-settings__note">This path is locked by BONZI_WRITABLE_WORKSPACE_DIR. Unset that environment variable to change it here.</p>'
          : '<p class="workspace-settings__note">Bonzi file actions only accept relative paths inside this folder.</p>'}
        <div class="workspace-settings__actions">
          <button class="settings-button" type="button" data-workspace-choose ${disabled}>Choose folder…</button>
          <button class="settings-button" type="button" data-workspace-reset ${disabled}>Reset to default</button>
        </div>
      </div>
      ${!isHydrated ? '<p class="settings-panel__empty">Workspace settings are loading…</p>' : ''}
    `
  }

  const handleClick = (event: MouseEvent): void => {
    const target = event.target
    if (!(target instanceof Element)) {
      return
    }

    if (target.closest('[data-workspace-choose]')) {
      void chooseWorkspaceFolder()
      return
    }

    if (target.closest('[data-workspace-reset]')) {
      void resetWorkspaceFolder()
    }
  }

  const chooseWorkspaceFolder = async (): Promise<void> => {
    if (!window.bonzi || isSaving || settings?.envLocked) {
      return
    }

    setSaving(true)
    options.setStatusMessage('Choosing Bonzi workspace folder…')
    render()

    try {
      const result = await window.bonzi.settings.selectWorkspaceFolder()
      settings = result.settings
      options.setStatusMessage(result.error ?? result.message)

      if (result.ok && !result.cancelled) {
        const shellState = await window.bonzi.app.getShellState()
        options.onApplyShellState(shellState)
      }
    } catch (error) {
      options.setStatusMessage(`Failed to choose workspace folder: ${String(error)}`)
    } finally {
      setSaving(false)
      render()
    }
  }

  const resetWorkspaceFolder = async (): Promise<void> => {
    if (!window.bonzi || isSaving || settings?.envLocked) {
      return
    }

    setSaving(true)
    options.setStatusMessage('Resetting Bonzi workspace folder…')
    render()

    try {
      const result = await window.bonzi.settings.resetWorkspaceFolder()
      settings = result.settings
      options.setStatusMessage(result.error ?? result.message)

      if (result.ok) {
        const shellState = await window.bonzi.app.getShellState()
        options.onApplyShellState(shellState)
      }
    } catch (error) {
      options.setStatusMessage(`Failed to reset workspace folder: ${String(error)}`)
    } finally {
      setSaving(false)
      render()
    }
  }

  workspaceSettingsEl.addEventListener('click', handleClick)
  render()

  return {
    hydrate,
    dispose: () => {
      workspaceSettingsEl.removeEventListener('click', handleClick)
      setSaving(false)
    }
  }
}

function workspaceSourceLabel(settings: BonziWorkspaceSettings): string {
  switch (settings.source) {
    case 'env':
      return 'Environment override'
    case 'settings':
      return 'Set in Bonzi Settings'
    case 'default':
      return 'Default location'
  }
}
