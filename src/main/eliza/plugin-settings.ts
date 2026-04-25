import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { app } from 'electron'
import {
  ELIZA_OPTIONAL_PLUGIN_IDS,
  ELIZA_REQUIRED_PLUGIN_IDS,
  type AssistantProviderInfo,
  type ElizaAvailablePluginEntry,
  type ElizaInstalledPluginEntry,
  type ElizaOptionalPluginId,
  type ElizaPluginExecutionPolicy,
  type ElizaPluginId,
  type ElizaPluginLifecycleStatus,
  type ElizaPluginSettings,
  type ElizaPluginSource,
  type RuntimeApprovalSettings,
  type UpdateElizaPluginSettingsOperation,
  type UpdateElizaPluginSettingsRequest,
  type UpdateRuntimeApprovalSettingsRequest
} from '../../shared/contracts'

export interface BonziElizaPluginRuntimeSettings {
  contextEnabled: boolean
  desktopActionsEnabled: boolean
  approvalsEnabled: boolean
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

interface PersistedPluginRecord {
  installed: boolean
  enabled: boolean
  source: ElizaPluginSource
  lifecycleStatus: ElizaPluginLifecycleStatus
  executionPolicy: ElizaPluginExecutionPolicy
  packageName?: string
  versionRange?: string
  registryRef?: string
  exportName?: string
  capabilities?: string[]
}

export interface BonziPersistedPluginRecordSnapshot {
  installed: boolean
  enabled: boolean
  source: ElizaPluginSource
  lifecycleStatus: ElizaPluginLifecycleStatus
  executionPolicy: ElizaPluginExecutionPolicy
  packageName?: string
  versionRange?: string
  registryRef?: string
  exportName?: string
  capabilities?: string[]
}

interface PersistedSettingsFileV2 {
  schemaVersion: 2
  plugins: Record<string, PersistedPluginRecord>
  approvalsEnabled?: boolean
}

interface PersistedSettingsFileLegacy {
  plugins?: Record<string, boolean>
  catalog?: {
    installed?: Record<string, boolean>
  }
}

type NormalizedPluginInventory = Record<string, PersistedPluginRecord>

interface LoadedSettingsState {
  inventory: NormalizedPluginInventory
  approvalsEnabled: boolean
  needsRewrite: boolean
  fileExisted: boolean
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
  desktopActionsEnabled: true,
  approvalsEnabled: true
}

const PROVIDER_PACKAGE_NAMES: Record<AssistantProviderInfo['kind'], string> = {
  'eliza-classic': '@elizaos/plugin-eliza-classic',
  'openai-compatible': '@elizaos/plugin-openai'
}

export class BonziPluginSettingsStore {
  private readonly settingsPath: string

  constructor(settingsPath = join(app.getPath('userData'), SETTINGS_FILE_NAME)) {
    this.settingsPath = settingsPath
  }

  getRuntimeSettings(): BonziElizaPluginRuntimeSettings {
    const loaded = this.readPersistedPluginInventory()
    const state = loaded.inventory

    return {
      contextEnabled:
        state['bonzi-context']?.enabled ??
        DEFAULT_PLUGIN_RUNTIME_SETTINGS.contextEnabled,
      desktopActionsEnabled:
        state['bonzi-desktop-actions']?.enabled ??
        DEFAULT_PLUGIN_RUNTIME_SETTINGS.desktopActionsEnabled,
      approvalsEnabled: loaded.approvalsEnabled
    }
  }

  getRuntimeApprovalSettings(): RuntimeApprovalSettings {
    return {
      approvalsEnabled: this.readPersistedPluginInventory().approvalsEnabled
    }
  }

