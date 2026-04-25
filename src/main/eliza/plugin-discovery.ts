import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  AssistantProviderInfo,
  ElizaAvailablePluginEntry,
  ElizaInstalledPluginEntry,
  ElizaPluginDiscoveryRequest,
  ElizaPluginExecutionPolicy,
  ElizaPluginInventoryEntry,
  ElizaPluginLifecycleStatus,
  ElizaPluginSettings,
  ElizaPluginSource
} from '../../shared/contracts'
import { dedupeStrings, isRecord, normalizeError } from '../../shared/value-utils'
import {
  BonziPluginSettingsStore,
  type BonziPersistedPluginRecordSnapshot
} from './plugin-settings'

const DEFAULT_REGISTRY_URL =
  'https://raw.githubusercontent.com/elizaos-plugins/registry/main/generated-registry.json'
const REGISTRY_CACHE_FILE_NAME = 'eliza-plugin-registry-cache.v1.json'
const REGISTRY_CACHE_TTL_MS = 30 * 60 * 1000
const REGISTRY_TIMEOUT_MS = 4_000

interface BonziPluginDiscoveryServiceOptions {
  settingsStore?: BonziPluginSettingsStore
  cachePath?: string
  registryUrl?: string
  fetchImpl?: typeof fetch
}

interface RegistryCacheFile {
  schemaVersion: 1
  fetchedAt: string
  registryUrl: string
  entries: RegistryPluginEntry[]
}

interface RegistryPluginEntry {
  id: string
  name: string
  packageName?: string
  description: string
  version?: string
  repository?: string
  compatibility?: string[]
  capabilities?: string[]
  source: ElizaPluginSource
  lifecycleStatus: ElizaPluginLifecycleStatus
  executionPolicy: ElizaPluginExecutionPolicy
  warnings: string[]
  errors: string[]
}

interface LoadedRegistryEntries {
  entries: RegistryPluginEntry[]
  warnings: string[]
}

export class BonziPluginDiscoveryService {
  private readonly settingsStore: BonziPluginSettingsStore
  private readonly cachePath: string
  private readonly registryUrl: string
  private readonly fetchImpl: typeof fetch

