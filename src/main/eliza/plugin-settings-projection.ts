import type {
  AssistantProviderInfo,
  ElizaAvailablePluginEntry,
  ElizaInstalledPluginEntry,
  ElizaPluginId,
  ElizaPluginSettings
} from '../../shared/contracts'
import {
  DEFAULT_PLUGIN_RUNTIME_SETTINGS,
  OPTIONAL_PLUGIN_CATALOG,
  PROVIDER_PACKAGE_NAMES,
  type BonziElizaPluginRuntimeSettings,
  type NormalizedCharacterSettings,
  type NormalizedPluginInventory,
  type OptionalPluginCatalogEntry,
  type PersistedPluginRecord
} from './plugin-settings-model'
import {
  createDefaultPluginState,
  isOptionalPluginId,
  isRequiredPluginId
} from './plugin-settings-normalization'

export function buildPluginSettings(input: {
  provider: AssistantProviderInfo
  inventory: NormalizedPluginInventory
}): ElizaPluginSettings {
  const { provider, inventory } = input
  const optionalInstalledPlugins = OPTIONAL_PLUGIN_CATALOG.flatMap((plugin) => {
    const pluginState = inventory[plugin.id] ?? createDefaultPluginState(plugin.id)

    if (!pluginState.installed) {
      return []
    }

    return [catalogEntryToInstalledPlugin(plugin, pluginState)]
  })
  const availablePlugins = OPTIONAL_PLUGIN_CATALOG.flatMap((plugin) => {
    const pluginState = inventory[plugin.id] ?? createDefaultPluginState(plugin.id)

    if (pluginState.installed) {
      return []
    }

    return [catalogEntryToAvailablePlugin(plugin)]
  })
  const unknownInstalledPlugins = Object.entries(inventory)
    .filter(([pluginId, pluginState]) => {
      return (
        !isOptionalPluginId(pluginId) &&
        !isRequiredPluginId(pluginId) &&
        pluginState.installed
      )
    })
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([pluginId, pluginState]) => {
      return unknownEntryToInstalledPlugin(pluginId, pluginState)
    })

  return {
    installedPlugins: [
      {
        id: 'localdb',
        name: 'Local database',
        packageName: '@elizaos/plugin-localdb',
        description: 'Persists Bonzi conversation memory on this device.',
        enabled: true,
        required: true,
        configurable: false,
        removable: false,
        source: 'required',
        lifecycleStatus: 'enabled',
        executionPolicy: 'trusted_auto'
      },
      ...optionalInstalledPlugins,
      ...unknownInstalledPlugins,
      {
        id: 'provider',
        name: provider.label,
        packageName: PROVIDER_PACKAGE_NAMES[provider.kind],
        description:
          'The active model provider plugin selected from Bonzi assistant configuration.',
        enabled: true,
        required: true,
        configurable: false,
        removable: false,
        source: 'required',
        lifecycleStatus: 'enabled',
        executionPolicy: 'trusted_auto'
      }
    ],
    availablePlugins
  }
}

export function buildRuntimeSettings(input: {
  inventory: NormalizedPluginInventory
  approvalsEnabled: boolean
  characterSettings: NormalizedCharacterSettings
}): BonziElizaPluginRuntimeSettings {
  const { inventory, approvalsEnabled, characterSettings } = input

  return {
    contextEnabled:
      inventory['bonzi-context']?.enabled ??
      DEFAULT_PLUGIN_RUNTIME_SETTINGS.contextEnabled,
    desktopActionsEnabled:
      inventory['bonzi-desktop-actions']?.enabled ??
      DEFAULT_PLUGIN_RUNTIME_SETTINGS.desktopActionsEnabled,
    approvalsEnabled,
    character: {
      enabled: characterSettings.enabled,
      characterJson: characterSettings.characterJson,
      override: characterSettings.override
    }
  }
}

function catalogEntryToInstalledPlugin(
  plugin: OptionalPluginCatalogEntry,
  pluginState: PersistedPluginRecord
): ElizaInstalledPluginEntry {
  return {
    id: plugin.id,
    name: plugin.name,
    ...(plugin.packageName ? { packageName: plugin.packageName } : {}),
    description: plugin.description,
    enabled: pluginState.enabled,
    required: false,
    configurable: true,
    removable: true,
    source: pluginState.source,
    lifecycleStatus: pluginState.lifecycleStatus,
    executionPolicy: pluginState.executionPolicy
  }
}

function unknownEntryToInstalledPlugin(
  pluginId: ElizaPluginId,
  pluginState: PersistedPluginRecord
): ElizaInstalledPluginEntry {
  const removable =
    pluginState.source !== 'required' && pluginState.source !== 'bonzi-builtin'

  return {
    id: pluginId,
    name: pluginId,
    packageName: pluginState.packageName,
    description:
      'Additional plugin stored in Bonzi settings. Registry metadata is not available in this build.',
    enabled: pluginState.enabled,
    required: false,
    configurable: false,
    removable,
    source: pluginState.source,
    lifecycleStatus: pluginState.lifecycleStatus,
    executionPolicy: pluginState.executionPolicy,
    capabilities: pluginState.capabilities
  }
}

function catalogEntryToAvailablePlugin(
  plugin: OptionalPluginCatalogEntry
): ElizaAvailablePluginEntry {
  return {
    id: plugin.id,
    name: plugin.name,
    ...(plugin.packageName ? { packageName: plugin.packageName } : {}),
    description: plugin.description,
    source: 'bonzi-builtin',
    lifecycleStatus: 'available',
    executionPolicy: 'trusted_auto'
  }
}
