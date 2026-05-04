import {
  ELIZA_OPTIONAL_PLUGIN_IDS,
  ELIZA_REQUIRED_PLUGIN_IDS,
  type AssistantProviderKind,
  type PersistedAssistantProviderSettings,
  type RuntimeRoutingRule,
  type RuntimeRoutingRuleMatch,
  type RuntimeRoutingRuleTarget,
  type RuntimeRoutingSettings,
  type RuntimeRoutingTargetActionType,
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
  DEFAULT_RUNTIME_ROUTING_SETTINGS,
  OPTIONAL_PLUGIN_CATALOG,
  type LoadedSettingsState,
  type NormalizedPluginInventory,
  type OptionalPluginCatalogEntry,
  type PersistedPluginRecord,
  type PersistedSettingsFileLegacy
} from './plugin-settings-model'
import {
  getDefaultCharacterSettings,
  normalizePersistedCharacterSettings
} from './character-settings-validation'

export function normalizeParsedSettings(parsed: unknown): LoadedSettingsState {
  if (!isRecord(parsed)) {
    return {
      inventory: {},
      approvalsEnabled: DEFAULT_PLUGIN_RUNTIME_SETTINGS.approvalsEnabled,
      continuation: DEFAULT_PLUGIN_RUNTIME_SETTINGS.continuation,
      characterSettings: getDefaultCharacterSettings(),
      providerSettings: {},
      routingSettings: { ...DEFAULT_RUNTIME_ROUTING_SETTINGS },
      routingWarnings: [],
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
        continuation: DEFAULT_PLUGIN_RUNTIME_SETTINGS.continuation,
        characterSettings: getDefaultCharacterSettings(),
        providerSettings: {},
        routingSettings: { ...DEFAULT_RUNTIME_ROUTING_SETTINGS },
        routingWarnings: [],
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

    const continuation = normalizeRuntimeContinuationSettings(parsed.continuation)

    if (continuation.needsRewrite) {
      needsRewrite = true
    }

    const normalizedCharacter = normalizePersistedCharacterSettings(parsed.character)
    if (normalizedCharacter.needsRewrite) {
      needsRewrite = true
    }

    const normalizedProvider = normalizePersistedProviderSettings(parsed.provider)
    if (normalizedProvider.needsRewrite) {
      needsRewrite = true
    }

    const normalizedRouting = normalizeRuntimeRoutingSettings(parsed.routing)
    if (normalizedRouting.needsRewrite) {
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
      continuation: continuation.settings,
      characterSettings: normalizedCharacter.settings,
      providerSettings: normalizedProvider.settings,
      routingSettings: normalizedRouting.settings,
      routingWarnings: normalizedRouting.warnings,
      needsRewrite,
      fileExisted: true
    }
  }

  if (isLegacyPersistedSettingsFile(parsed)) {
    return {
      inventory: migrateLegacyInventory(parsed),
      approvalsEnabled: DEFAULT_PLUGIN_RUNTIME_SETTINGS.approvalsEnabled,
      continuation: DEFAULT_PLUGIN_RUNTIME_SETTINGS.continuation,
      characterSettings: getDefaultCharacterSettings(),
      providerSettings: {},
      routingSettings: { ...DEFAULT_RUNTIME_ROUTING_SETTINGS },
      routingWarnings: [],
      needsRewrite: true,
      fileExisted: true
    }
  }

  return {
    inventory: {},
    approvalsEnabled: DEFAULT_PLUGIN_RUNTIME_SETTINGS.approvalsEnabled,
    continuation: DEFAULT_PLUGIN_RUNTIME_SETTINGS.continuation,
    characterSettings: getDefaultCharacterSettings(),
    providerSettings: {},
    routingSettings: { ...DEFAULT_RUNTIME_ROUTING_SETTINGS },
    routingWarnings: [],
    needsRewrite: true,
    fileExisted: true
  }
}

export function normalizePersistedProviderSettings(value: unknown): {
  settings: PersistedAssistantProviderSettings
  needsRewrite: boolean
} {
  if (value === undefined) {
    return { settings: {}, needsRewrite: false }
  }

  if (!isRecord(value)) {
    return { settings: {}, needsRewrite: true }
  }

  let needsRewrite = false
  const settings: PersistedAssistantProviderSettings = {}

  if (isAssistantProviderKind(value.provider)) {
    settings.provider = value.provider
  } else if (value.provider !== undefined) {
    needsRewrite = true
  }

  if (isRecord(value.openaiCompatible)) {
    const openaiCompatible = normalizeStringFields(value.openaiCompatible, [
      'baseUrl',
      'model'
    ])
    if (Object.keys(openaiCompatible).length > 0) {
      settings.openaiCompatible = openaiCompatible
    }
    needsRewrite = needsRewrite || requiresStringFieldsRewrite(
      value.openaiCompatible,
      openaiCompatible,
      ['baseUrl', 'model']
    )
  } else if (value.openaiCompatible !== undefined) {
    needsRewrite = true
  }

  if (isRecord(value.piAi)) {
    const piAi = normalizeStringFields(value.piAi, [
      'agentDir',
      'modelSpec',
      'smallModelSpec',
      'largeModelSpec',
      'priority'
    ])
    if (Object.keys(piAi).length > 0) {
      settings.piAi = piAi
    }
    needsRewrite = needsRewrite || requiresStringFieldsRewrite(
      value.piAi,
      piAi,
      ['agentDir', 'modelSpec', 'smallModelSpec', 'largeModelSpec', 'priority']
    )
  } else if (value.piAi !== undefined) {
    needsRewrite = true
  }

  return { settings, needsRewrite }
}

export function normalizeRuntimeRoutingSettings(value: unknown): {
  settings: RuntimeRoutingSettings
  warnings: string[]
  needsRewrite: boolean
} {
  if (value === undefined) {
    return {
      settings: { ...DEFAULT_RUNTIME_ROUTING_SETTINGS, rules: [] },
      warnings: [],
      needsRewrite: false
    }
  }

  if (!isRecord(value)) {
    return {
      settings: { ...DEFAULT_RUNTIME_ROUTING_SETTINGS, rules: [] },
      warnings: ['Routing settings were invalid and reset to defaults.'],
      needsRewrite: true
    }
  }

  const warnings: string[] = []
  const rulesInput = Array.isArray(value.rules) ? value.rules : []
  const rules: RuntimeRoutingRule[] = []
  let needsRewrite =
    typeof value.enabled !== 'boolean' || !Array.isArray(value.rules)

  rulesInput.slice(0, 50).forEach((ruleValue, index) => {
    const normalized = normalizeRuntimeRoutingRule(ruleValue, index, warnings)
    if (!normalized.rule) {
      needsRewrite = true
      return
    }

    rules.push(normalized.rule)
    if (normalized.needsRewrite) {
      needsRewrite = true
    }
  })

  if (rulesInput.length > 50) {
    warnings.push('Only the first 50 routing rules are used.')
    needsRewrite = true
  }

  return {
    settings: {
      enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
      rules
    },
    warnings,
    needsRewrite
  }
}

function normalizeRuntimeRoutingRule(
  value: unknown,
  index: number,
  warnings: string[]
): { rule: RuntimeRoutingRule | null; needsRewrite: boolean } {
  if (!isRecord(value)) {
    warnings.push(`Routing rule ${index + 1} was skipped because it is not an object.`)
    return { rule: null, needsRewrite: true }
  }

  let needsRewrite = false
  const id = normalizeLimitedString(value.id, 128) || `routing-rule-${index + 1}`
  const name = normalizeLimitedString(value.name, 120) || `Routing rule ${index + 1}`
  const priority = clampInteger(value.priority, -10_000, 10_000, 0)
  const match = normalizeRuntimeRoutingMatch(value.match, name, warnings)
  const target = normalizeRuntimeRoutingTarget(value.target, name, warnings)

  if (!match || !target) {
    return { rule: null, needsRewrite: true }
  }

  if (
    id !== value.id ||
    name !== value.name ||
    priority !== value.priority ||
    typeof value.enabled !== 'boolean' ||
    typeof value.stopOnMatch !== 'boolean'
  ) {
    needsRewrite = true
  }

  return {
    rule: {
      id,
      enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
      name,
      priority,
      match,
      target,
      stopOnMatch: typeof value.stopOnMatch === 'boolean' ? value.stopOnMatch : true
    },
    needsRewrite
  }
}

function normalizeRuntimeRoutingMatch(
  value: unknown,
  ruleName: string,
  warnings: string[]
): RuntimeRoutingRuleMatch | null {
  if (!isRecord(value)) {
    warnings.push(`Routing rule “${ruleName}” was skipped because it has no match settings.`)
    return null
  }

  const caseSensitive = value.caseSensitive === true

  if (value.kind === 'regex') {
    const pattern = normalizeLimitedString(value.pattern, 300)
    if (!pattern) {
      warnings.push(`Routing rule “${ruleName}” was skipped because its regex pattern is empty.`)
      return null
    }

    try {
      new RegExp(pattern, caseSensitive ? 'u' : 'iu')
    } catch (error) {
      warnings.push(`Routing rule “${ruleName}” has an invalid regex and was disabled: ${String(error)}`)
      return {
        kind: 'regex',
        pattern,
        caseSensitive
      }
    }

    return {
      kind: 'regex',
      pattern,
      caseSensitive
    }
  }

  const keywords = normalizeLimitedStringArray(value.keywords, 20, 120)
  if (keywords.length === 0) {
    warnings.push(`Routing rule “${ruleName}” was skipped because it has no keywords.`)
    return null
  }

  return {
    kind: 'keyword',
    keywords,
    mode: value.mode === 'all' ? 'all' : 'any',
    caseSensitive
  }
}

function normalizeRuntimeRoutingTarget(
  value: unknown,
  ruleName: string,
  warnings: string[]
): RuntimeRoutingRuleTarget | null {
  if (!isRecord(value)) {
    warnings.push(`Routing rule “${ruleName}” was skipped because it has no target settings.`)
    return null
  }

  const actionType = normalizeRoutingTargetActionType(value.actionType)
  if (!actionType) {
    warnings.push(`Routing rule “${ruleName}” has an unsupported target action.`)
    return null
  }

  const params = isRecord(value.params) ? value.params : {}
  const prompt = normalizeLimitedString(params.prompt, 24_000)
  const query = normalizeLimitedString(params.query, 500)

  return {
    actionType,
    params: {
      ...(prompt ? { prompt } : {}),
      ...(query ? { query } : {})
    },
    ...(typeof value.requiresConfirmation === 'boolean'
      ? { requiresConfirmation: value.requiresConfirmation }
      : {})
  }
}

function normalizeRoutingTargetActionType(
  value: unknown
): RuntimeRoutingTargetActionType | null {
  return value === 'hermes-run' || value === 'inspect-cron-jobs' ? value : null
}

function normalizeLimitedString(value: unknown, maxLength: number): string | undefined {
  return typeof value === 'string'
    ? normalizeOptionalString(value)?.slice(0, maxLength)
    : undefined
}

function normalizeLimitedStringArray(
  value: unknown,
  maxItems: number,
  maxLength: number
): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return Array.from(new Set(
    value
      .flatMap((entry) => {
        const normalized = normalizeLimitedString(entry, maxLength)
        return normalized ? [normalized] : []
      })
      .slice(0, maxItems)
  ))
}