  constructor(options: BonziPluginDiscoveryServiceOptions = {}) {
    this.settingsStore = options.settingsStore ?? new BonziPluginSettingsStore()
    this.cachePath =
      options.cachePath ??
      join(app.getPath('userData'), REGISTRY_CACHE_FILE_NAME)
    this.registryUrl =
      process.env.BONZI_ELIZA_PLUGIN_REGISTRY_URL?.trim() ||
      options.registryUrl ||
      DEFAULT_REGISTRY_URL
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async discover(
    provider: AssistantProviderInfo,
    request: ElizaPluginDiscoveryRequest = {}
  ): Promise<ElizaPluginSettings> {
    const settings = this.settingsStore.getSettings(provider)
    const persisted = this.settingsStore.getPersistedPluginInventorySnapshot()
    const installedById = new Map<string, ElizaInstalledPluginEntry>()
    const availableById = new Map<string, ElizaAvailablePluginEntry>()
    const inventoryById = new Map<string, ElizaPluginInventoryEntry>()
    const warnings: string[] = []

    for (const plugin of settings.installedPlugins) {
      const persistedRecord = persisted[plugin.id]
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

    for (const plugin of settings.availablePlugins) {
      const persistedRecord = persisted[plugin.id]
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

    for (const [pluginId, record] of Object.entries(persisted)) {
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

    const loadedRegistry = await this.loadRegistryEntries({
      forceRefresh: request.forceRefresh === true
    })
    warnings.push(...loadedRegistry.warnings)

    for (const registryEntry of loadedRegistry.entries) {
      const installed = installedById.get(registryEntry.id)
      const available = availableById.get(registryEntry.id)
      const inventory = inventoryById.get(registryEntry.id)

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
          warnings: dedupeStrings([
            ...(installed.warnings ?? []),
            ...registryEntry.warnings
          ]),
          errors: dedupeStrings([...(installed.errors ?? []), ...registryEntry.errors])
        }
        installedById.set(registryEntry.id, mergedInstalled)
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
          warnings: dedupeStrings([
            ...(baseAvailable.warnings ?? []),
            ...registryEntry.warnings
          ]),
          errors: dedupeStrings([...(baseAvailable.errors ?? []), ...registryEntry.errors])
        }
        availableById.set(registryEntry.id, mergedAvailable)
      }

      if (inventory) {
        inventoryById.set(registryEntry.id, {
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
        inventoryById.set(registryEntry.id, {
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

    return {
      installedPlugins: sortInstalledPlugins(Array.from(installedById.values())),
      availablePlugins: sortAvailablePlugins(Array.from(availableById.values())),
      inventory: sortInventory(Array.from(inventoryById.values())),
      warnings: dedupeStrings(warnings)
    }
  }

  private async loadRegistryEntries(options: {
    forceRefresh: boolean
  }): Promise<LoadedRegistryEntries> {
    const warnings: string[] = []
    const cached = this.readRegistryCache()

    if (
      cached &&
      !options.forceRefresh &&
      cached.registryUrl === this.registryUrl &&
      isFreshCache(cached.fetchedAt)
    ) {
      return {
        entries: cached.entries,
        warnings
      }
    }

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), REGISTRY_TIMEOUT_MS)

      try {
        const response = await this.fetchImpl(this.registryUrl, {
          signal: controller.signal,
          headers: {
            Accept: 'application/json'
          }
        })

        if (!response.ok) {
          throw new Error(`Registry responded with HTTP ${response.status}`)
        }

        const parsed = await response.json()
        const normalized = normalizeRegistryPayload(parsed)

        this.writeRegistryCache({
          schemaVersion: 1,
          fetchedAt: new Date().toISOString(),
          registryUrl: this.registryUrl,
          entries: normalized.entries
        })

        return {
          entries: normalized.entries,
          warnings: normalized.warnings
        }
      } finally {
        clearTimeout(timeout)
      }
    } catch (error) {
      if (cached) {
        warnings.push(
          `Failed to refresh plugin registry (${normalizeError(error)}). Using cached registry metadata.`
        )
        return {
          entries: cached.entries,
          warnings
        }
      }

      warnings.push(
        `Failed to load plugin registry (${normalizeError(error)}). Showing required and locally persisted plugins only.`
      )
      return {
        entries: [],
        warnings
      }
    }
  }

  private readRegistryCache(): RegistryCacheFile | null {
    if (!existsSync(this.cachePath)) {
      return null
    }

    try {
      const parsed = JSON.parse(readFileSync(this.cachePath, 'utf8'))
      if (!isRegistryCacheFile(parsed)) {
        return null
      }

      return parsed
    } catch {
      return null
    }
  }

  private writeRegistryCache(cache: RegistryCacheFile): void {
    try {
      mkdirSync(dirname(this.cachePath), { recursive: true })
      writeFileSync(this.cachePath, JSON.stringify(cache, null, 2))
    } catch {
      // Ignore cache write failures: discovery still returns in-memory data.
    }
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

function normalizeRegistryPayload(payload: unknown): LoadedRegistryEntries {
  const warnings: string[] = []
  const entries: RegistryPluginEntry[] = []

  for (const item of getRegistryItems(payload, warnings)) {
    const normalized = normalizeRegistryPluginEntry(item)

    if (!normalized) {
      continue
    }

    entries.push(normalized)
  }

  return {
    entries: dedupeRegistryEntries(entries),
    warnings: dedupeStrings(warnings)
  }
}

function getRegistryItems(payload: unknown, warnings: string[]): unknown[] {
  if (Array.isArray(payload)) {
    return payload
  }

  if (!isRecord(payload)) {
    warnings.push('Registry payload was not an object or array.')
    return []
  }

  for (const key of ['registry', 'plugins', 'items', 'packages', 'data', 'results']) {
    const candidate = payload[key]
    if (Array.isArray(candidate)) {
      return candidate
    }

    if (isRecord(candidate)) {
      return Object.entries(candidate).map(([id, value]) => {
        if (isRecord(value) && typeof value.id !== 'string') {
          return {
            ...value,
            id
          }
        }

        return value
      })
    }
  }

  warnings.push('Registry payload did not include a recognizable plugin collection field.')
  return []
}

function normalizeRegistryPluginEntry(item: unknown): RegistryPluginEntry | null {
  if (!isRecord(item)) {
    return null
  }

  const warnings: string[] = []
  const errors: string[] = []
  const npmMetadata = isRecord(item.npm) ? item.npm : null
  const gitMetadata = isRecord(item.git) ? item.git : null
  const supportsMetadata = isRecord(item.supports) ? item.supports : null
  const packageName =
    readString(item.packageName) ??
    readString(item.npmPackage) ??
    readString(item.package) ??
    readString(item.module) ??
    readString(npmMetadata?.repo)
  const id =
    readString(item.id) ??
    readString(item.pluginId) ??
    normalizeIdFromPackageName(packageName) ??
    readString(item.slug)

  if (!id) {
    return null
  }

  const compatibility = readStringArray(item.compatibility) ?? readStringArray(item.compat)
  const compatibilityMeta = dedupeStrings([
    ...(compatibility ??
      readCompatibilityRecord(item.compatibility) ??
      readCompatibilityRecord(item.compat) ??
      []),
    ...(supportsMetadata ? readCompatibilityRecord(supportsMetadata) ?? [] : []),
    ...readNpmCompatibilityMetadata(npmMetadata)
  ])
  const alphaSupported = supportsMetadata?.alpha
  const incompatible =
    item.compatible === false ||
    item.supported === false ||
    compatibilityMeta.includes('compatible:false') ||
    compatibilityMeta.includes('supported:false') ||
    alphaSupported === false

  const name =
    readString(item.name) ??
    readString(item.title) ??
    normalizeNameFromId(id)
  const description =
    readString(item.description) ??
    readString(item.summary) ??
    'Plugin metadata was discovered from registry but has no description.'

  if (!readString(item.description) && !readString(item.summary)) {
    warnings.push('Registry entry did not include a description.')
  }

  if (!packageName) {
    warnings.push('Registry entry did not include a package name.')
  }

  return {
    id,
    name,
    packageName,
    description,
    version:
      readString(item.version) ??
      readString(item.latestVersion) ??
      readString(item.latest) ??
      readNpmVersion(npmMetadata),
    repository:
      readString(item.repository) ??
      (isRecord(item.repository) ? readString(item.repository.url) : undefined) ??
      readString(item.homepage) ??
      normalizeRepositoryUrl(readString(gitMetadata?.repo)),
    compatibility: compatibilityMeta,
    capabilities: dedupeStrings(
      readStringArray(item.capabilities) ??
        readStringArray(item.features) ??
        readStringArray(item.tags) ??
        []
    ),
    source: 'registry',
    lifecycleStatus: incompatible ? 'incompatible' : 'available',
    executionPolicy: 'confirm_each_action',
    warnings: incompatible
      ? [...warnings, 'Registry marked this plugin as incompatible.']
      : warnings,
    errors
  }
}

function dedupeRegistryEntries(entries: RegistryPluginEntry[]): RegistryPluginEntry[] {
  const byId = new Map<string, RegistryPluginEntry>()

  for (const entry of entries) {
    const existing = byId.get(entry.id)

    if (!existing) {
      byId.set(entry.id, entry)
      continue
    }

    byId.set(entry.id, {
      ...existing,
      name: fallbackString(existing.name, entry.name),
      description: fallbackString(existing.description, entry.description),
      packageName: existing.packageName ?? entry.packageName,
      version: existing.version ?? entry.version,
      repository: existing.repository ?? entry.repository,
      compatibility: dedupeStrings([
        ...(existing.compatibility ?? []),
        ...(entry.compatibility ?? [])
      ]),
      capabilities: dedupeStrings([
        ...(existing.capabilities ?? []),
        ...(entry.capabilities ?? [])
      ]),
      warnings: dedupeStrings([...existing.warnings, ...entry.warnings]),
      errors: dedupeStrings([...existing.errors, ...entry.errors]),
      lifecycleStatus:
        existing.lifecycleStatus === 'incompatible' ||
        entry.lifecycleStatus === 'incompatible'
          ? 'incompatible'
          : existing.lifecycleStatus
    })
  }

  return Array.from(byId.values())
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

function sortInventory(
  entries: ElizaPluginInventoryEntry[]
): ElizaPluginInventoryEntry[] {
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

function readCompatibilityRecord(value: unknown): string[] | null {
  if (!isRecord(value)) {
    return null
  }

  const entries: string[] = []

  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      entries.push(`${key}:${String(raw)}`)
    }
  }

  return entries
}

function readNpmCompatibilityMetadata(value: Record<string, unknown> | null): string[] {
  if (!value) {
    return []
  }

  const entries: string[] = []

  for (const key of ['v0CoreRange', 'v1CoreRange', 'alphaCoreRange']) {
    const raw = readString(value[key])
    if (raw) {
      entries.push(`${key}:${raw}`)
    }
  }

  return entries
}

function readNpmVersion(value: Record<string, unknown> | null): string | undefined {
  if (!value) {
    return undefined
  }

  for (const key of ['alpha', 'v1', 'v0']) {
    const raw = value[key]
    if (typeof raw === 'string') {
      return raw
    }

    if (isRecord(raw)) {
      const version = readString(raw.version)
      if (version) {
        return version
      }
    }
  }

  return undefined
}

function normalizeRepositoryUrl(repo: string | undefined): string | undefined {
  if (!repo) {
    return undefined
  }

  if (/^https?:\/\//.test(repo)) {
    return repo
  }

  const normalized = repo.replace(/^github:/, '')
  return normalized ? `https://github.com/${normalized}` : undefined
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

function normalizeNameFromId(id: string): string {
  return id
    .replace(/^@/, '')
    .split(/[\/-]/)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment[0].toUpperCase() + segment.slice(1))
    .join(' ')
}

function normalizeIdFromPackageName(packageName: string | undefined): string | undefined {
  if (!packageName) {
    return undefined
  }

  const segments = packageName.split('/')
  const last = segments[segments.length - 1]
  const normalized = last.replace(/^plugin-/, '').trim()
  return normalized.length > 0 ? normalized : undefined
}

function fallbackString(primary: string, fallback: string): string {
  return primary.trim().length > 0 ? primary : fallback
}

function isFreshCache(fetchedAt: string): boolean {
  const timestamp = Date.parse(fetchedAt)
  return Number.isFinite(timestamp) && Date.now() - timestamp < REGISTRY_CACHE_TTL_MS
}

function isRegistryCacheFile(value: unknown): value is RegistryCacheFile {
  if (!isRecord(value)) {
    return false
  }

  return (
    value.schemaVersion === 1 &&
    typeof value.fetchedAt === 'string' &&
    typeof value.registryUrl === 'string' &&
    Array.isArray(value.entries)
  )
}