  updateRuntimeApprovalSettings(
    request: UpdateRuntimeApprovalSettingsRequest
  ): RuntimeApprovalSettings {
    if (!isRecord(request) || typeof request.approvalsEnabled !== 'boolean') {
      throw new Error('Approval settings update must include an approvalsEnabled boolean.')
    }

    if (request.approvalsEnabled === false && request.confirmedDisable !== true) {
      throw new Error('Disabling approvals requires explicit confirmation.')
    }

    const loaded = this.readPersistedPluginInventory()
    this.writePersistedSettings({
      schemaVersion: 2,
      plugins: loaded.inventory,
      approvalsEnabled: request.approvalsEnabled
    })

    return {
      approvalsEnabled: request.approvalsEnabled
    }
  }

  getSettings(provider: AssistantProviderInfo): ElizaPluginSettings {
    const state = this.getNormalizedPluginInventory()
    const optionalInstalledPlugins = OPTIONAL_PLUGIN_CATALOG.flatMap((plugin) => {
      const pluginState = state[plugin.id] ?? createDefaultPluginState(plugin.id)

      if (!pluginState.installed) {
        return []
      }

      return [this.catalogEntryToInstalledPlugin(plugin, pluginState)]
    })
    const availablePlugins = OPTIONAL_PLUGIN_CATALOG.flatMap((plugin) => {
      const pluginState = state[plugin.id] ?? createDefaultPluginState(plugin.id)

      if (pluginState.installed) {
        return []
      }

      return [this.catalogEntryToAvailablePlugin(plugin)]
    })
    const unknownInstalledPlugins = Object.entries(state)
      .filter(([pluginId, pluginState]) => {
        return (
          !isOptionalPluginId(pluginId) &&
          !isRequiredPluginId(pluginId) &&
          pluginState.installed
        )
      })
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([pluginId, pluginState]) => {
        return this.unknownEntryToInstalledPlugin(pluginId, pluginState)
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

  /**
   * Returns the normalized persisted plugin inventory that Bonzi can safely expose
   * to read-only discovery/services. The returned object is detached from in-memory state.
   */
  getPersistedPluginInventorySnapshot(): Record<string, BonziPersistedPluginRecordSnapshot> {
    return { ...this.getNormalizedPluginInventory() }
  }

  findPluginIdByPackageName(packageName: string): string | null {
    const normalizedPackageName = normalizeOptionalString(packageName)

    if (!normalizedPackageName) {
      return null
    }

    const inventory = this.getNormalizedPluginInventory()

    for (const [pluginId, record] of Object.entries(inventory)) {
      if (record.packageName === normalizedPackageName) {
        return pluginId
      }
    }

    return null
  }

  upsertInstalledPluginRecord(input: {
    pluginId: ElizaPluginId
    packageName?: string
    versionRange?: string
    registryRef?: string
    exportName?: string
    capabilities?: string[]
    source: Extract<ElizaPluginSource, 'registry' | 'installed-package'>
    executionPolicy?: ElizaPluginExecutionPolicy
    lifecycleStatus?: ElizaPluginLifecycleStatus
    enabled?: boolean
  }): void {
    const pluginId = normalizePluginId(input.pluginId)

    if (!pluginId || isRequiredPluginId(pluginId)) {
      throw new Error(`Unsupported plugin id for install record: ${String(input.pluginId)}`)
    }

    const loaded = this.readPersistedPluginInventory()
    const state: NormalizedPluginInventory = { ...loaded.inventory }
    const enabled = input.enabled === true
    const current = state[pluginId]

    state[pluginId] = {
      ...(current ?? createDefaultPluginState(pluginId)),
      installed: true,
      enabled,
      source: input.source,
      lifecycleStatus: input.lifecycleStatus ?? (enabled ? 'enabled' : 'installed'),
      executionPolicy: canonicalizePluginExecutionPolicy(
        input.executionPolicy ?? 'confirm_each_action'
      ),
      packageName: normalizeOptionalString(input.packageName),
      versionRange: normalizeOptionalString(input.versionRange),
      registryRef: normalizeOptionalString(input.registryRef),
      exportName: normalizeOptionalString(input.exportName),
      capabilities: normalizeStringArray(input.capabilities)
    }

    this.writePersistedSettings({
      schemaVersion: 2,
      plugins: state,
      approvalsEnabled: loaded.approvalsEnabled
    })
  }

  removePluginRecord(pluginId: ElizaPluginId): void {
    const normalizedPluginId = normalizePluginId(pluginId)

    if (!normalizedPluginId || isRequiredPluginId(normalizedPluginId)) {
      throw new Error(`Unsupported plugin id for uninstall record: ${String(pluginId)}`)
    }

    const loaded = this.readPersistedPluginInventory()
    const state: NormalizedPluginInventory = { ...loaded.inventory }

    delete state[normalizedPluginId]

    this.writePersistedSettings({
      schemaVersion: 2,
      plugins: state,
      approvalsEnabled: loaded.approvalsEnabled
    })
  }

  updateRuntimePluginRecord(input: {
    pluginId: ElizaPluginId
    lifecycleStatus?: ElizaPluginLifecycleStatus
    enabled?: boolean
    exportName?: string
    capabilities?: string[]
  }): void {
    const pluginId = normalizePluginId(input.pluginId)

    if (!pluginId || isRequiredPluginId(pluginId)) {
      return
    }

    const loaded = this.readPersistedPluginInventory()
    const state: NormalizedPluginInventory = { ...loaded.inventory }
    const current = state[pluginId]

    if (!current || !current.installed) {
      return
    }

    const nextEnabled =
      typeof input.enabled === 'boolean' ? input.enabled : current.enabled
    const nextLifecycleStatus = canonicalizePluginLifecycleStatus(
      input.lifecycleStatus ?? current.lifecycleStatus,
      { installed: current.installed, enabled: nextEnabled }
    )

    state[pluginId] = {
      ...current,
      enabled: nextEnabled,
      lifecycleStatus: nextLifecycleStatus,
      exportName:
        input.exportName === undefined
          ? current.exportName
          : normalizeOptionalString(input.exportName),
      capabilities:
        input.capabilities === undefined
          ? current.capabilities
          : normalizeStringArray(input.capabilities)
    }

    this.writePersistedSettings({
      schemaVersion: 2,
      plugins: state,
      approvalsEnabled: loaded.approvalsEnabled
    })
  }

  updateSettings(
    request: UpdateElizaPluginSettingsRequest,
    provider: AssistantProviderInfo
  ): ElizaPluginSettings {
    const operations = validateUpdateRequest(request)
    const loaded = this.readPersistedPluginInventory()
    const state: NormalizedPluginInventory = { ...loaded.inventory }

    for (const operation of operations) {
      const pluginId = normalizePluginId(operation.id)

      if (!pluginId) {
        throw new Error(`Unsupported curated plugin id: ${String(operation.id)}`)
      }

      const current = state[pluginId]

      switch (operation.type) {
        case 'add': {
          if (current && current.installed) {
            break
          }

          const enabled = defaultEnabledForPlugin(pluginId)
          state[pluginId] = {
            ...(current ?? createDefaultPluginState(pluginId)),
            installed: true,
            enabled,
            lifecycleStatus: enabled ? 'enabled' : 'installed',
            packageName: current?.packageName,
            versionRange: current?.versionRange,
            registryRef: current?.registryRef
          }
          break
        }
        case 'remove': {
          state[pluginId] = {
            ...(current ?? createDefaultPluginState(pluginId)),
            installed: false,
            enabled: false,
            lifecycleStatus: 'available',
            packageName: current?.packageName,
            versionRange: current?.versionRange,
            registryRef: current?.registryRef
          }
          break
        }
        case 'set-enabled': {
          if (!current?.installed) {
            throw new Error(
              `Cannot enable or disable plugin "${pluginId}" because it is not installed.`
            )
          }

          state[pluginId] = {
            ...current,
            enabled: operation.enabled,
            lifecycleStatus: operation.enabled ? 'enabled' : 'disabled'
          }
          break
        }
      }
    }

    this.writePersistedSettings({
      schemaVersion: 2,
      plugins: state,
      approvalsEnabled: loaded.approvalsEnabled
    })

    return this.getSettings(provider)
  }

  private getNormalizedPluginInventory(): NormalizedPluginInventory {
    const loaded = this.readPersistedPluginInventory()
    return loaded.inventory
  }

  private catalogEntryToInstalledPlugin(
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

  private unknownEntryToInstalledPlugin(
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

  private catalogEntryToAvailablePlugin(
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

  private readPersistedPluginInventory(): LoadedSettingsState {
    if (!existsSync(this.settingsPath)) {
      return {
        inventory: withBuiltInDefaults({}).inventory,
        approvalsEnabled: DEFAULT_PLUGIN_RUNTIME_SETTINGS.approvalsEnabled,
        needsRewrite: false,
        fileExisted: false
      }
    }

    try {
      const parsed = JSON.parse(readFileSync(this.settingsPath, 'utf8'))
      const loaded = this.normalizeParsedSettings(parsed)
      const withDefaults = withBuiltInDefaults(loaded.inventory)
      const needsRewrite = loaded.needsRewrite || withDefaults.injectedBuiltIns

      if (needsRewrite && loaded.fileExisted) {
        this.writePersistedSettings({
          schemaVersion: 2,
          plugins: withDefaults.inventory,
          approvalsEnabled: loaded.approvalsEnabled
        })
      }

      return {
        inventory: withDefaults.inventory,
        approvalsEnabled: loaded.approvalsEnabled,
        needsRewrite,
        fileExisted: loaded.fileExisted
      }
    } catch {
      const withDefaults = withBuiltInDefaults({})

      this.writePersistedSettings({
        schemaVersion: 2,
        plugins: withDefaults.inventory,
        approvalsEnabled: DEFAULT_PLUGIN_RUNTIME_SETTINGS.approvalsEnabled
      })

      return {
        inventory: withDefaults.inventory,
        approvalsEnabled: DEFAULT_PLUGIN_RUNTIME_SETTINGS.approvalsEnabled,
        needsRewrite: true,
        fileExisted: true
      }
    }
  }

  private normalizeParsedSettings(parsed: unknown): LoadedSettingsState {
    if (!isRecord(parsed)) {
      return {
        inventory: {},
        approvalsEnabled: DEFAULT_PLUGIN_RUNTIME_SETTINGS.approvalsEnabled,
        needsRewrite: true,
        fileExisted: true
      }
    }

    if (parsed.schemaVersion === 2) {
      const plugins = parsed.plugins

      if (!isRecord(plugins)) {
        return {
          inventory: {},
          approvalsEnabled: DEFAULT_PLUGIN_RUNTIME_SETTINGS.approvalsEnabled,
          needsRewrite: true,
          fileExisted: true
        }
      }

      const inventory: NormalizedPluginInventory = {}
      let needsRewrite = false
      const approvalsEnabled =
        typeof parsed.approvalsEnabled === 'boolean'
          ? parsed.approvalsEnabled
          : DEFAULT_PLUGIN_RUNTIME_SETTINGS.approvalsEnabled

      if (typeof parsed.approvalsEnabled !== 'boolean') {
        needsRewrite = true
      }

      for (const [rawId, record] of Object.entries(plugins)) {
        const pluginId = normalizePluginId(rawId)

        if (!pluginId || isRequiredPluginId(pluginId)) {
          needsRewrite = true
          continue
        }

        const normalized = normalizePersistedPluginRecord(pluginId, record)

        if (!normalized) {
          needsRewrite = true
          continue
        }

        inventory[pluginId] = normalized

        if (
          !isPersistedPluginRecord(record) ||
          requiresPersistedPluginRecordRewrite(record, normalized)
        ) {
          needsRewrite = true
        }
      }

      return {
        inventory,
        approvalsEnabled,
        needsRewrite,
        fileExisted: true
      }
    }

    if (isLegacyPersistedSettingsFile(parsed)) {
      return {
        inventory: migrateLegacyInventory(parsed),
        approvalsEnabled: DEFAULT_PLUGIN_RUNTIME_SETTINGS.approvalsEnabled,
        needsRewrite: true,
        fileExisted: true
      }
    }

    return {
      inventory: {},
      approvalsEnabled: DEFAULT_PLUGIN_RUNTIME_SETTINGS.approvalsEnabled,
      needsRewrite: true,
      fileExisted: true
    }
  }

  private writePersistedSettings(settings: PersistedSettingsFileV2): void {
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

    const pluginId = normalizePluginId(operation.id)

    if (!pluginId) {
      throw new Error(`Unsupported curated plugin id: ${String(operation.id)}`)
    }

    if (isRequiredPluginId(pluginId)) {
      throw new Error(`Cannot mutate required Bonzi-managed plugin id: ${pluginId}`)
    }

    if (operation.type === 'set-enabled') {
      if (typeof operation.enabled !== 'boolean') {
        throw new Error('set-enabled plugin settings operation requires a boolean enabled value.')
      }

      return {
        type: operation.type,
        id: pluginId,
        enabled: operation.enabled
      }
    }

    return {
      type: operation.type,
      id: pluginId
    }
  })
}

function migrateLegacyInventory(
  persisted: PersistedSettingsFileLegacy
): NormalizedPluginInventory {
  const pluginEnabled = isBooleanRecord(persisted.plugins) ? persisted.plugins : {}
  const pluginInstalled = isBooleanRecord(persisted.catalog?.installed)
    ? persisted.catalog.installed
    : {}

  const keys = new Set<string>([
    ...Object.keys(pluginEnabled),
    ...Object.keys(pluginInstalled),
    ...ELIZA_OPTIONAL_PLUGIN_IDS
  ])
  const inventory: NormalizedPluginInventory = {}

  for (const key of keys) {
    const pluginId = normalizePluginId(key)

    if (!pluginId || isRequiredPluginId(pluginId)) {
      continue
    }

    const catalogEntry = getCatalogEntry(pluginId)
    const installedValue = pluginInstalled[pluginId]
    const enabledValue = pluginEnabled[pluginId]
    const installed =
      typeof installedValue === 'boolean'
        ? installedValue
        : (catalogEntry?.defaultInstalled ?? true)
    const enabled =
      installed && typeof enabledValue === 'boolean'
        ? enabledValue
        : installed
          ? (catalogEntry?.defaultEnabled ?? true)
          : false

    inventory[pluginId] = {
      installed,
      enabled,
      source: catalogEntry ? 'bonzi-builtin' : 'unknown',
      lifecycleStatus: installed ? (enabled ? 'enabled' : 'installed') : 'available',
      executionPolicy: 'trusted_auto'
    }
  }

  return inventory
}

function normalizePersistedPluginRecord(
  pluginId: ElizaPluginId,
  value: unknown
): PersistedPluginRecord | null {
  if (!isRecord(value)) {
    return null
  }

  const catalogEntry = getCatalogEntry(pluginId)
  const rawInstalled = value.installed
  const rawEnabled = value.enabled
  const installed =
    typeof rawInstalled === 'boolean'
      ? rawInstalled
      : typeof rawEnabled === 'boolean'
        ? true
        : catalogEntry
          ? catalogEntry.defaultInstalled
          : null

  if (installed === null) {
    return null
  }

  const enabled =
    installed && typeof rawEnabled === 'boolean'
      ? rawEnabled
      : installed
        ? (catalogEntry?.defaultEnabled ?? true)
        : false

  const source = canonicalizePluginSource(
    isPluginSource(value.source)
      ? value.source
      : catalogEntry
        ? 'bonzi-builtin'
        : 'unknown'
  )
  const lifecycleStatus = canonicalizePluginLifecycleStatus(
    isPluginLifecycleStatus(value.lifecycleStatus) ? value.lifecycleStatus : undefined,
    { installed, enabled }
  )
  const executionPolicy = canonicalizePluginExecutionPolicy(
    isPluginExecutionPolicy(value.executionPolicy)
      ? value.executionPolicy
      : 'trusted_auto'
  )

  return {
    installed,
    enabled,
    source,
    lifecycleStatus,
    executionPolicy,
    packageName: normalizeOptionalString(value.packageName),
    versionRange: normalizeOptionalString(value.versionRange),
    registryRef: normalizeOptionalString(value.registryRef),
    exportName: normalizeOptionalString(value.exportName),
    capabilities: normalizeStringArray(value.capabilities)
  }
}

function createDefaultPluginState(pluginId: ElizaPluginId): PersistedPluginRecord {
  const catalogEntry = getCatalogEntry(pluginId)
  const installed = catalogEntry?.defaultInstalled ?? true

  const enabled = installed ? defaultEnabledForPlugin(pluginId) : false

  return {
    installed,
    enabled,
    source: catalogEntry ? 'bonzi-builtin' : 'unknown',
    lifecycleStatus: installed ? (enabled ? 'enabled' : 'installed') : 'available',
    executionPolicy: 'trusted_auto',
    packageName: undefined,
    versionRange: undefined,
    registryRef: undefined,
    exportName: undefined,
    capabilities: undefined
  }
}

function defaultEnabledForPlugin(pluginId: ElizaPluginId): boolean {
  return getCatalogEntry(pluginId)?.defaultEnabled ?? true
}

function withBuiltInDefaults(inventory: NormalizedPluginInventory): {
  inventory: NormalizedPluginInventory
  injectedBuiltIns: boolean
} {
  const nextInventory: NormalizedPluginInventory = { ...inventory }
  let injectedBuiltIns = false

  for (const plugin of OPTIONAL_PLUGIN_CATALOG) {
    if (nextInventory[plugin.id]) {
      continue
    }

    nextInventory[plugin.id] = {
      installed: plugin.defaultInstalled,
      enabled: plugin.defaultInstalled ? plugin.defaultEnabled : false,
      source: 'bonzi-builtin',
      lifecycleStatus: plugin.defaultInstalled
        ? (plugin.defaultEnabled ? 'enabled' : 'installed')
        : 'available',
      executionPolicy: 'trusted_auto'
    }
    injectedBuiltIns = true
  }

  return {
    inventory: nextInventory,
    injectedBuiltIns
  }
}

function getCatalogEntry(
  id: ElizaPluginId
): OptionalPluginCatalogEntry | undefined {
  return OPTIONAL_PLUGIN_CATALOG.find((plugin) => plugin.id === id)
}

function isOptionalPluginId(value: unknown): value is ElizaOptionalPluginId {
  return (
    typeof value === 'string' &&
    (ELIZA_OPTIONAL_PLUGIN_IDS as readonly string[]).includes(value)
  )
}

function isRequiredPluginId(value: unknown): value is (typeof ELIZA_REQUIRED_PLUGIN_IDS)[number] {
  return (
    typeof value === 'string' &&
    (ELIZA_REQUIRED_PLUGIN_IDS as readonly string[]).includes(value)
  )
}

function normalizePluginId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function isLegacyPersistedSettingsFile(
  value: unknown
): value is PersistedSettingsFileLegacy {
  if (!isRecord(value)) {
    return false
  }

  const pluginsValid =
    value.plugins === undefined || isBooleanRecord(value.plugins)

  if (!pluginsValid) {
    return false
  }

  const catalog = value.catalog

  if (catalog === undefined) {
    return true
  }

  if (!isRecord(catalog)) {
    return false
  }

  return catalog.installed === undefined || isBooleanRecord(catalog.installed)
}

function isPersistedPluginRecord(value: unknown): value is PersistedPluginRecord {
  return (
    isRecord(value) &&
    typeof value.installed === 'boolean' &&
    typeof value.enabled === 'boolean' &&
    isPluginSource(value.source) &&
    isPluginLifecycleStatus(value.lifecycleStatus) &&
    isPluginExecutionPolicy(value.executionPolicy) &&
    (value.packageName === undefined || typeof value.packageName === 'string') &&
    (value.versionRange === undefined || typeof value.versionRange === 'string') &&
    (value.registryRef === undefined || typeof value.registryRef === 'string') &&
    (value.exportName === undefined || typeof value.exportName === 'string') &&
    (value.capabilities === undefined ||
      (Array.isArray(value.capabilities) &&
        value.capabilities.every((entry) => typeof entry === 'string')))
  )
}

function requiresPersistedPluginRecordRewrite(
  value: unknown,
  normalized: PersistedPluginRecord
): boolean {
  if (!isRecord(value)) {
    return true
  }

  return (
    value.installed !== normalized.installed ||
    value.enabled !== normalized.enabled ||
    value.source !== normalized.source ||
    value.lifecycleStatus !== normalized.lifecycleStatus ||
    value.executionPolicy !== normalized.executionPolicy ||
    normalizeOptionalString(value.packageName) !== normalized.packageName ||
    normalizeOptionalString(value.versionRange) !== normalized.versionRange ||
    normalizeOptionalString(value.registryRef) !== normalized.registryRef ||
    normalizeOptionalString(value.exportName) !== normalized.exportName ||
    !stringArraysEqual(
      normalizeStringArray(value.capabilities),
      normalized.capabilities
    )
  )
}

function isPluginSource(value: unknown): value is ElizaPluginSource {
  return (
    value === 'required' ||
    value === 'bonzi-builtin' ||
    value === 'registry' ||
    value === 'local-workspace' ||
    value === 'installed-package' ||
    value === 'unknown' ||
    value === 'user-configured' ||
    value === 'external'
  )
}

function isPluginLifecycleStatus(value: unknown): value is ElizaPluginLifecycleStatus {
  return (
    value === 'available' ||
    value === 'installing' ||
    value === 'installed' ||
    value === 'enabled' ||
    value === 'disabled' ||
    value === 'install_failed' ||
    value === 'load_failed' ||
    value === 'incompatible' ||
    value === 'uninstalling' ||
    value === 'removed' ||
    value === 'error' ||
    value === 'unknown'
  )
}

function isPluginExecutionPolicy(value: unknown): value is ElizaPluginExecutionPolicy {
  return (
    value === 'trusted_auto' ||
    value === 'confirm_each_action' ||
    value === 'disabled' ||
    value === 'manual'
  )
}

function canonicalizePluginSource(source: ElizaPluginSource): ElizaPluginSource {
  switch (source) {
    case 'user-configured':
      return 'local-workspace'
    case 'external':
      return 'installed-package'
    default:
      return source
  }
}

function canonicalizePluginLifecycleStatus(
  status: ElizaPluginLifecycleStatus | undefined,
  state: { installed: boolean; enabled: boolean }
): ElizaPluginLifecycleStatus {
  if (!status || status === 'unknown') {
    return state.installed
      ? state.enabled
        ? 'enabled'
        : 'installed'
      : 'available'
  }

  if (status === 'removed') {
    return 'available'
  }

  if (status === 'error') {
    return 'load_failed'
  }

  return status
}

function canonicalizePluginExecutionPolicy(
  policy: ElizaPluginExecutionPolicy
): ElizaPluginExecutionPolicy {
  return policy === 'manual' ? 'confirm_each_action' : policy
}

function isBooleanRecord(value: unknown): value is Record<string, boolean> {
  return (
    isRecord(value) &&
    Object.values(value).every((entry) => typeof entry === 'boolean')
  )
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const normalized = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)

  return normalized.length > 0 ? Array.from(new Set(normalized)) : undefined
}

function stringArraysEqual(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined
): boolean {
  const normalizedLeft = left ? Array.from(new Set(left)) : []
  const normalizedRight = right ? Array.from(new Set(right)) : []

  if (normalizedLeft.length !== normalizedRight.length) {
    return false
  }

  return normalizedLeft.every((entry, index) => entry === normalizedRight[index])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