export function normalizeRuntimeContinuationSettings(value: unknown): {
  settings: typeof DEFAULT_PLUGIN_RUNTIME_SETTINGS.continuation
  needsRewrite: boolean
} {
  if (!isRecord(value)) {
    return {
      settings: { ...DEFAULT_PLUGIN_RUNTIME_SETTINGS.continuation },
      needsRewrite: value !== undefined
    }
  }

  const settings = {
    maxSteps: clampInteger(
      value.maxSteps,
      1,
      20,
      DEFAULT_PLUGIN_RUNTIME_SETTINGS.continuation.maxSteps
    ),
    maxRuntimeMs: clampInteger(
      value.maxRuntimeMs,
      5_000,
      600_000,
      DEFAULT_PLUGIN_RUNTIME_SETTINGS.continuation.maxRuntimeMs
    ),
    postActionDelayMs: clampInteger(
      value.postActionDelayMs,
      0,
      10_000,
      DEFAULT_PLUGIN_RUNTIME_SETTINGS.continuation.postActionDelayMs
    )
  }

  return {
    settings,
    needsRewrite:
      value.maxSteps !== settings.maxSteps ||
      value.maxRuntimeMs !== settings.maxRuntimeMs ||
      value.postActionDelayMs !== settings.postActionDelayMs
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

function clampInteger(
  value: unknown,
  min: number,
  max: number,
  fallback: number
): number {
  const numeric = typeof value === 'number' ? value : Number(value)

  if (!Number.isFinite(numeric)) {
    return fallback
  }

  return Math.min(max, Math.max(min, Math.floor(numeric)))
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

function isAssistantProviderKind(value: unknown): value is AssistantProviderKind {
  return value === 'eliza-classic' || value === 'openai-compatible' || value === 'pi-ai'
}

function normalizeStringFields<T extends string>(
  value: Record<string, unknown>,
  fields: readonly T[]
): Partial<Record<T, string>> {
  const normalized: Partial<Record<T, string>> = {}

  for (const field of fields) {
    const normalizedValue = normalizeOptionalString(value[field])
    if (normalizedValue !== undefined) {
      normalized[field] = normalizedValue
    }
  }

  return normalized
}

function requiresStringFieldsRewrite<T extends string>(
  value: Record<string, unknown>,
  normalized: Partial<Record<T, string>>,
  fields: readonly T[]
): boolean {
  for (const field of fields) {
    const raw = value[field]
    const next = normalized[field]
    if (raw === undefined && next === undefined) {
      continue
    }

    if (raw !== next) {
      return true
    }
  }

  return false
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
