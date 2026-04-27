import { type ElizaPluginSettings, type ShellState } from '../shared/contracts'
import { createPluginSettingsDataClient } from './plugin-settings-data-client'
import { createPluginSettingsFlows } from './plugin-settings-flows'
import { createPluginSettingsState } from './plugin-settings-state'
import { isElizaOptionalPluginId } from './plugin-settings-view'

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

  const state = createPluginSettingsState({ pluginSettingsEl })
  const client = createPluginSettingsDataClient()
  const flows = createPluginSettingsFlows({
    state,
    client,
    getApprovalsEnabled: options.getApprovalsEnabled,
    setStatusMessage: options.setStatusMessage,
    setRuntimeReloadPending: options.setRuntimeReloadPending,
    onApplyShellState: options.onApplyShellState,
    onSavingChange: options.onSavingChange
  })

  const handlePluginSettingsChange = async (event: Event): Promise<void> => {
    const target = event.target

    if (!(target instanceof HTMLInputElement)) {
      return
    }

    const pluginId = target.dataset.pluginToggle

    if (!pluginId) {
      return
    }

    const plugin = state.getInstalledPlugin(pluginId)

    if (!plugin || plugin.required || (!plugin.configurable && !plugin.removable)) {
      return
    }

    await flows.submitPluginSettingsUpdate(
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
      await flows.installDiscoveredPlugin(installButton.dataset.pluginInstall)
      return
    }

    if (uninstallButton?.dataset.pluginUninstall) {
      await flows.uninstallInstalledPlugin(uninstallButton.dataset.pluginUninstall)
      return
    }

    const pluginId = addButton?.dataset.pluginAdd ?? removeButton?.dataset.pluginRemove

    if (!pluginId || !isElizaOptionalPluginId(pluginId)) {
      return
    }

    if (addButton) {
      await flows.submitPluginSettingsUpdate(
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

    const plugin = state.getInstalledPlugin(pluginId)

    if (!plugin?.removable) {
      return
    }

    await flows.submitPluginSettingsUpdate(
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

  state.render()

  return {
    hydrate: (hydrateOptions) => flows.hydrate(hydrateOptions),
    setPluginSettings: (settings) => {
      state.setSettings(settings)
      state.render()
    },
    dispose: () => {
      pluginSettingsEl.removeEventListener('change', handlePluginSettingsChange)
      pluginSettingsEl.removeEventListener('click', handlePluginSettingsClick)
    }
  }
}
