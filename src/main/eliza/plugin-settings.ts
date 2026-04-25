import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { app } from 'electron'
import {
  ELIZA_OPTIONAL_PLUGIN_IDS,
  type AssistantProviderInfo,
  type ElizaAvailablePluginEntry,
  type ElizaInstalledPluginEntry,
  type ElizaOptionalPluginId,
  type ElizaPluginSettings,
  type UpdateElizaPluginSettingsOperation,
  type UpdateElizaPluginSettingsRequest
} from '../../shared/contracts'

export interface BonziElizaPluginRuntimeSettings {
  contextEnabled: boolean
  desktopActionsEnabled: boolean
}

const SETTINGS_FILE_NAME = 'bonzi-settings.json'

interface OptionalPluginCatalogEntry {
  id: ElizaOptionalPluginId
  name: string
  packageName?: string
  description: string
  defaultInstalled: boolean
  defaultEnabled: boolean
}

interface NormalizedOptionalPluginState {
  installed: boolean
  enabled: boolean
}

const OPTIONAL_PLUGIN_CATALOG = [
  {
    id: 'bonzi-context',
    name: 'Bonzi shell context',
    description:
      'Lets elizaOS read Bonzi window, provider, platform, and runtime context.',
    defaultInstalled: true,
    defaultEnabled: true
  },
  {
    id: 'bonzi-desktop-actions',
    name: 'Bonzi desktop actions',
    description:
      'Lets elizaOS propose Bonzi action cards such as web search, Discord inspection, and window controls.',
    defaultInstalled: true,
    defaultEnabled: true
  }
] as const satisfies readonly OptionalPluginCatalogEntry[]

const DEFAULT_PLUGIN_RUNTIME_SETTINGS: BonziElizaPluginRuntimeSettings = {
  contextEnabled: true,
  desktopActionsEnabled: true
}

const PROVIDER_PACKAGE_NAMES: Record<AssistantProviderInfo['kind'], string> = {
  'eliza-classic': '@elizaos/plugin-eliza-classic',
  'openai-compatible': '@elizaos/plugin-openai'
}

interface PersistedSettingsFile {
  plugins?: Partial<Record<ElizaOptionalPluginId, boolean>>
  catalog?: {
    installed?: Partial<Record<ElizaOptionalPluginId, boolean>>
  }
}

export class BonziPluginSettingsStore {
  private readonly settingsPath: string

  constructor(settingsPath = join(app.getPath('userData'), SETTINGS_FILE_NAME)) {
    this.settingsPath = settingsPath
  }

  getRuntimeSettings(): BonziElizaPluginRuntimeSettings {
    const state = this.getNormalizedOptionalPluginState()

    return {
      contextEnabled:
        state['bonzi-context']?.enabled ??
        DEFAULT_PLUGIN_RUNTIME_SETTINGS.contextEnabled,
      desktopActionsEnabled:
        state['bonzi-desktop-actions']?.enabled ??
        DEFAULT_PLUGIN_RUNTIME_SETTINGS.desktopActionsEnabled
    }
  }

