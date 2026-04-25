import {
  type ElizaPluginSettings,
  type RuntimeApprovalSettings,
  type ShellState,
  type UpdateElizaPluginSettingsRequest
} from '../shared/contracts'
import type { MountedAppElements } from './app-dom'
import {
  isElizaOptionalPluginId,
  renderPluginSettings
} from './plugin-settings-view'

interface HydratePluginSettingsOptions {
  preserveStatus?: boolean
  fallbackToSavedSettings?: boolean
}

export interface SettingsPanelController {
  setVisible(visible: boolean): void
  toggleVisible(): void
  hydratePluginSettings(options?: HydratePluginSettingsOptions): Promise<void>
  hydrateApprovalSettings(): Promise<void>
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
    approvalSettingsEl,
    pluginSettingsEl,
    settingsStatusEl,
    applyRuntimeChangesButton,
    shellEl
  } = options.elements

  let pluginSettings: ElizaPluginSettings | null = null
  let approvalSettings: RuntimeApprovalSettings | null = null
  const pendingPluginInstallConfirmations = new Map<string, string>()
  let isSettingsVisible = false
  let isSavingSettings = false
  let isSavingApprovalSettings = false
  let isApplyingRuntimeChanges = false
  let isRuntimeReloadPending = false
  let settingsStatusMessage = ''

  const syncSettingsStatusUi = (): void => {
    const runtimeMessage = isRuntimeReloadPending
      ? 'Runtime plugin changes are pending. Apply Runtime Changes to reload elizaOS now.'
      : ''
    settingsStatusEl.textContent = [settingsStatusMessage, runtimeMessage]
      .filter((value) => value.trim().length > 0)
      .join(' ')

    applyRuntimeChangesButton.hidden = !isRuntimeReloadPending
    applyRuntimeChangesButton.disabled =
      isSavingSettings || isSavingApprovalSettings || isApplyingRuntimeChanges
  }

  const setSettingsStatus = (message: string): void => {
    settingsStatusMessage = message
    syncSettingsStatusUi()
  }

  const setRuntimeReloadPending = (pending: boolean): void => {
    isRuntimeReloadPending = pending
    syncSettingsStatusUi()
  }

  const rerenderPluginSettings = (): void => {
    renderPluginSettings(pluginSettingsEl, pluginSettings, {
      isSaving: isSavingSettings
    })
    syncSettingsStatusUi()
  }

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

  const discoverPluginSettings = async (): Promise<ElizaPluginSettings> => {
    if (!window.bonzi) {
      throw new Error('Bonzi bridge unavailable')
    }

    if (typeof window.bonzi.plugins?.discover !== 'function') {
      return window.bonzi.settings.getElizaPlugins()
    }

    try {
      return await window.bonzi.plugins.discover({
        includeInstalled: true
      } as unknown as Parameters<typeof window.bonzi.plugins.discover>[0])
    } catch {
      return window.bonzi.plugins.discover({})
    }
  }

  const prunePendingPluginInstallConfirmations = (): void => {
    for (const pluginId of pendingPluginInstallConfirmations.keys()) {
      if (!pluginSettings?.availablePlugins.some((plugin) => plugin.id === pluginId)) {
        pendingPluginInstallConfirmations.delete(pluginId)
      }
    }
  }

  const hydratePluginSettings = async (
    options: HydratePluginSettingsOptions = {}
  ): Promise<void> => {
    if (!window.bonzi) {
      return
    }

    try {
      if (!options.preserveStatus) {
        setSettingsStatus('')
      }
      pluginSettings = await discoverPluginSettings()
      prunePendingPluginInstallConfirmations()
      rerenderPluginSettings()
    } catch (error) {
      if (options.fallbackToSavedSettings === false) {
        setSettingsStatus(`Failed to load plugin settings: ${String(error)}`)
        return
      }

      try {
        pluginSettings = await window.bonzi.settings.getElizaPlugins()
        prunePendingPluginInstallConfirmations()
        rerenderPluginSettings()
      } catch (fallbackError) {
        setSettingsStatus(`Failed to load plugin settings: ${String(fallbackError)}`)
      }
    }
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
      setSettingsStatus(`Failed to load approval settings: ${String(error)}`)
    }
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
      void hydrateApprovalSettings()
      void hydratePluginSettings()
    }
  }

  const submitPluginSettingsUpdate = async (
    request: UpdateElizaPluginSettingsRequest,
    pendingStatus: string
  ): Promise<void> => {
    if (!window.bonzi || isSavingSettings) {
      return
    }

    const previousEnabledById = new Map(
      (pluginSettings?.installedPlugins ?? []).map((plugin) => [
        plugin.id,
        plugin.enabled
      ])
    )

    isSavingSettings = true
    rerenderPluginSettings()
    setSettingsStatus(pendingStatus)

    try {
      await window.bonzi.settings.updateElizaPlugins(request)
      await hydratePluginSettings({ preserveStatus: true })

      const enabledChanged = request.operations.some((operation) => {
        if (operation.type !== 'set-enabled') {
          return false
        }

        const previousEnabled = previousEnabledById.get(operation.id)
        const nextEnabled = pluginSettings?.installedPlugins.find(
          (plugin) => plugin.id === operation.id
        )?.enabled

        return (
          typeof previousEnabled === 'boolean' &&
          typeof nextEnabled === 'boolean' &&
          previousEnabled !== nextEnabled
        )
      })

      if (enabledChanged) {
        setRuntimeReloadPending(true)
      }

      setSettingsStatus(
        enabledChanged
          ? 'Saved plugin settings.'
          : 'Saved plugin settings. Discovery inventory refreshed.'
      )
      const nextShellState = await window.bonzi.app.getShellState()
      options.onApplyShellState(nextShellState)
    } catch (error) {
      setSettingsStatus(`Failed to save plugin settings: ${String(error)}`)
      await hydratePluginSettings({ preserveStatus: true })
    } finally {
      isSavingSettings = false
      rerenderPluginSettings()
    }
  }

  const installDiscoveredPlugin = async (pluginId: string): Promise<void> => {
    if (!window.bonzi || isSavingSettings || !pluginSettings) {
      return
    }

    const availablePlugin = pluginSettings.availablePlugins.find(
      (plugin) => plugin.id === pluginId
    )

    if (!availablePlugin || isElizaOptionalPluginId(pluginId)) {
      return
    }

    if (!availablePlugin.packageName) {
      setSettingsStatus('Cannot install this plugin because registry metadata did not include a package name.')
      return
    }

    const pendingConfirmationOperationId = pendingPluginInstallConfirmations.get(pluginId)

    isSavingSettings = true
    rerenderPluginSettings()

    try {
      if (!pendingConfirmationOperationId) {
        const previewResult = await window.bonzi.plugins.install({
          id: availablePlugin.id,
          pluginId: availablePlugin.id,
          packageName: availablePlugin.packageName,
          versionRange: availablePlugin.version,
          confirmed: false
        })

        setSettingsStatus(previewResult.message)

        if (previewResult.confirmationRequired) {
          pendingPluginInstallConfirmations.set(
            pluginId,
            previewResult.operation.operationId
          )
          setSettingsStatus(
            'Install preview ready. Click Install again to confirm this third-party plugin install.'
          )
        }

        await hydratePluginSettings({ preserveStatus: true })
        return
      }

      const confirmed =
        approvalSettings?.approvalsEnabled === false ||
        window.confirm(
          `Install plugin "${availablePlugin.name}" now? This will run a package install command in the Bonzi workspace.`
        )

      if (!confirmed) {
        setSettingsStatus('Install cancelled.')
        return
      }

      const previousEnabled =
        pluginSettings.installedPlugins.find((plugin) => plugin.id === pluginId)
          ?.enabled ?? false
      const installResult = await window.bonzi.plugins.install({
        id: availablePlugin.id,
        pluginId: availablePlugin.id,
        packageName: availablePlugin.packageName,
        versionRange: availablePlugin.version,
        confirmed: true,
        confirmationOperationId: pendingConfirmationOperationId
      })

      pendingPluginInstallConfirmations.delete(pluginId)
      setSettingsStatus(installResult.message)
      await hydratePluginSettings({ preserveStatus: true })

      const nextEnabled =
        pluginSettings?.installedPlugins.find((plugin) => plugin.id === pluginId)
          ?.enabled ?? false

      if (previousEnabled !== nextEnabled) {
        setRuntimeReloadPending(true)
      }
    } catch (error) {
      setSettingsStatus(`Failed to install plugin: ${String(error)}`)
      pendingPluginInstallConfirmations.delete(pluginId)
      await hydratePluginSettings({ preserveStatus: true })
    } finally {
      isSavingSettings = false
      rerenderPluginSettings()
    }
  }

  const uninstallInstalledPlugin = async (pluginId: string): Promise<void> => {
    if (!window.bonzi || isSavingSettings || !pluginSettings) {
      return
    }

    const installedPlugin = pluginSettings.installedPlugins.find(
      (plugin) => plugin.id === pluginId
    )

    if (!installedPlugin || !installedPlugin.removable) {
      return
    }

    const confirmed =
      approvalSettings?.approvalsEnabled === false ||
      window.confirm(
        `Uninstall plugin "${installedPlugin.name}"? This removes the package from Bonzi workspace dependencies.`
      )

    if (!confirmed) {
      return
    }

    const previousEnabled = installedPlugin.enabled

    isSavingSettings = true
    rerenderPluginSettings()
    setSettingsStatus('Uninstalling plugin…')

    try {
      const uninstallResult = await window.bonzi.plugins.uninstall({
        id: installedPlugin.id,
        pluginId: installedPlugin.id,
        packageName: installedPlugin.packageName,
        confirmed: true
      })

      setSettingsStatus(uninstallResult.message)
      await hydratePluginSettings({ preserveStatus: true })

      if (uninstallResult.ok && previousEnabled) {
        setRuntimeReloadPending(true)
      }
    } catch (error) {
      setSettingsStatus(`Failed to uninstall plugin: ${String(error)}`)
      await hydratePluginSettings({ preserveStatus: true })
    } finally {
      isSavingSettings = false
      rerenderPluginSettings()
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
    if (!window.bonzi || isApplyingRuntimeChanges) {
      return
    }

    isApplyingRuntimeChanges = true
    syncSettingsStatusUi()
    setSettingsStatus('Reloading elizaOS runtime…')

    try {
      await window.bonzi.assistant.reloadRuntime()
      setRuntimeReloadPending(false)
      setSettingsStatus('Runtime reload complete.')
      const nextShellState = await window.bonzi.app.getShellState()
      options.onApplyShellState(nextShellState)
    } catch (error) {
      setSettingsStatus(`Runtime reload failed: ${String(error)}`)
    } finally {
      isApplyingRuntimeChanges = false
      syncSettingsStatusUi()
    }
  }

  const handlePluginSettingsChange = async (event: Event): Promise<void> => {
    const target = event.target

    if (!(target instanceof HTMLInputElement)) {
      return
    }

    const pluginId = target.dataset.pluginToggle

    if (!pluginId || !pluginSettings) {
      return
    }

    const plugin = pluginSettings.installedPlugins.find(
      (candidate) => candidate.id === pluginId
    )

    if (!plugin || plugin.required || (!plugin.configurable && !plugin.removable)) {
      return
    }

    await submitPluginSettingsUpdate(
      {
        operations: [
          {
            type: 'set-enabled',
            id: pluginId,
            enabled: target.checked
          }
        ]
      },
      'Saving plugin settings…'
    )
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

    isSavingApprovalSettings = true
    rerenderApprovalSettings()
    setSettingsStatus(
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

      setSettingsStatus(
        approvalSettings.approvalsEnabled
          ? 'Action approvals enabled.'
          : 'Action approvals disabled. Bonzi has more autonomy now.'
      )
      const nextShellState = await window.bonzi.app.getShellState()
      options.onApplyShellState(nextShellState)
      options.onConversationNeedsRender()
    } catch (error) {
      setSettingsStatus(`Failed to update approval settings: ${String(error)}`)
      await hydrateApprovalSettings()
    } finally {
      isSavingApprovalSettings = false
      rerenderApprovalSettings()
    }
  }

  const handlePluginSettingsClick = async (event: MouseEvent): Promise<void> => {
    const target = event.target

    if (!(target instanceof HTMLElement)) {
      return
    }

    const installButton = target.closest<HTMLButtonElement>('[data-plugin-install]')
    const uninstallButton = target.closest<HTMLButtonElement>(
      '[data-plugin-uninstall]'
    )
    const addButton = target.closest<HTMLButtonElement>('[data-plugin-add]')
    const removeButton = target.closest<HTMLButtonElement>('[data-plugin-remove]')

    if (installButton?.dataset.pluginInstall) {
      await installDiscoveredPlugin(installButton.dataset.pluginInstall)
      return
    }

    if (uninstallButton?.dataset.pluginUninstall) {
      await uninstallInstalledPlugin(uninstallButton.dataset.pluginUninstall)
      return
    }

    const pluginId = addButton?.dataset.pluginAdd ?? removeButton?.dataset.pluginRemove

    if (!pluginId || !isElizaOptionalPluginId(pluginId)) {
      return
    }

    if (addButton) {
      await submitPluginSettingsUpdate(
        {
          operations: [
            {
              type: 'add',
              id: pluginId
            }
          ]
        },
        'Adding bundled plugin…'
      )
      return
    }

    const plugin = pluginSettings?.installedPlugins.find(
      (candidate) => candidate.id === pluginId
    )

    if (!plugin?.removable) {
      return
    }

    await submitPluginSettingsUpdate(
      {
        operations: [
          {
            type: 'remove',
            id: pluginId
          }
        ]
      },
      'Removing plugin…'
    )
  }

  settingsButton.addEventListener('click', handleSettingsButtonClick)
  settingsCloseButton.addEventListener('click', handleSettingsCloseButtonClick)
  applyRuntimeChangesButton.addEventListener(
    'click',
    handleApplyRuntimeChangesClick
  )
  pluginSettingsEl.addEventListener('change', handlePluginSettingsChange)
  approvalSettingsEl.addEventListener('change', handleApprovalSettingsChange)
  pluginSettingsEl.addEventListener('click', handlePluginSettingsClick)

  rerenderPluginSettings()
  rerenderApprovalSettings()

  return {
    setVisible: setSettingsVisible,
    toggleVisible: () => {
      setSettingsVisible(!isSettingsVisible)
    },
    hydratePluginSettings,
    hydrateApprovalSettings,
    setPluginSettings: (settings) => {
      pluginSettings = settings
      prunePendingPluginInstallConfirmations()
      rerenderPluginSettings()
    },
    syncApprovalSettings: (settings) => {
      approvalSettings = settings
      rerenderApprovalSettings()
    },
    getApprovalSettings: () => approvalSettings,
    isApprovalsEnabled: () => approvalSettings?.approvalsEnabled !== false,
    setRuntimeReloadPending,
    dispose: () => {
      settingsButton.removeEventListener('click', handleSettingsButtonClick)
      settingsCloseButton.removeEventListener('click', handleSettingsCloseButtonClick)
      applyRuntimeChangesButton.removeEventListener(
        'click',
        handleApplyRuntimeChangesClick
      )
      pluginSettingsEl.removeEventListener('change', handlePluginSettingsChange)
      approvalSettingsEl.removeEventListener('change', handleApprovalSettingsChange)
      pluginSettingsEl.removeEventListener('click', handlePluginSettingsClick)
    }
  }
}
