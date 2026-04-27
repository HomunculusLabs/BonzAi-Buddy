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

type SettingsTabId = 'general' | 'approvals' | 'character' | 'plugins'

const SETTINGS_TAB_IDS: SettingsTabId[] = [
  'general',
  'approvals',
  'character',
  'plugins'
]

function normalizeSettingsTabId(value: string | undefined): SettingsTabId {
  return SETTINGS_TAB_IDS.includes(value as SettingsTabId)
    ? (value as SettingsTabId)
    : 'general'
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
  let activeSettingsTab: SettingsTabId = 'general'

  const tabButtons = Array.from(
    settingsPanelEl.querySelectorAll<HTMLButtonElement>('[data-settings-tab]')
  )
  const tabPanes = Array.from(
    settingsPanelEl.querySelectorAll<HTMLElement>('[data-settings-pane]')
  )

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

  const setActiveSettingsTab = (
    tabId: SettingsTabId,
    tabOptions: { focus?: boolean } = {}
  ): void => {
    activeSettingsTab = tabId

    for (const button of tabButtons) {
      const buttonTabId = normalizeSettingsTabId(button.dataset.settingsTab)
      const isSelected = buttonTabId === activeSettingsTab
      button.setAttribute('aria-selected', String(isSelected))
      button.tabIndex = isSelected ? 0 : -1

      if (isSelected && tabOptions.focus) {
        button.focus()
      }
    }

    for (const pane of tabPanes) {
      const paneTabId = normalizeSettingsTabId(pane.dataset.settingsPane)
      pane.hidden = paneTabId !== activeSettingsTab
    }
  }

  const focusActiveTabSoon = (): void => {
    window.requestAnimationFrame(() => {
      if (!isSettingsVisible) {
        return
      }

      setActiveSettingsTab(activeSettingsTab, { focus: true })
    })
  }

  const handleSettingsTabClick = (event: MouseEvent): void => {
    const target = event.target

    if (!(target instanceof HTMLElement)) {
      return
    }

    const tabButton = target.closest<HTMLButtonElement>('[data-settings-tab]')

    if (!tabButton) {
      return
    }

    setActiveSettingsTab(normalizeSettingsTabId(tabButton.dataset.settingsTab), {
      focus: true
    })
  }

  const handleSettingsTabKeydown = (event: KeyboardEvent): void => {
    const target = event.target

    if (!(target instanceof HTMLButtonElement) || !target.matches('[data-settings-tab]')) {
      return
    }

    const currentIndex = tabButtons.indexOf(target)
    if (currentIndex < 0) {
      return
    }

    let nextIndex: number | null = null

    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        nextIndex = (currentIndex + 1) % tabButtons.length
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        nextIndex = (currentIndex - 1 + tabButtons.length) % tabButtons.length
        break
      case 'Home':
        nextIndex = 0
        break
      case 'End':
        nextIndex = tabButtons.length - 1
        break
      default:
        return
    }

    event.preventDefault()
    const nextButton = tabButtons[nextIndex]
    setActiveSettingsTab(normalizeSettingsTabId(nextButton.dataset.settingsTab), {
      focus: true
    })
  }

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
      setActiveSettingsTab(activeSettingsTab)
      focusActiveTabSoon()
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

  setActiveSettingsTab(activeSettingsTab)
  settingsButton.addEventListener('click', handleSettingsButtonClick)
  settingsCloseButton.addEventListener('click', handleSettingsCloseButtonClick)
  settingsPanelEl.addEventListener('click', handleSettingsTabClick)
  settingsPanelEl.addEventListener('keydown', handleSettingsTabKeydown)
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
      settingsPanelEl.removeEventListener('click', handleSettingsTabClick)
      settingsPanelEl.removeEventListener('keydown', handleSettingsTabKeydown)
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
