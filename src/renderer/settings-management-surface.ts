import type { RuntimeApprovalSettings } from '../shared/contracts/approvals'
import type { ElizaPluginSettings } from '../shared/contracts/plugins'
import type { ShellState } from '../shared/contracts/shell'
import { createApprovalSettingsController } from './approval-settings-controller'
import { createCharacterSettingsController } from './character-settings-controller'
import { createKnowledgeSettingsController } from './knowledge-settings-controller'
import { createHermesSettingsController } from './hermes-settings-controller'
import { createProviderSettingsController } from './provider-settings-controller'
import { createRoutingSettingsController } from './routing-settings-controller'
import {
  createPluginSettingsController,
  type HydratePluginSettingsOptions
} from './plugin-settings-controller'
import { createSettingsStatusController } from './settings-status-controller'
import { createWorkspaceSettingsController } from './workspace-settings-controller'

export interface SettingsManagementSurfaceElements {
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

export interface SettingsManagementSurfaceOptions {
  elements: SettingsManagementSurfaceElements
  onApplyShellState(state: ShellState): void
  onApprovalSettingsChanged(settings: RuntimeApprovalSettings): void
  onApprovalsDisabled(): Promise<void>
  onConversationNeedsRender(): void
}

export interface SettingsManagementSurface {
  hydrateAll(): void
  hydrateProviderSettings(): Promise<void>
  hydratePluginSettings(options?: HydratePluginSettingsOptions): Promise<void>
  hydrateApprovalSettings(): Promise<void>
  hydrateCharacterSettings(): Promise<void>
  hydrateKnowledgeSettings(): Promise<void>
  hydrateWorkspaceSettings(): Promise<void>
  hydrateHermesSettings(): Promise<void>
  hydrateRoutingSettings(): Promise<void>
  setPluginSettings(settings: ElizaPluginSettings | null): void
  syncApprovalSettings(settings: RuntimeApprovalSettings | null): void
  getApprovalSettings(): RuntimeApprovalSettings | null
  isApprovalsEnabled(): boolean
  setRuntimeReloadPending(pending: boolean): void
  dispose(): void
}

export function createSettingsManagementSurface(
  options: SettingsManagementSurfaceOptions
): SettingsManagementSurface {
  const {
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
  } = options.elements

  const statusController = createSettingsStatusController({
    settingsStatusEl,
    applyRuntimeChangesButton
  })

  const providerController = createProviderSettingsController({
    providerSettingsEl,
    setStatusMessage: statusController.setStatusMessage,
    setRuntimeReloadPending: statusController.setRuntimeReloadPending,
    onSavingChange: statusController.setProviderSaving
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

  const knowledgeController = createKnowledgeSettingsController({
    knowledgeSettingsEl,
    setStatusMessage: statusController.setStatusMessage,
    onSavingChange: statusController.setKnowledgeSaving
  })

  const workspaceController = createWorkspaceSettingsController({
    workspaceSettingsEl,
    setStatusMessage: statusController.setStatusMessage,
    onApplyShellState: options.onApplyShellState,
    onSavingChange: statusController.setWorkspaceSaving
  })

  const hermesController = createHermesSettingsController({
    hermesSettingsEl,
    setStatusMessage: statusController.setStatusMessage,
    setRuntimeReloadPending: statusController.setRuntimeReloadPending,
    onApplyShellState: options.onApplyShellState,
    onSavingChange: statusController.setHermesSaving
  })

  const routingController = createRoutingSettingsController({
    routingSettingsEl,
    setStatusMessage: statusController.setStatusMessage,
    onSavingChange: statusController.setRoutingSaving
  })

  const pluginController = createPluginSettingsController({
    pluginSettingsEl,
    getApprovalsEnabled: approvalController.isApprovalsEnabled,
    setStatusMessage: statusController.setStatusMessage,
    setRuntimeReloadPending: statusController.setRuntimeReloadPending,
    onApplyShellState: options.onApplyShellState,
    onSavingChange: statusController.setPluginSaving
  })

  const hydrateAll = (): void => {
    void providerController.hydrate()
    void approvalController.hydrateApprovalSettings()
    void characterController.hydrate()
    void workspaceController.hydrate()
    void knowledgeController.hydrate()
    void hermesController.hydrate()
    void routingController.hydrate()
    void pluginController.hydrate()
  }

  const handleApplyRuntimeChangesClick = async (): Promise<void> => {
    if (!window.bonzi || statusController.isApplyingRuntimeChanges()) {
      return
    }

    statusController.setApplyingRuntimeChanges(true)
    statusController.setStatusMessage('Reloading runtime changes…')

    try {
      await window.bonzi.assistant.reloadRuntime()
      statusController.setRuntimeReloadPending(false)
      statusController.setStatusMessage('Runtime reload complete.')
      const nextShellState = await window.bonzi.app.getShellState()
      options.onApplyShellState(nextShellState)
      try {
        await Promise.all([
          providerController.hydrate(),
          hermesController.hydrate()
        ])
      } catch (error) {
        statusController.setStatusMessage(`Runtime reload complete, but settings refresh failed: ${String(error)}`)
      }
    } catch (error) {
      statusController.setStatusMessage(`Runtime reload failed: ${String(error)}`)
    } finally {
      statusController.setApplyingRuntimeChanges(false)
    }
  }

  applyRuntimeChangesButton.addEventListener(
    'click',
    handleApplyRuntimeChangesClick
  )

  return {
    hydrateAll,
    hydrateProviderSettings: providerController.hydrate,
    hydratePluginSettings: (hydrateOptions) => pluginController.hydrate(hydrateOptions),
    hydrateApprovalSettings: approvalController.hydrateApprovalSettings,
    hydrateCharacterSettings: characterController.hydrate,
    hydrateKnowledgeSettings: knowledgeController.hydrate,
    hydrateWorkspaceSettings: workspaceController.hydrate,
    hydrateHermesSettings: hermesController.hydrate,
    hydrateRoutingSettings: routingController.hydrate,
    setPluginSettings: pluginController.setPluginSettings,
    syncApprovalSettings: approvalController.syncApprovalSettings,
    getApprovalSettings: approvalController.getApprovalSettings,
    isApprovalsEnabled: approvalController.isApprovalsEnabled,
    setRuntimeReloadPending: statusController.setRuntimeReloadPending,
    dispose: () => {
      applyRuntimeChangesButton.removeEventListener(
        'click',
        handleApplyRuntimeChangesClick
      )
      pluginController.dispose()
      providerController.dispose()
      workspaceController.dispose()
      hermesController.dispose()
      routingController.dispose()
      knowledgeController.dispose()
      characterController.dispose()
      approvalController.dispose()
    }
  }
}
