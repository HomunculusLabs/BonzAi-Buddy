import {
  type ElizaPluginSettings,
  type RuntimeApprovalSettings,
  type ShellState
} from '../shared/contracts'
import type { MountedAppElements } from './app-dom'
import {
  createPluginSettingsController,
  type HydratePluginSettingsOptions
} from './plugin-settings-controller'
import { createApprovalSettingsController } from './approval-settings-controller'
import { createCharacterSettingsController } from './character-settings-controller'
import { createSettingsStatusController } from './settings-status-controller'

export interface SettingsPanelController {
  setVisible(visible: boolean): void
  toggleVisible(): void
  hydratePluginSettings(options?: HydratePluginSettingsOptions): Promise<void>
  hydrateApprovalSettings(): Promise<void>
  hydrateCharacterSettings(): Promise<void>
  setPluginSettings(settings: ElizaPluginSettings | null): void
  syncApprovalSettings(settings: RuntimeApprovalSettings | null): void
  getApprovalSettings(): RuntimeApprovalSettings | null
  isApprovalsEnabled(): boolean
  setRuntimeReloadPending(pending: boolean): void
  dispose(): void
}

export interface SettingsPanelControllerOptions {
  elements: Pick<
    MountedAppElements,
    | 'settingsButton'
    | 'settingsCloseButton'
    | 'settingsPanelEl'
    | 'characterSettingsEl'
    | 'approvalSettingsEl'
    | 'pluginSettingsEl'
    | 'settingsStatusEl'
    | 'applyRuntimeChangesButton'
    | 'shellEl'
  >
  onOpenSettingsUi(): void
  onApplyShellState(state: ShellState): void
  onApprovalSettingsChanged(settings: RuntimeApprovalSettings): void
  onApprovalsDisabled(): Promise<void>
  onConversationNeedsRender(): void
}

export function createSettingsPanelController(
  options: SettingsPanelControllerOptions
): SettingsPanelController {
  const {
    settingsButton,
    settingsCloseButton,
    settingsPanelEl,
    characterSettingsEl,
    approvalSettingsEl,
    pluginSettingsEl,
    settingsStatusEl,
    applyRuntimeChangesButton,
    shellEl
  } = options.elements

  let isSettingsVisible = false

  const statusController = createSettingsStatusController({
    settingsStatusEl,
    applyRuntimeChangesButton
  })

  const approvalController = createApprovalSettingsController({
    approvalSettingsEl,
    setStatusMessage: statusController.setStatusMessage,
    onApplyShellState: options.onApplyShellState,
    onApprovalSettingsChanged: options.onApprovalSettingsChanged,
    onApprovalsDisabled: options.onApprovalsDisabled,
    onConversationNeedsRender: options.onConversationNeedsRender,
    onSavingChange: statusController.setApprovalSaving
  })

  const characterController = createCharacterSettingsController({
    characterSettingsEl,
    setStatusMessage: statusController.setStatusMessage,
    setRuntimeReloadPending: statusController.setRuntimeReloadPending,
    onSavingChange: statusController.setCharacterSaving
  })

  const pluginController = createPluginSettingsController({
    pluginSettingsEl,
    getApprovalsEnabled: approvalController.isApprovalsEnabled,
    setStatusMessage: statusController.setStatusMessage,
    setRuntimeReloadPending: statusController.setRuntimeReloadPending,
    onApplyShellState: options.onApplyShellState,
    onSavingChange: statusController.setPluginSaving
  })

  const setSettingsVisible = (
    visible: boolean,
    openOptions: { notifyOpen?: boolean } = {}
  ): void => {
    if (visible && openOptions.notifyOpen !== false) {
      options.onOpenSettingsUi()
    }

    isSettingsVisible = visible
    settingsPanelEl.hidden = !visible
    shellEl.classList.toggle('shell--settings-open', visible)

    if (visible) {
      void approvalController.hydrateApprovalSettings()
      void characterController.hydrate()
      void pluginController.hydrate()
    }
  }

  const handleSettingsButtonClick = (): void => {
    options.onOpenSettingsUi()
    setSettingsVisible(!isSettingsVisible, { notifyOpen: false })
  }

  const handleSettingsCloseButtonClick = (): void => {
    setSettingsVisible(false)
  }

  const handleApplyRuntimeChangesClick = async (): Promise<void> => {
    if (!window.bonzi || statusController.isApplyingRuntimeChanges()) {
      return
    }

    statusController.setApplyingRuntimeChanges(true)
    statusController.setStatusMessage('Reloading elizaOS runtime…')

    try {
      await window.bonzi.assistant.reloadRuntime()
      statusController.setRuntimeReloadPending(false)
      statusController.setStatusMessage('Runtime reload complete.')
      const nextShellState = await window.bonzi.app.getShellState()
      options.onApplyShellState(nextShellState)
    } catch (error) {
      statusController.setStatusMessage(`Runtime reload failed: ${String(error)}`)
    } finally {
      statusController.setApplyingRuntimeChanges(false)
    }
  }

  settingsButton.addEventListener('click', handleSettingsButtonClick)
  settingsCloseButton.addEventListener('click', handleSettingsCloseButtonClick)
  applyRuntimeChangesButton.addEventListener(
    'click',
    handleApplyRuntimeChangesClick
  )

  return {
    setVisible: setSettingsVisible,
    toggleVisible: () => {
      setSettingsVisible(!isSettingsVisible)
    },
    hydratePluginSettings: (hydrateOptions) => pluginController.hydrate(hydrateOptions),
    hydrateApprovalSettings: approvalController.hydrateApprovalSettings,
    hydrateCharacterSettings: characterController.hydrate,
    setPluginSettings: pluginController.setPluginSettings,
    syncApprovalSettings: approvalController.syncApprovalSettings,
    getApprovalSettings: approvalController.getApprovalSettings,
    isApprovalsEnabled: approvalController.isApprovalsEnabled,
    setRuntimeReloadPending: statusController.setRuntimeReloadPending,
    dispose: () => {
      settingsButton.removeEventListener('click', handleSettingsButtonClick)
      settingsCloseButton.removeEventListener('click', handleSettingsCloseButtonClick)
      applyRuntimeChangesButton.removeEventListener(
        'click',
        handleApplyRuntimeChangesClick
      )
      pluginController.dispose()
      characterController.dispose()
      approvalController.dispose()
    }
  }
}
