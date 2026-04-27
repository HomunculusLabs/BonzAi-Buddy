import type {
  ElizaAvailablePluginEntry,
  ElizaInstalledPluginEntry,
  ElizaPluginSettings
} from '../shared/contracts'
import { renderPluginSettings } from './plugin-settings-view'

export interface PluginSettingsState {
  getSettings(): ElizaPluginSettings | null
  setSettings(settings: ElizaPluginSettings | null): void
  isSaving(): boolean
  setSaving(saving: boolean): void
  getAvailablePlugin(pluginId: string): ElizaAvailablePluginEntry | undefined
  getInstalledPlugin(pluginId: string): ElizaInstalledPluginEntry | undefined
  getPendingConfirmation(pluginId: string): string | undefined
  setPendingConfirmation(pluginId: string, operationId: string): void
  deletePendingConfirmation(pluginId: string): void
  clearStaleConfirmations(): void
  snapshotEnabledById(): Map<string, boolean>
  render(): void
}

export function createPluginSettingsState(options: {
  pluginSettingsEl: HTMLElement
}): PluginSettingsState {
  const { pluginSettingsEl } = options

  let pluginSettings: ElizaPluginSettings | null = null
  const pendingPluginInstallConfirmations = new Map<string, string>()
  let isSavingSettings = false

  const clearStaleConfirmations = (): void => {
    for (const pluginId of pendingPluginInstallConfirmations.keys()) {
      if (!pluginSettings?.availablePlugins.some((plugin) => plugin.id === pluginId)) {
        pendingPluginInstallConfirmations.delete(pluginId)
      }
    }
  }

  return {
    getSettings: () => pluginSettings,
    setSettings: (settings) => {
      pluginSettings = settings
      clearStaleConfirmations()
    },
    isSaving: () => isSavingSettings,
    setSaving: (saving) => {
      isSavingSettings = saving
    },
    getAvailablePlugin: (pluginId) =>
      pluginSettings?.availablePlugins.find((plugin) => plugin.id === pluginId),
    getInstalledPlugin: (pluginId) =>
      pluginSettings?.installedPlugins.find((plugin) => plugin.id === pluginId),
    getPendingConfirmation: (pluginId) =>
      pendingPluginInstallConfirmations.get(pluginId),
    setPendingConfirmation: (pluginId, operationId) => {
      pendingPluginInstallConfirmations.set(pluginId, operationId)
    },
    deletePendingConfirmation: (pluginId) => {
      pendingPluginInstallConfirmations.delete(pluginId)
    },
    clearStaleConfirmations,
    snapshotEnabledById: () =>
      new Map(
        (pluginSettings?.installedPlugins ?? []).map((plugin) => [
          plugin.id,
          plugin.enabled
        ])
      ),
    render: () => {
      renderPluginSettings(pluginSettingsEl, pluginSettings, {
        isSaving: isSavingSettings,
        pendingInstallPluginIds: new Set(pendingPluginInstallConfirmations.keys())
      })
    }
  }
}
