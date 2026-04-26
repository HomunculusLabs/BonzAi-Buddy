import { normalizeError } from '../../shared/value-utils'
import type { LoadedRegistryEntries } from './plugin-registry-normalization'
import { normalizeRegistryPayload } from './plugin-registry-normalization'
import { PluginRegistryCache } from './plugin-registry-cache'

const DEFAULT_REGISTRY_TIMEOUT_MS = 4_000

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

        this.cache.write({
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
}
