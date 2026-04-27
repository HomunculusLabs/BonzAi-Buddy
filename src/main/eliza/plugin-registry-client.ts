import {
  isRecord,
  normalizeError,
  normalizeOptionalString
} from '../../shared/value-utils'
import type {
  LoadedRegistryEntries,
  RegistryPluginEntry
} from './plugin-registry-normalization'
import {
  normalizeRegistryPayload,
  REGISTRY_MISSING_DESCRIPTION_FALLBACK
} from './plugin-registry-normalization'
import { PluginRegistryCache } from './plugin-registry-cache'

const DEFAULT_REGISTRY_TIMEOUT_MS = 4_000
const NPM_REGISTRY_BASE_URL = 'https://registry.npmjs.org'

interface PluginRegistryClientOptions {
  registryUrl: string
  cache: PluginRegistryCache
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export class PluginRegistryClient {
  private readonly registryUrl: string
  private readonly cache: PluginRegistryCache
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  constructor(options: PluginRegistryClientOptions) {
    this.registryUrl = options.registryUrl
    this.cache = options.cache
    this.fetchImpl = options.fetchImpl ?? fetch
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REGISTRY_TIMEOUT_MS
  }

  async loadEntries(options: { forceRefresh: boolean }): Promise<LoadedRegistryEntries> {
    const warnings: string[] = []
    const cached = this.cache.read()

    if (
      cached &&
      !options.forceRefresh &&
      cached.registryUrl === this.registryUrl &&
      this.cache.isFresh(cached.fetchedAt)
    ) {
      return {
        entries: cached.entries,
        warnings
      }
    }

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

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
        const entries = await this.enrichMissingDescriptions(normalized.entries)

        this.cache.write({
          schemaVersion: 2,
          fetchedAt: new Date().toISOString(),
          registryUrl: this.registryUrl,
          entries
        })

        return {
          entries,
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

  private async enrichMissingDescriptions(
    entries: RegistryPluginEntry[]
  ): Promise<RegistryPluginEntry[]> {
    return Promise.all(
      entries.map(async (entry) => {
        if (
          entry.description !== REGISTRY_MISSING_DESCRIPTION_FALLBACK ||
          !entry.packageName
        ) {
          return entry
        }

        const description = await this.loadNpmDescription(entry.packageName, entry.version)
        return description ? { ...entry, description } : entry
      })
    )
  }

  private async loadNpmDescription(
    packageName: string,
    version: string | undefined
  ): Promise<string | undefined> {
    const packagePath = encodeURIComponent(packageName)
    const urls = version
      ? [
          `${NPM_REGISTRY_BASE_URL}/${packagePath}/${encodeURIComponent(version)}`,
          `${NPM_REGISTRY_BASE_URL}/${packagePath}`
        ]
      : [`${NPM_REGISTRY_BASE_URL}/${packagePath}`]

    for (const url of urls) {
      const description = await this.fetchNpmDescription(url)
      if (description) {
        return description
      }
    }

    return undefined
  }

  private async fetchNpmDescription(url: string): Promise<string | undefined> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const response = await this.fetchImpl(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json'
        }
      })

      if (!response.ok) {
        return undefined
      }

      const parsed = await response.json()
      if (!isRecord(parsed)) {
        return undefined
      }

      return normalizeOptionalString(parsed.description)
    } catch {
      return undefined
    } finally {
      clearTimeout(timeout)
    }
  }
}
