import type {
  ElizaAvailablePluginEntry,
  ElizaInstalledPluginEntry,
  ElizaPluginInventoryEntry,
  ElizaPluginLifecycleStatus,
  ElizaPluginSettings
} from '../../shared/contracts'
import { dedupeStrings } from '../../shared/value-utils'
import type { BonziPersistedPluginRecordSnapshot } from './plugin-settings'
import type { RegistryPluginEntry } from './plugin-registry-normalization'

interface PluginDiscoveryState {
  installedById: Map<string, ElizaInstalledPluginEntry>
  availableById: Map<string, ElizaAvailablePluginEntry>
  inventoryById: Map<string, ElizaPluginInventoryEntry>
}

export function buildDiscoveryState(input: {
  settings: ElizaPluginSettings
  persisted: Record<string, BonziPersistedPluginRecordSnapshot>
}): PluginDiscoveryState {
  const installedById = new Map<string, ElizaInstalledPluginEntry>()
  const availableById = new Map<string, ElizaAvailablePluginEntry>()
  const inventoryById = new Map<string, ElizaPluginInventoryEntry>()

  for (const plugin of input.settings.installedPlugins) {
    const persistedRecord = input.persisted[plugin.id]
    const lifecycleStatus =
      plugin.lifecycleStatus ??
      deriveLifecycleStatus({
        installed: true,
        enabled: plugin.enabled,
        fallback: persistedRecord?.lifecycleStatus
      })
    const executionPolicy =
      plugin.executionPolicy ?? persistedRecord?.executionPolicy ?? 'trusted_auto'
    const source =
      plugin.source ??
      (plugin.required ? 'required' : (persistedRecord?.source ?? 'bonzi-builtin'))
    const installedEntry: ElizaInstalledPluginEntry = {
      ...plugin,
      source,
      lifecycleStatus,
      executionPolicy,
      warnings: dedupeStrings([...(plugin.warnings ?? [])]),
      errors: dedupeStrings([...(plugin.errors ?? [])])
    }

    installedById.set(plugin.id, installedEntry)
    inventoryById.set(plugin.id, {
      id: plugin.id,
      installed: true,
      enabled: plugin.enabled,
      source,
      lifecycleStatus,
      executionPolicy,
      name: plugin.name,
      packageName: plugin.packageName,
      version: plugin.version,
      description: plugin.description,
      repository: plugin.repository,
      capabilities: plugin.capabilities,
      compatibility: plugin.compatibility,
      warnings: installedEntry.warnings,
      errors: installedEntry.errors
    })
  }

  for (const plugin of input.settings.availablePlugins) {
    const persistedRecord = input.persisted[plugin.id]
    const lifecycleStatus =
      plugin.lifecycleStatus ??
      deriveLifecycleStatus({
        installed: false,
        enabled: false,
        fallback: persistedRecord?.lifecycleStatus
      })
    const executionPolicy =
      plugin.executionPolicy ?? persistedRecord?.executionPolicy ?? 'trusted_auto'
    const source = plugin.source ?? persistedRecord?.source ?? 'bonzi-builtin'
    const availableEntry: ElizaAvailablePluginEntry = {
      ...plugin,
      source,
      lifecycleStatus,
      executionPolicy,
      warnings: dedupeStrings([...(plugin.warnings ?? [])]),
      errors: dedupeStrings([...(plugin.errors ?? [])])
    }

    availableById.set(plugin.id, availableEntry)
    inventoryById.set(plugin.id, {
      id: plugin.id,
      installed: false,
      enabled: false,
      source,
      lifecycleStatus,
      executionPolicy,
      name: plugin.name,
      packageName: plugin.packageName,
      version: plugin.version,
      description: plugin.description,
      repository: plugin.repository,
      capabilities: plugin.capabilities,
      compatibility: plugin.compatibility,
      warnings: availableEntry.warnings,
      errors: availableEntry.errors
    })
  }

  for (const [pluginId, record] of Object.entries(input.persisted)) {
    if (inventoryById.has(pluginId)) {
      continue
    }

    if (record.installed) {
      const entry = buildUnknownInstalledEntry(pluginId, record)
      installedById.set(pluginId, entry)
    } else {
      const entry = buildUnknownAvailableEntry(pluginId, record)
      availableById.set(pluginId, entry)
    }

    inventoryById.set(pluginId, {
      id: pluginId,
      installed: record.installed,
      enabled: record.enabled,
      source: record.source,
      lifecycleStatus: deriveLifecycleStatus({
        installed: record.installed,
        enabled: record.enabled,
        fallback: record.lifecycleStatus
      }),
      executionPolicy: record.executionPolicy,
      name: pluginId,
      packageName: record.packageName,
      version: record.versionRange,
      description:
        'Plugin metadata is persisted locally but no curated catalog entry is available.',
      capabilities: record.capabilities,
      warnings: ['Plugin metadata is local-only; registry details are unavailable.'],
      errors: []
    })
  }

  return {
    installedById,
    availableById,
    inventoryById
  }
}

