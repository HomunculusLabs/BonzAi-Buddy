import {
  type RuntimeApprovalSettings,
  type ShellState
} from '../shared/contracts'

interface ApprovalSettingsControllerOptions {
  approvalSettingsEl: HTMLElement
  setStatusMessage(message: string): void
  onApplyShellState(state: ShellState): void
  onApprovalSettingsChanged(settings: RuntimeApprovalSettings): void
  onApprovalsDisabled(): Promise<void>
  onConversationNeedsRender(): void
  onSavingChange(saving: boolean): void
}

export interface ApprovalSettingsController {
  hydrateApprovalSettings(): Promise<void>
  syncApprovalSettings(settings: RuntimeApprovalSettings | null): void
  getApprovalSettings(): RuntimeApprovalSettings | null
  isApprovalsEnabled(): boolean
  dispose(): void
}

export function createApprovalSettingsController(
  options: ApprovalSettingsControllerOptions
): ApprovalSettingsController {
  const { approvalSettingsEl } = options

  let approvalSettings: RuntimeApprovalSettings | null = null
  let isSavingApprovalSettings = false

  const rerenderApprovalSettings = (): void => {
    const approvalsEnabled = approvalSettings?.approvalsEnabled !== false

    approvalSettingsEl.innerHTML = `
      <div class="settings-panel__section-header">
        <h3 class="settings-panel__section-title">Action approvals</h3>
        <p class="settings-panel__section-copy">
          ${approvalsEnabled
            ? 'Sensitive action cards, workflow steps, and plugin operations pause for approval.'
            : 'Actions, workflows, and plugin operations that would normally ask approval continue automatically.'}
        </p>
      </div>
      <label class="plugin-row approval-settings-row">
        <span class="plugin-row__copy">
          <span class="plugin-row__title">
            Bonzi approvals
            <span class="plugin-row__status">${approvalsEnabled ? 'Enabled' : 'Autonomous'}</span>
          </span>
          <span class="plugin-row__description">
            Turn this off for more autonomy. Disabling requires explicit confirmation once.
          </span>
        </span>
        <span class="plugin-row__action-group">
          <span>${approvalsEnabled ? 'On' : 'Off'}</span>
          <input
            class="plugin-row__toggle"
            type="checkbox"
            data-approval-toggle
            ${approvalsEnabled ? 'checked' : ''}
            ${isSavingApprovalSettings ? 'disabled' : ''}
          />
        </span>
      </label>
    `
  }

  const setSavingApprovalSettings = (saving: boolean): void => {
    isSavingApprovalSettings = saving
    options.onSavingChange(saving)
  }

  const hydrateApprovalSettings = async (): Promise<void> => {
    if (!window.bonzi) {
      return
    }

    try {
      approvalSettings = await window.bonzi.settings.getRuntimeApprovalSettings()
      rerenderApprovalSettings()
      options.onApprovalSettingsChanged(approvalSettings)
      options.onConversationNeedsRender()
    } catch (error) {
      options.setStatusMessage(`Failed to load approval settings: ${String(error)}`)
    }
  }

  const handleApprovalSettingsChange = async (event: Event): Promise<void> => {
    const target = event.target

    if (!(target instanceof HTMLInputElement) || !target.matches('[data-approval-toggle]')) {
      return
    }

    if (!window.bonzi || isSavingApprovalSettings) {
      target.checked = approvalSettings?.approvalsEnabled !== false
      return
    }

    const approvalsEnabled = target.checked
    const confirmedDisable = approvalsEnabled
      ? true
      : window.confirm(
          'Disable action and workflow approvals? Bonzi will run approved action types automatically when workflows or action cards reach them.'
        )

    if (!confirmedDisable) {
      target.checked = true
      return
    }

    setSavingApprovalSettings(true)
    rerenderApprovalSettings()
    options.setStatusMessage(
      approvalsEnabled ? 'Enabling approvals…' : 'Disabling approvals…'
    )

    try {
      approvalSettings = await window.bonzi.settings.updateRuntimeApprovalSettings({
        approvalsEnabled,
        ...(approvalsEnabled ? {} : { confirmedDisable: true })
      })
      options.onApprovalSettingsChanged(approvalSettings)

      if (!approvalSettings.approvalsEnabled) {
        await options.onApprovalsDisabled()
      }

      options.setStatusMessage(
        approvalSettings.approvalsEnabled
          ? 'Action approvals enabled.'
          : 'Action approvals disabled. Bonzi has more autonomy now.'
      )
      const nextShellState = await window.bonzi.app.getShellState()
      options.onApplyShellState(nextShellState)
      options.onConversationNeedsRender()
    } catch (error) {
      options.setStatusMessage(`Failed to update approval settings: ${String(error)}`)
      await hydrateApprovalSettings()
    } finally {
      setSavingApprovalSettings(false)
      rerenderApprovalSettings()
    }
  }

  approvalSettingsEl.addEventListener('change', handleApprovalSettingsChange)

  rerenderApprovalSettings()

  return {
    hydrateApprovalSettings,
    syncApprovalSettings: (settings) => {
      approvalSettings = settings
      rerenderApprovalSettings()
    },
    getApprovalSettings: () => approvalSettings,
    isApprovalsEnabled: () => approvalSettings?.approvalsEnabled !== false,
    dispose: () => {
      approvalSettingsEl.removeEventListener('change', handleApprovalSettingsChange)
    }
  }
}
