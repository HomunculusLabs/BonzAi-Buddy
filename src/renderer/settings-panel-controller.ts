import type { RuntimeApprovalSettings } from '../shared/contracts/approvals'
import type { ElizaPluginSettings } from '../shared/contracts/plugins'
import type { ShellState } from '../shared/contracts/shell'
import type { MountedAppElements } from './app-dom'
import type { HydratePluginSettingsOptions } from './plugin-settings-controller'
import {
  createSettingsManagementSurface,
  type SettingsManagementSurface
} from './settings-management-surface'
import { createSettingsTabsController } from './settings-tabs-controller'

export interface SettingsPanelController {
  setVisible(visible: boolean): void
  toggleVisible(): void
  hydrateProviderSettings(): Promise<void>
  hydratePluginSettings(options?: HydratePluginSettingsOptions): Promise<void>
  hydrateApprovalSettings(): Promise<void>
  hydrateCharacterSettings(): Promise<void>
  hydrateKnowledgeSettings(): Promise<void>
  hydrateHermesSettings(): Promise<void>
  hydrateRoutingSettings(): Promise<void>
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
    | 'providerSettingsEl'
    | 'characterSettingsEl'
    | 'knowledgeSettingsEl'
    | 'workspaceSettingsEl'
    | 'hermesSettingsEl'
    | 'routingSettingsEl'
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

const COMPANION_SETTINGS_TAB_IDS = [
  'general',
  'approvals',
  'character',
  'knowledge',
  'hermes',
  'routing',
  'plugins'
] as const

export function createSettingsPanelController(
  options: SettingsPanelControllerOptions
): SettingsPanelController {
  const {
    settingsButton,
    settingsCloseButton,
    settingsPanelEl,
    providerSettingsEl,
    characterSettingsEl,
    knowledgeSettingsEl,
    workspaceSettingsEl,
    hermesSettingsEl,
    routingSettingsEl,
    approvalSettingsEl,
    pluginSettingsEl,
    settingsStatusEl,
    applyRuntimeChangesButton,
    shellEl
  } = options.elements

  let isSettingsVisible = false

  const settingsSurface: SettingsManagementSurface = createSettingsManagementSurface({
    elements: {
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
    },
    onApplyShellState: options.onApplyShellState,
    onApprovalSettingsChanged: options.onApprovalSettingsChanged,
    onApprovalsDisabled: options.onApprovalsDisabled,
    onConversationNeedsRender: options.onConversationNeedsRender
  })

  const tabsController = createSettingsTabsController({
    rootEl: settingsPanelEl,
    tabIds: COMPANION_SETTINGS_TAB_IDS,
    defaultTabId: 'general'
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
      tabsController.setActiveTab(tabsController.getActiveTab())
      tabsController.focusActiveTabSoon(() => isSettingsVisible)
      settingsSurface.hydrateAll()
    }
  }

  const handleSettingsButtonClick = (): void => {
    options.onOpenSettingsUi()
    setSettingsVisible(!isSettingsVisible, { notifyOpen: false })
  }

  const handleSettingsCloseButtonClick = (): void => {
    setSettingsVisible(false)
  }

  settingsButton.addEventListener('click', handleSettingsButtonClick)
  settingsCloseButton.addEventListener('click', handleSettingsCloseButtonClick)

  return {
    setVisible: setSettingsVisible,
    toggleVisible: () => {
      setSettingsVisible(!isSettingsVisible)
    },
    hydrateProviderSettings: settingsSurface.hydrateProviderSettings,
    hydratePluginSettings: settingsSurface.hydratePluginSettings,
    hydrateApprovalSettings: settingsSurface.hydrateApprovalSettings,
    hydrateCharacterSettings: settingsSurface.hydrateCharacterSettings,
    hydrateKnowledgeSettings: settingsSurface.hydrateKnowledgeSettings,
    hydrateHermesSettings: settingsSurface.hydrateHermesSettings,
    hydrateRoutingSettings: settingsSurface.hydrateRoutingSettings,
    setPluginSettings: settingsSurface.setPluginSettings,
    syncApprovalSettings: settingsSurface.syncApprovalSettings,
    getApprovalSettings: settingsSurface.getApprovalSettings,
    isApprovalsEnabled: settingsSurface.isApprovalsEnabled,
    setRuntimeReloadPending: settingsSurface.setRuntimeReloadPending,
    dispose: () => {
      settingsButton.removeEventListener('click', handleSettingsButtonClick)
      settingsCloseButton.removeEventListener('click', handleSettingsCloseButtonClick)
      tabsController.dispose()
      settingsSurface.dispose()
    }
  }
}
