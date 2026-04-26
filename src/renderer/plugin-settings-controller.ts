import {
  type ElizaPluginSettings,
  type ShellState,
  type UpdateElizaPluginSettingsRequest
} from '../shared/contracts'
import {
  isElizaOptionalPluginId,
  renderPluginSettings
} from './plugin-settings-view'

export interface HydratePluginSettingsOptions {
  preserveStatus?: boolean
  fallbackToSavedSettings?: boolean
}

interface PluginSettingsControllerOptions {
  pluginSettingsEl: HTMLElement
  getApprovalsEnabled(): boolean
  setStatusMessage(message: string): void
  setRuntimeReloadPending(pending: boolean): void
  onApplyShellState(state: ShellState): void
  onSavingChange(saving: boolean): void
}

export interface PluginSettingsController {
  hydrate(options?: HydratePluginSettingsOptions): Promise<void>
  setPluginSettings(settings: ElizaPluginSettings | null): void
  dispose(): void
}

export function createPluginSettingsController(
  options: PluginSettingsControllerOptions
): PluginSettingsController {
  const { pluginSettingsEl } = options

  let pluginSettings: ElizaPluginSettings | null = null
  const pendingPluginInstallConfirmations = new Map<string, string>()
  let isSavingSettings = false

  const rerenderPluginSettings = (): void => {
    renderPluginSettings(pluginSettingsEl, pluginSettings, {
      isSaving: isSavingSettings
    })
  }

  const prunePendingPluginInstallConfirmations = (): void => {
    for (const pluginId of pendingPluginInstallConfirmations.keys()) {
      if (!pluginSettings?.availablePlugins.some((plugin) => plugin.id === pluginId)) {
        pendingPluginInstallConfirmations.delete(pluginId)
      }
    }
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

  const setSavingSettings = (saving: boolean): void => {
    isSavingSettings = saving
    options.onSavingChange(saving)
  }

  const hydrate = async (
    hydrateOptions: HydratePluginSettingsOptions = {}
  ): Promise<void> => {
    if (!window.bonzi) {
      return
    }

    try {
      if (!hydrateOptions.preserveStatus) {
        options.setStatusMessage('')
      }

      pluginSettings = await discoverPluginSettings()
      prunePendingPluginInstallConfirmations()
      rerenderPluginSettings()
    } catch (error) {
      if (hydrateOptions.fallbackToSavedSettings === false) {
        options.setStatusMessage(`Failed to load plugin settings: ${String(error)}`)
        return
      }

      try {
        pluginSettings = await window.bonzi.settings.getElizaPlugins()
        prunePendingPluginInstallConfirmations()
        rerenderPluginSettings()
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
    if (!window.bonzi || isSavingSettings) {
      return
    }

    const previousEnabledById = new Map(
      (pluginSettings?.installedPlugins ?? []).map((plugin) => [
        plugin.id,
        plugin.enabled
      ])
    )

    setSavingSettings(true)
    rerenderPluginSettings()
    options.setStatusMessage(pendingStatus)

    try {
      await window.bonzi.settings.updateElizaPlugins(request)
      await hydrate({ preserveStatus: true })

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
      const nextShellState = await window.bonzi.app.getShellState()
      options.onApplyShellState(nextShellState)
    } catch (error) {
      options.setStatusMessage(`Failed to save plugin settings: ${String(error)}`)
      await hydrate({ preserveStatus: true })
    } finally {
      setSavingSettings(false)
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
      options.setStatusMessage(
        'Cannot install this plugin because registry metadata did not include a package name.'
      )
      return
    }

    const pendingConfirmationOperationId =
      pendingPluginInstallConfirmations.get(pluginId)

    setSavingSettings(true)
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

        options.setStatusMessage(previewResult.message)

        if (previewResult.confirmationRequired) {
          pendingPluginInstallConfirmations.set(
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
      options.setStatusMessage(installResult.message)
      await hydrate({ preserveStatus: true })

      const nextEnabled =
        pluginSettings?.installedPlugins.find((plugin) => plugin.id === pluginId)
          ?.enabled ?? false

      if (previousEnabled !== nextEnabled) {
        options.setRuntimeReloadPending(true)
      }
    } catch (error) {
      options.setStatusMessage(`Failed to install plugin: ${String(error)}`)
      pendingPluginInstallConfirmations.delete(pluginId)
      await hydrate({ preserveStatus: true })
    } finally {
      setSavingSettings(false)
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
      !options.getApprovalsEnabled() ||
      window.confirm(
        `Uninstall plugin "${installedPlugin.name}"? This removes the package from Bonzi workspace dependencies.`
      )

    if (!confirmed) {
      return
    }

    const previousEnabled = installedPlugin.enabled

    setSavingSettings(true)
    rerenderPluginSettings()
    options.setStatusMessage('Uninstalling plugin…')

    try {
      const uninstallResult = await window.bonzi.plugins.uninstall({
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
      rerenderPluginSettings()
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

  pluginSettingsEl.addEventListener('change', handlePluginSettingsChange)
  pluginSettingsEl.addEventListener('click', handlePluginSettingsClick)

  rerenderPluginSettings()

  return {
    hydrate,
    setPluginSettings: (settings) => {
      pluginSettings = settings
      prunePendingPluginInstallConfirmations()
      rerenderPluginSettings()
    },
    dispose: () => {
      pluginSettingsEl.removeEventListener('change', handlePluginSettingsChange)
      pluginSettingsEl.removeEventListener('click', handlePluginSettingsClick)
    }
  }
}
