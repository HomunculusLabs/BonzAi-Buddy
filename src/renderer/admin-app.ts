import type { RuntimeApprovalSettings } from '../shared/contracts/approvals'
import { mountAdminAppDom } from './admin-app-dom'
import { createRuntimeAdminController } from './runtime-admin-controller'
import {
  createSettingsManagementSurface,
  type SettingsManagementSurface
} from './settings-management-surface'
import { createSettingsTabsController } from './settings-tabs-controller'

const ADMIN_SETTINGS_TAB_IDS = [
  'runtime',
  'general',
  'approvals',
  'character',
  'knowledge',
  'hermes',
  'routing',
  'plugins'
] as const

const BRIDGE_UNAVAILABLE_MESSAGE =
  'Bonzi preload bridge is unavailable. Open this admin UI inside the Bonzi Electron app.'

export function renderAdminApp(root: HTMLDivElement): void {
  document.body.dataset.bonziSurface = 'admin'

  if (!window.bonzi) {
    renderBridgeUnavailable(root)
    return
  }

  const elements = mountAdminAppDom(root)

  const setStatusMessage = (message: string): void => {
    elements.settingsStatusEl.textContent = message
  }

  let settingsSurface: SettingsManagementSurface | null = null

  const runtimeAdminController = createRuntimeAdminController({
    runtimeAdminEl: elements.runtimeAdminEl,
    setStatusMessage,
    onRuntimeReloaded: () => {
      settingsSurface?.setRuntimeReloadPending(false)
      void settingsSurface?.hydrateProviderSettings()
      void settingsSurface?.hydrateHermesSettings()
      void settingsSurface?.hydrateRoutingSettings()
    }
  })

  const tabsController = createSettingsTabsController({
    rootEl: elements.adminShellEl,
    tabIds: ADMIN_SETTINGS_TAB_IDS,
    defaultTabId: 'runtime'
  })

  settingsSurface = createSettingsManagementSurface({
    elements: {
      providerSettingsEl: elements.providerSettingsEl,
      characterSettingsEl: elements.characterSettingsEl,
      knowledgeSettingsEl: elements.knowledgeSettingsEl,
      workspaceSettingsEl: elements.workspaceSettingsEl,
      hermesSettingsEl: elements.hermesSettingsEl,
      routingSettingsEl: elements.routingSettingsEl,
      approvalSettingsEl: elements.approvalSettingsEl,
      pluginSettingsEl: elements.pluginSettingsEl,
      settingsStatusEl: elements.settingsStatusEl,
      applyRuntimeChangesButton: elements.applyRuntimeChangesButton
    },
    onApplyShellState: (state) => {
      runtimeAdminController.syncShellState(state)
    },
    onApprovalSettingsChanged: (_settings: RuntimeApprovalSettings) => {
      // The approvals pane owns its form state; the runtime overview will reflect
      // persisted changes after Refresh state or a runtime reload.
    },
    onApprovalsDisabled: async () => {},
    onConversationNeedsRender: () => {}
  })

  void runtimeAdminController.hydrate()
  settingsSurface.hydrateAll()

  window.addEventListener(
    'beforeunload',
    () => {
      runtimeAdminController.dispose()
      settingsSurface?.dispose()
      tabsController.dispose()
    },
    { once: true }
  )
}

function renderBridgeUnavailable(root: HTMLDivElement): void {
  root.innerHTML = `
    <main class="web-admin">
      <section class="settings-panel web-admin__shell web-admin__bridge-unavailable" role="alert">
        <header class="settings-panel__header web-admin__header">
          <div>
            <p class="settings-panel__eyebrow">Bonzi Admin</p>
            <h1 class="web-admin__title">Bridge unavailable</h1>
            <p>${BRIDGE_UNAVAILABLE_MESSAGE}</p>
          </div>
        </header>
      </section>
    </main>
  `
}
