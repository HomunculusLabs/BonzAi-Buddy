import type {
  ElizaPluginExecutionPolicy,
  ElizaPluginLifecycleStatus,
  ElizaPluginSource
} from '../../shared/contracts'
import { dedupeStrings, isRecord } from '../../shared/value-utils'

export const REGISTRY_MISSING_DESCRIPTION_FALLBACK =
  'Plugin metadata was discovered from registry but has no description.'

export interface RegistryPluginEntry {
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

export interface LoadedRegistryEntries {
  entries: RegistryPluginEntry[]
  warnings: string[]
}

export function normalizeRegistryPayload(payload: unknown): LoadedRegistryEntries {
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
  const lifecycleStatus = deriveRegistryLifecycleStatus({
    item,
    compatibilityMeta
  })

  const name =
    readString(item.name) ??
    readString(item.title) ??
    normalizeNameFromId(id)
  const description =
    readString(item.description) ??
    readString(item.summary) ??
    readString(npmMetadata?.description) ??
    readString(item.npmDescription) ??
    REGISTRY_MISSING_DESCRIPTION_FALLBACK

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
    lifecycleStatus,
    executionPolicy: 'confirm_each_action',
    warnings:
      lifecycleStatus === 'incompatible'
        ? [...warnings, 'Registry marked this plugin as incompatible.']
        : warnings,
    errors
  }
}

export function deriveRegistryLifecycleStatus(input: {
  item: Record<string, unknown>
  compatibilityMeta: readonly string[]
}): ElizaPluginLifecycleStatus {
  const { item, compatibilityMeta } = input
  const incompatible =
    item.compatible === false ||
    item.supported === false ||
    compatibilityMeta.includes('compatible:false') ||
    compatibilityMeta.includes('supported:false')

  return incompatible ? 'incompatible' : 'available'
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
