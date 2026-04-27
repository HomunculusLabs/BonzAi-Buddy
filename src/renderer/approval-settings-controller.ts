import {
  type RuntimeApprovalSettings,
  type RuntimeContinuationSettings,
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

const CONTINUATION_DEFAULTS: RuntimeContinuationSettings = {
  maxSteps: 6,
  maxRuntimeMs: 120_000,
  postActionDelayMs: 750
}

const CONTINUATION_LIMITS: Record<
  keyof RuntimeContinuationSettings,
  { min: number; max: number }
> = {
  maxSteps: { min: 1, max: 20 },
  maxRuntimeMs: { min: 5_000, max: 600_000 },
  postActionDelayMs: { min: 0, max: 10_000 }
}

function clampContinuationSetting(
  key: keyof RuntimeContinuationSettings,
  value: number
): number {
  const bounds = CONTINUATION_LIMITS[key]

  return Math.min(bounds.max, Math.max(bounds.min, value))
}

function getEffectiveSettings(
  settings: RuntimeApprovalSettings | null
): RuntimeApprovalSettings {
  return {
    approvalsEnabled: settings?.approvalsEnabled !== false,
    continuation: {
      ...CONTINUATION_DEFAULTS,
      ...(settings?.continuation ?? {})
    }
  }
}

function isContinuationField(
  value: string | undefined
): value is keyof RuntimeContinuationSettings {
  return (
    value === 'maxSteps' ||
    value === 'maxRuntimeMs' ||
    value === 'postActionDelayMs'
  )
}

export function createApprovalSettingsController(
  options: ApprovalSettingsControllerOptions
): ApprovalSettingsController {
  const { approvalSettingsEl } = options

  let approvalSettings: RuntimeApprovalSettings | null = null
  let isSavingApprovalSettings = false

  const rerenderApprovalSettings = (): void => {
    const effectiveSettings = getEffectiveSettings(approvalSettings)
    const approvalsEnabled = effectiveSettings.approvalsEnabled

    approvalSettingsEl.innerHTML = `
      <div class="settings-panel__section-header">
        <h3 class="settings-panel__section-title">Action approvals</h3>
        <p class="settings-panel__section-copy">
          ${approvalsEnabled
            ? 'Sensitive action cards, workflow steps, and plugin operations pause for approval.'
            : 'Actions, workflows, and plugin operations that would normally ask approval continue automatically.'}
        </p>
      </div>
      <label class="settings-toggle-card approval-settings-row">
        <span class="settings-toggle-card__copy">
          <span class="settings-toggle-card__title">
            Bonzi approvals
            <span class="settings-badge">${approvalsEnabled ? 'Enabled' : 'Autonomous'}</span>
          </span>
          <span class="settings-toggle-card__description">
            Turn this off for more autonomy. Disabling requires explicit confirmation once.
          </span>
        </span>
        <span class="settings-toggle-card__actions">
          <span>${approvalsEnabled ? 'On' : 'Off'}</span>
          <input
            class="settings-toggle-card__toggle"
            type="checkbox"
            data-approval-toggle
            ${approvalsEnabled ? 'checked' : ''}
            ${isSavingApprovalSettings ? 'disabled' : ''}
          />
        </span>
      </label>

      <section class="settings-card approval-continuation-settings" aria-label="Continuation settings">
        <div class="settings-panel__section-header">
          <h4 class="settings-panel__section-title">Continuation pacing</h4>
          <p class="settings-panel__section-copy">
            Bound autonomous continuation loops after external action cards complete.
          </p>
        </div>

        <label class="approval-continuation-field">
          <span class="approval-continuation-field__copy">
            <strong>Max continuation steps</strong>
            <small>Stop the workflow after this many continuation passes.</small>
          </span>
          <input
            class="approval-continuation-field__input"
            type="number"
            data-continuation-field="maxSteps"
            min="${CONTINUATION_LIMITS.maxSteps.min}"
            max="${CONTINUATION_LIMITS.maxSteps.max}"
            step="1"
            value="${effectiveSettings.continuation.maxSteps}"
            ${isSavingApprovalSettings ? 'disabled' : ''}
          />
        </label>

        <label class="approval-continuation-field">
          <span class="approval-continuation-field__copy">
            <strong>Max workflow runtime (ms)</strong>
            <small>Hard timeout for continued workflow execution.</small>
          </span>
          <input
            class="approval-continuation-field__input"
            type="number"
            data-continuation-field="maxRuntimeMs"
            min="${CONTINUATION_LIMITS.maxRuntimeMs.min}"
            max="${CONTINUATION_LIMITS.maxRuntimeMs.max}"
            step="100"
            value="${effectiveSettings.continuation.maxRuntimeMs}"
            ${isSavingApprovalSettings ? 'disabled' : ''}
          />
        </label>

        <label class="approval-continuation-field">
          <span class="approval-continuation-field__copy">
            <strong>Post-action delay (ms)</strong>
            <small>Pause between action completion and next continuation pass.</small>
          </span>
          <input
            class="approval-continuation-field__input"
            type="number"
            data-continuation-field="postActionDelayMs"
            min="${CONTINUATION_LIMITS.postActionDelayMs.min}"
            max="${CONTINUATION_LIMITS.postActionDelayMs.max}"
            step="50"
            value="${effectiveSettings.continuation.postActionDelayMs}"
            ${isSavingApprovalSettings ? 'disabled' : ''}
          />
        </label>
      </section>
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

  const handleApprovalsToggleChange = async (
    target: HTMLInputElement
  ): Promise<void> => {
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

  const handleContinuationChange = async (
    target: HTMLInputElement
  ): Promise<void> => {
    const fieldKey = target.dataset.continuationField

    if (!isContinuationField(fieldKey) || !window.bonzi || isSavingApprovalSettings) {
      rerenderApprovalSettings()
      return
    }

    const parsed = Number.parseInt(target.value, 10)

    if (!Number.isFinite(parsed)) {
      options.setStatusMessage('Continuation value must be a valid integer.')
      rerenderApprovalSettings()
      return
    }

    const nextValue = clampContinuationSetting(fieldKey, parsed)

    setSavingApprovalSettings(true)
    rerenderApprovalSettings()
    options.setStatusMessage('Updating continuation settings…')

    try {
      approvalSettings = await window.bonzi.settings.updateRuntimeApprovalSettings({
        continuation: {
          [fieldKey]: nextValue
        }
      })
      options.onApprovalSettingsChanged(approvalSettings)
      options.setStatusMessage('Continuation settings updated.')
      const nextShellState = await window.bonzi.app.getShellState()
      options.onApplyShellState(nextShellState)
      options.onConversationNeedsRender()
    } catch (error) {
      options.setStatusMessage(`Failed to update continuation settings: ${String(error)}`)
      await hydrateApprovalSettings()
    } finally {
      setSavingApprovalSettings(false)
      rerenderApprovalSettings()
    }
  }

  const handleApprovalSettingsChange = async (event: Event): Promise<void> => {
    const target = event.target

    if (!(target instanceof HTMLInputElement)) {
      return
    }

    if (target.matches('[data-approval-toggle]')) {
      await handleApprovalsToggleChange(target)
      return
    }

    if (target.matches('[data-continuation-field]')) {
      await handleContinuationChange(target)
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
