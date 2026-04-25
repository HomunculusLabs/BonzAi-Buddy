import {
  ELIZA_OPTIONAL_PLUGIN_IDS,
  ELIZA_REQUIRED_PLUGIN_IDS,
  type ElizaOptionalPluginId,
  type ElizaPluginExecutionPolicy,
  type ElizaPluginId,
  type ElizaPluginLifecycleStatus,
  type ElizaPluginSource,
  type UpdateElizaPluginSettingsOperation,
  type UpdateElizaPluginSettingsRequest
} from '../../shared/contracts'
import { isRecord, normalizeOptionalString } from '../../shared/value-utils'
import {
  DEFAULT_PLUGIN_RUNTIME_SETTINGS,
  OPTIONAL_PLUGIN_CATALOG,
  type LoadedSettingsState,
  type NormalizedPluginInventory,
  type OptionalPluginCatalogEntry,
  type PersistedPluginRecord,
  type PersistedSettingsFileLegacy
} from './plugin-settings-model'

export function normalizeParsedSettings(parsed: unknown): LoadedSettingsState {
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

export function validateUpdateRequest(
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

export function withBuiltInDefaults(inventory: NormalizedPluginInventory): {
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

export function createDefaultPluginState(pluginId: ElizaPluginId): PersistedPluginRecord {
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

export function normalizePersistedPluginRecord(
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

export function normalizePluginId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

export function isRequiredPluginId(
  value: unknown
): value is (typeof ELIZA_REQUIRED_PLUGIN_IDS)[number] {
  return (
    typeof value === 'string' &&
    (ELIZA_REQUIRED_PLUGIN_IDS as readonly string[]).includes(value)
  )
}

export function isOptionalPluginId(value: unknown): value is ElizaOptionalPluginId {
  return (
    typeof value === 'string' &&
    (ELIZA_OPTIONAL_PLUGIN_IDS as readonly string[]).includes(value)
  )
}

export function defaultEnabledForPlugin(pluginId: ElizaPluginId): boolean {
  return getCatalogEntry(pluginId)?.defaultEnabled ?? true
}

export function canonicalizePluginLifecycleStatus(
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

export function canonicalizePluginExecutionPolicy(
  policy: ElizaPluginExecutionPolicy
): ElizaPluginExecutionPolicy {
  return policy === 'manual' ? 'confirm_each_action' : policy
}

export function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const normalized = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)

  return normalized.length > 0 ? Array.from(new Set(normalized)) : undefined
}

export function getCatalogEntry(
  id: ElizaPluginId
): OptionalPluginCatalogEntry | undefined {
  return OPTIONAL_PLUGIN_CATALOG.find((plugin) => plugin.id === id)
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

function isBooleanRecord(value: unknown): value is Record<string, boolean> {
  return (
    isRecord(value) &&
    Object.values(value).every((entry) => typeof entry === 'boolean')
  )
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