export function mergeRegistryEntries(
  state: PluginDiscoveryState,
  entries: RegistryPluginEntry[]
): void {
  for (const registryEntry of entries) {
    const installed = state.installedById.get(registryEntry.id)
    const available = state.availableById.get(registryEntry.id)
    const inventory = state.inventoryById.get(registryEntry.id)

    if (installed) {
      const mergedInstalled: ElizaInstalledPluginEntry = {
        ...installed,
        name: fallbackString(installed.name, registryEntry.name),
        description: fallbackString(installed.description, registryEntry.description),
        packageName: installed.packageName ?? registryEntry.packageName,
        version: installed.version ?? registryEntry.version,
        repository: installed.repository ?? registryEntry.repository,
        compatibility: dedupeStrings([
          ...(installed.compatibility ?? []),
          ...(registryEntry.compatibility ?? [])
        ]),
        capabilities: dedupeStrings([
          ...(installed.capabilities ?? []),
          ...(registryEntry.capabilities ?? [])
        ]),
        warnings: dedupeStrings([...(installed.warnings ?? []), ...registryEntry.warnings]),
        errors: dedupeStrings([...(installed.errors ?? []), ...registryEntry.errors])
      }
      state.installedById.set(registryEntry.id, mergedInstalled)
    } else {
      const baseAvailable = available ?? {
        id: registryEntry.id,
        name: registryEntry.name,
        packageName: registryEntry.packageName,
        version: registryEntry.version,
        description: registryEntry.description,
        source: registryEntry.source,
        lifecycleStatus: registryEntry.lifecycleStatus,
        executionPolicy: registryEntry.executionPolicy,
        repository: registryEntry.repository,
        compatibility: registryEntry.compatibility,
        capabilities: registryEntry.capabilities,
        warnings: [],
        errors: []
      }

      const mergedAvailable: ElizaAvailablePluginEntry = {
        ...baseAvailable,
        name: fallbackString(baseAvailable.name, registryEntry.name),
        description: fallbackString(baseAvailable.description, registryEntry.description),
        packageName: baseAvailable.packageName ?? registryEntry.packageName,
        version: baseAvailable.version ?? registryEntry.version,
        source: baseAvailable.source ?? registryEntry.source,
        lifecycleStatus:
          registryEntry.lifecycleStatus === 'incompatible'
            ? 'incompatible'
            : (baseAvailable.lifecycleStatus ?? registryEntry.lifecycleStatus),
        executionPolicy: baseAvailable.executionPolicy ?? registryEntry.executionPolicy,
        repository: baseAvailable.repository ?? registryEntry.repository,
        compatibility: dedupeStrings([
          ...(baseAvailable.compatibility ?? []),
          ...(registryEntry.compatibility ?? [])
        ]),
        capabilities: dedupeStrings([
          ...(baseAvailable.capabilities ?? []),
          ...(registryEntry.capabilities ?? [])
        ]),
        warnings: dedupeStrings([...(baseAvailable.warnings ?? []), ...registryEntry.warnings]),
        errors: dedupeStrings([...(baseAvailable.errors ?? []), ...registryEntry.errors])
      }
      state.availableById.set(registryEntry.id, mergedAvailable)
    }

    if (inventory) {
      state.inventoryById.set(registryEntry.id, {
        ...inventory,
        packageName: inventory.packageName ?? registryEntry.packageName,
        version: inventory.version ?? registryEntry.version,
        repository: inventory.repository ?? registryEntry.repository,
        compatibility: dedupeStrings([
          ...(inventory.compatibility ?? []),
          ...(registryEntry.compatibility ?? [])
        ]),
        capabilities: dedupeStrings([
          ...(inventory.capabilities ?? []),
          ...(registryEntry.capabilities ?? [])
        ]),
        warnings: dedupeStrings([...(inventory.warnings ?? []), ...registryEntry.warnings]),
        errors: dedupeStrings([...(inventory.errors ?? []), ...registryEntry.errors])
      })
    } else {
      state.inventoryById.set(registryEntry.id, {
        id: registryEntry.id,
        installed: false,
        enabled: false,
        source: registryEntry.source,
        lifecycleStatus: registryEntry.lifecycleStatus,
        executionPolicy: registryEntry.executionPolicy,
        name: registryEntry.name,
        packageName: registryEntry.packageName,
        version: registryEntry.version,
        description: registryEntry.description,
        repository: registryEntry.repository,
        compatibility: registryEntry.compatibility,
        capabilities: registryEntry.capabilities,
        warnings: registryEntry.warnings,
        errors: registryEntry.errors
      })
    }
  }
}