  getSettings(provider: AssistantProviderInfo): ElizaPluginSettings {
    const state = this.getNormalizedOptionalPluginState()
    const optionalInstalledPlugins = OPTIONAL_PLUGIN_CATALOG.flatMap((plugin) => {
      const pluginState = state[plugin.id]

      if (!pluginState.installed) {
        return []
      }

      return [this.catalogEntryToInstalledPlugin(plugin, pluginState.enabled)]
    })
    const availablePlugins = OPTIONAL_PLUGIN_CATALOG.flatMap((plugin) => {
      const pluginState = state[plugin.id]

      if (pluginState.installed) {
        return []
      }

      return [this.catalogEntryToAvailablePlugin(plugin)]
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
          removable: false
        },
        ...optionalInstalledPlugins,
        {
          id: 'provider',
          name: provider.label,
          packageName: PROVIDER_PACKAGE_NAMES[provider.kind],
          description:
            'The active model provider plugin selected from Bonzi assistant configuration.',
          enabled: true,
          required: true,
          configurable: false,
          removable: false
        }
      ],
      availablePlugins
    }
  }

  updateSettings(
    request: UpdateElizaPluginSettingsRequest,
    provider: AssistantProviderInfo
  ): ElizaPluginSettings {
    const operations = validateUpdateRequest(request)
    const persisted = this.readPersistedSettings()
    const state = this.getNormalizedOptionalPluginState(persisted)

    for (const operation of operations) {
      const current = state[operation.id]
      const catalogEntry = getCatalogEntry(operation.id)

      switch (operation.type) {
        case 'add':
          if (!current.installed) {
            current.installed = true
            current.enabled = catalogEntry.defaultEnabled
          }
          break
        case 'remove':
          current.installed = false
          current.enabled = false
          break
        case 'set-enabled':
          if (!current.installed) {
            throw new Error(
              `Cannot enable or disable plugin "${operation.id}" because it is not installed.`
            )
          }
          current.enabled = operation.enabled
          break
      }
    }

    this.writePersistedSettings({
      ...persisted,
      plugins: Object.fromEntries(
        OPTIONAL_PLUGIN_CATALOG.map((plugin) => [plugin.id, state[plugin.id].enabled])
      ),
      catalog: {
        ...(persisted.catalog ?? {}),
        installed: Object.fromEntries(
          OPTIONAL_PLUGIN_CATALOG.map((plugin) => [
            plugin.id,
            state[plugin.id].installed
          ])
        )
      }
    })

    return this.getSettings(provider)
  }

  private getNormalizedOptionalPluginState(
    persisted = this.readPersistedSettings()
  ): Record<ElizaOptionalPluginId, NormalizedOptionalPluginState> {
    return Object.fromEntries(
      OPTIONAL_PLUGIN_CATALOG.map((plugin) => {
        const persistedEnabled = persisted.plugins?.[plugin.id]
        const persistedInstalled = persisted.catalog?.installed?.[plugin.id]
        const installed =
          typeof persistedInstalled === 'boolean'
            ? persistedInstalled
            : plugin.defaultInstalled
        const enabled = installed
          ? typeof persistedEnabled === 'boolean'
            ? persistedEnabled
            : plugin.defaultEnabled
          : false

        return [plugin.id, { installed, enabled }]
      })
    ) as Record<ElizaOptionalPluginId, NormalizedOptionalPluginState>
  }

  private catalogEntryToInstalledPlugin(
    plugin: OptionalPluginCatalogEntry,
    enabled: boolean
  ): ElizaInstalledPluginEntry {
    return {
      id: plugin.id,
      name: plugin.name,
      ...(plugin.packageName ? { packageName: plugin.packageName } : {}),
      description: plugin.description,
      enabled,
      required: false,
      configurable: true,
      removable: true
    }
  }

  private catalogEntryToAvailablePlugin(
    plugin: OptionalPluginCatalogEntry
  ): ElizaAvailablePluginEntry {
    return {
      id: plugin.id,
      name: plugin.name,
      ...(plugin.packageName ? { packageName: plugin.packageName } : {}),
      description: plugin.description
    }
  }

  private readPersistedSettings(): PersistedSettingsFile {
    if (!existsSync(this.settingsPath)) {
      return {}
    }

    try {
      const parsed = JSON.parse(readFileSync(this.settingsPath, 'utf8'))
      return isPersistedSettingsFile(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }

  private writePersistedSettings(settings: PersistedSettingsFile): void {
    mkdirSync(dirname(this.settingsPath), { recursive: true })
    writeFileSync(this.settingsPath, JSON.stringify(settings, null, 2))
  }
}

function validateUpdateRequest(
  request: UpdateElizaPluginSettingsRequest
): UpdateElizaPluginSettingsOperation[] {
  if (!isRecord(request) || !Array.isArray(request.operations)) {
    throw new Error('Plugin settings update must include an operations array.')
  }

  const operations: unknown[] = request.operations

  if (operations.length === 0) {
    throw new Error('Plugin settings update must include at least one operation.')
  }

  return operations.map((operation) => {
    if (!isRecord(operation)) {
      throw new Error('Plugin settings operation must be an object.')
    }

    if (
      operation.type !== 'add' &&
      operation.type !== 'remove' &&
      operation.type !== 'set-enabled'
    ) {
      throw new Error(`Unsupported plugin settings operation: ${String(operation.type)}`)
    }

    if (!isOptionalPluginId(operation.id)) {
      throw new Error(`Unsupported curated plugin id: ${String(operation.id)}`)
    }

    if (operation.type === 'set-enabled') {
      if (typeof operation.enabled !== 'boolean') {
        throw new Error('set-enabled plugin settings operation requires a boolean enabled value.')
      }

      return {
        type: operation.type,
        id: operation.id,
        enabled: operation.enabled
      }
    }

    return {
      type: operation.type,
      id: operation.id
    }
  })
}

function getCatalogEntry(id: ElizaOptionalPluginId): OptionalPluginCatalogEntry {
  const entry = OPTIONAL_PLUGIN_CATALOG.find((plugin) => plugin.id === id)

  if (!entry) {
    throw new Error(`Unsupported curated plugin id: ${id}`)
  }

  return entry
}

function isOptionalPluginId(value: unknown): value is ElizaOptionalPluginId {
  return (
    typeof value === 'string' &&
    (ELIZA_OPTIONAL_PLUGIN_IDS as readonly string[]).includes(value)
  )
}

function isPersistedSettingsFile(value: unknown): value is PersistedSettingsFile {
  if (!isRecord(value)) {
    return false
  }

  const plugins = value.plugins

  if (plugins !== undefined && !isBooleanRecord(plugins)) {
    return false
  }

  const catalog = value.catalog

  if (catalog === undefined) {
    return true
  }

  if (!isRecord(catalog)) {
    return false
  }

  const installed = catalog.installed

  return installed === undefined || isBooleanRecord(installed)
}

function isBooleanRecord(value: unknown): value is Record<string, boolean> {
  return (
    isRecord(value) &&
    Object.values(value).every((entry) => typeof entry === 'boolean')
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
