interface SettingsStatusControllerOptions {
  settingsStatusEl: HTMLElement
  applyRuntimeChangesButton: HTMLButtonElement
}

export interface SettingsStatusController {
  setStatusMessage(message: string): void
  setRuntimeReloadPending(pending: boolean): void
  setPluginSaving(saving: boolean): void
  setApprovalSaving(saving: boolean): void
  setCharacterSaving(saving: boolean): void
  setKnowledgeSaving(saving: boolean): void
  setApplyingRuntimeChanges(applying: boolean): void
  isApplyingRuntimeChanges(): boolean
  getRuntimeReloadPending(): boolean
}

export function createSettingsStatusController(
  options: SettingsStatusControllerOptions
): SettingsStatusController {
  const { settingsStatusEl, applyRuntimeChangesButton } = options

  let isPluginSaving = false
  let isApprovalSaving = false
  let isCharacterSaving = false
  let isKnowledgeSaving = false
  let isApplyingRuntimeChanges = false
  let isRuntimeReloadPending = false
  let settingsStatusMessage = ''

  const syncSettingsStatusUi = (): void => {
    const runtimeMessage = isRuntimeReloadPending
      ? 'Runtime settings changes are pending. Apply Runtime Changes to reload elizaOS now.'
      : ''

    settingsStatusEl.textContent = [settingsStatusMessage, runtimeMessage]
      .filter((value) => value.trim().length > 0)
      .join(' ')

    settingsStatusEl.dataset.runtimeReloadPending = String(isRuntimeReloadPending)
    applyRuntimeChangesButton.dataset.runtimeReloadPending = String(isRuntimeReloadPending)
    applyRuntimeChangesButton.hidden = !isRuntimeReloadPending
    applyRuntimeChangesButton.disabled =
      isPluginSaving ||
      isApprovalSaving ||
      isCharacterSaving ||
      isKnowledgeSaving ||
      isApplyingRuntimeChanges
  }

  syncSettingsStatusUi()

  return {
    setStatusMessage: (message) => {
      settingsStatusMessage = message
      syncSettingsStatusUi()
    },
    setRuntimeReloadPending: (pending) => {
      isRuntimeReloadPending = pending
      syncSettingsStatusUi()
    },
    setPluginSaving: (saving) => {
      isPluginSaving = saving
      syncSettingsStatusUi()
    },
    setApprovalSaving: (saving) => {
      isApprovalSaving = saving
      syncSettingsStatusUi()
    },
    setCharacterSaving: (saving) => {
      isCharacterSaving = saving
      syncSettingsStatusUi()
    },
    setKnowledgeSaving: (saving) => {
      isKnowledgeSaving = saving
      syncSettingsStatusUi()
    },
    setApplyingRuntimeChanges: (applying) => {
      isApplyingRuntimeChanges = applying
      syncSettingsStatusUi()
    },
    isApplyingRuntimeChanges: () => isApplyingRuntimeChanges,
    getRuntimeReloadPending: () => isRuntimeReloadPending
  }
}