export function buildDiscoveryResult(
  state: PluginDiscoveryState,
  warnings: string[]
): ElizaPluginSettings {
  return {
    installedPlugins: sortInstalledPlugins(Array.from(state.installedById.values())),
    availablePlugins: sortAvailablePlugins(Array.from(state.availableById.values())),
    inventory: sortInventory(Array.from(state.inventoryById.values())),
    warnings: dedupeStrings(warnings)
  }
}

function buildUnknownInstalledEntry(
  id: string,
  record: BonziPersistedPluginRecordSnapshot
): ElizaInstalledPluginEntry {
  return {
    id,
    name: id,
    packageName: record.packageName,
    version: record.versionRange,
    description:
      'Plugin metadata is stored in Bonzi settings. Registry metadata could not be matched.',
    enabled: record.enabled,
    required: false,
    configurable: false,
    removable: record.source !== 'required' && record.source !== 'bonzi-builtin',
    source: record.source,
    lifecycleStatus: deriveLifecycleStatus({
      installed: record.installed,
      enabled: record.enabled,
      fallback: record.lifecycleStatus
    }),
    executionPolicy: record.executionPolicy,
    capabilities: record.capabilities,
    warnings: ['Plugin is not part of Bonzi built-ins and may require manual management.'],
    errors: []
  }
}

function buildUnknownAvailableEntry(
  id: string,
  record: BonziPersistedPluginRecordSnapshot
): ElizaAvailablePluginEntry {
  return {
    id,
    name: id,
    packageName: record.packageName,
    version: record.versionRange,
    description:
      'Plugin metadata is persisted locally but not currently installed. Registry metadata is unavailable.',
    source: record.source,
    lifecycleStatus: 'available',
    executionPolicy: record.executionPolicy,
    warnings: ['Plugin is tracked locally but not in the current registry snapshot.'],
    errors: []
  }
}

function sortInstalledPlugins(
  plugins: ElizaInstalledPluginEntry[]
): ElizaInstalledPluginEntry[] {
  return plugins.sort((left, right) => {
    if (left.required !== right.required) {
      return left.required ? -1 : 1
    }

    return left.id.localeCompare(right.id)
  })
}

function sortAvailablePlugins(
  plugins: ElizaAvailablePluginEntry[]
): ElizaAvailablePluginEntry[] {
  return plugins.sort((left, right) => left.id.localeCompare(right.id))
}

function sortInventory(entries: ElizaPluginInventoryEntry[]): ElizaPluginInventoryEntry[] {
  return entries.sort((left, right) => left.id.localeCompare(right.id))
}

function deriveLifecycleStatus(options: {
  installed: boolean
  enabled: boolean
  fallback?: ElizaPluginLifecycleStatus
}): ElizaPluginLifecycleStatus {
  if (options.fallback) {
    if (options.fallback === 'removed') {
      return 'available'
    }

    if (options.fallback === 'error') {
      return 'load_failed'
    }

    if (options.fallback !== 'unknown') {
      return options.fallback
    }
  }

  if (!options.installed) {
    return 'available'
  }

  return options.enabled ? 'enabled' : 'installed'
}

function fallbackString(primary: string, fallback: string): string {
  return primary.trim().length > 0 ? primary : fallback
}
