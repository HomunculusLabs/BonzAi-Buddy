import {
  derivePluginInstallEligibility,
  type ShellState,
  type UpdateElizaPluginSettingsRequest
} from '../shared/contracts'
import { isElizaOptionalPluginId } from './plugin-settings-view'
import type {
  PluginSettingsDataClient
} from './plugin-settings-data-client'
import type { PluginSettingsState } from './plugin-settings-state'

interface HydratePluginSettingsOptions {
  preserveStatus?: boolean
  fallbackToSavedSettings?: boolean
}

interface PluginSettingsFlowsOptions {
  state: PluginSettingsState
  client: PluginSettingsDataClient
  getApprovalsEnabled(): boolean
  setStatusMessage(message: string): void
  setRuntimeReloadPending(pending: boolean): void
  onApplyShellState(state: ShellState): void
  onSavingChange(saving: boolean): void
}

export interface PluginSettingsFlows {
  hydrate(options?: HydratePluginSettingsOptions): Promise<void>
  submitPluginSettingsUpdate(
    request: UpdateElizaPluginSettingsRequest,
    pendingStatus: string
  ): Promise<void>
  installDiscoveredPlugin(pluginId: string): Promise<void>
  uninstallInstalledPlugin(pluginId: string): Promise<void>
}

export function createPluginSettingsFlows(
  options: PluginSettingsFlowsOptions
): PluginSettingsFlows {
  const setSavingSettings = (saving: boolean): void => {
    options.state.setSaving(saving)
    options.onSavingChange(saving)
  }

  const hydrate = async (
    hydrateOptions: HydratePluginSettingsOptions = {}
  ): Promise<void> => {
    if (!options.client.isAvailable()) {
      return
    }

    try {
      if (!hydrateOptions.preserveStatus) {
        options.setStatusMessage('')
      }

      options.state.setSettings(await options.client.discoverPluginSettings())
      options.state.render()
    } catch (error) {
      if (hydrateOptions.fallbackToSavedSettings === false) {
        options.setStatusMessage(`Failed to load plugin settings: ${String(error)}`)
        return
      }

      try {
        options.state.setSettings(await options.client.getSavedPluginSettings())
        options.state.render()
      } catch (fallbackError) {
        options.setStatusMessage(
          `Failed to load plugin settings: ${String(fallbackError)}`
        )
      }
    }
  }

  const submitPluginSettingsUpdate = async (
    request: UpdateElizaPluginSettingsRequest,
    pendingStatus: string
  ): Promise<void> => {
    if (!options.client.isAvailable() || options.state.isSaving()) {
      return
    }

    const previousEnabledById = options.state.snapshotEnabledById()

    setSavingSettings(true)
    options.state.render()
    options.setStatusMessage(pendingStatus)

    try {
      await options.client.updatePluginSettings(request)
      await hydrate({ preserveStatus: true })

      const pluginSettings = options.state.getSettings()
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
        options.setRuntimeReloadPending(true)
      }

      options.setStatusMessage(
        enabledChanged
          ? 'Saved plugin settings.'
          : 'Saved plugin settings. Discovery inventory refreshed.'
      )
      options.onApplyShellState(await options.client.getShellState())
    } catch (error) {
      options.setStatusMessage(`Failed to save plugin settings: ${String(error)}`)
      await hydrate({ preserveStatus: true })
    } finally {
      setSavingSettings(false)
      options.state.render()
    }
  }

  const installDiscoveredPlugin = async (pluginId: string): Promise<void> => {
    if (!options.client.isAvailable() || options.state.isSaving()) {
      return
    }

    const availablePlugin = options.state.getAvailablePlugin(pluginId)

    if (!availablePlugin || isElizaOptionalPluginId(pluginId)) {
      return
    }

    const eligibility = derivePluginInstallEligibility({
      packageName: availablePlugin.packageName,
      lifecycleStatus: availablePlugin.lifecycleStatus
    })

    if (!eligibility.eligible) {
      options.setStatusMessage(
        eligibility.reason ?? 'Cannot install this plugin from current registry metadata.'
      )
      return
    }

    const pendingConfirmationOperationId =
      options.state.getPendingConfirmation(pluginId)

    setSavingSettings(true)
    options.state.render()

    try {
      if (!pendingConfirmationOperationId) {
        const previewResult = await options.client.installPlugin({
          id: availablePlugin.id,
          pluginId: availablePlugin.id,
          packageName: availablePlugin.packageName,
          versionRange: availablePlugin.version,
          lifecycleStatus: availablePlugin.lifecycleStatus,
          confirmed: false
        })

        options.setStatusMessage(previewResult.message)

        if (previewResult.confirmationRequired) {
          options.state.setPendingConfirmation(
            pluginId,
            previewResult.operation.operationId
          )
          options.setStatusMessage(
            'Install preview ready. Click Install again to confirm this third-party plugin install.'
          )
        }

        await hydrate({ preserveStatus: true })
        return
      }

      const confirmed =
        !options.getApprovalsEnabled() ||
        window.confirm(
          `Install plugin "${availablePlugin.name}" now? This will run a package install command in the Bonzi workspace.`
        )

      if (!confirmed) {
        options.setStatusMessage('Install cancelled.')
        return
      }

      const previousEnabled =
        options.state.getInstalledPlugin(pluginId)?.enabled ?? false

      const installResult = await options.client.installPlugin({
        id: availablePlugin.id,
        pluginId: availablePlugin.id,
        packageName: availablePlugin.packageName,
        versionRange: availablePlugin.version,
        lifecycleStatus: availablePlugin.lifecycleStatus,
        confirmed: true,
        confirmationOperationId: pendingConfirmationOperationId
      })

      options.state.deletePendingConfirmation(pluginId)
      options.setStatusMessage(installResult.message)
      await hydrate({ preserveStatus: true })

      const nextEnabled = options.state.getInstalledPlugin(pluginId)?.enabled ?? false

      if (previousEnabled !== nextEnabled) {
        options.setRuntimeReloadPending(true)
      }
    } catch (error) {
      options.setStatusMessage(`Failed to install plugin: ${String(error)}`)
      options.state.deletePendingConfirmation(pluginId)
      await hydrate({ preserveStatus: true })
    } finally {
      setSavingSettings(false)
      options.state.render()
    }
  }

  const uninstallInstalledPlugin = async (pluginId: string): Promise<void> => {
    if (!options.client.isAvailable() || options.state.isSaving()) {
      return
    }

    const installedPlugin = options.state.getInstalledPlugin(pluginId)

    if (!installedPlugin || !installedPlugin.removable) {
      return
    }

    const confirmed =
      !options.getApprovalsEnabled() ||
      window.confirm(
        `Uninstall plugin "${installedPlugin.name}"? This removes the package from Bonzi workspace dependencies.`
      )

    if (!confirmed) {
      return
    }

    const previousEnabled = installedPlugin.enabled

    setSavingSettings(true)
    options.state.render()
    options.setStatusMessage('Uninstalling plugin…')

    try {
      const uninstallResult = await options.client.uninstallPlugin({
        id: installedPlugin.id,
        pluginId: installedPlugin.id,
        packageName: installedPlugin.packageName,
        confirmed: true
      })

      options.setStatusMessage(uninstallResult.message)
      await hydrate({ preserveStatus: true })

      if (uninstallResult.ok && previousEnabled) {
        options.setRuntimeReloadPending(true)
      }
    } catch (error) {
      options.setStatusMessage(`Failed to uninstall plugin: ${String(error)}`)
      await hydrate({ preserveStatus: true })
    } finally {
      setSavingSettings(false)
      options.state.render()
    }
  }

  return {
    hydrate,
    submitPluginSettingsUpdate,
    installDiscoveredPlugin,
    uninstallInstalledPlugin
  }
}
