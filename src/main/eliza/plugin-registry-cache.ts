import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { isRecord } from '../../shared/value-utils'
import type { RegistryPluginEntry } from './plugin-registry-normalization'

export const REGISTRY_CACHE_FILE_NAME = 'eliza-plugin-registry-cache.v1.json'
const REGISTRY_CACHE_TTL_MS = 30 * 60 * 1000

export interface RegistryCacheFile {
  schemaVersion: 1
  fetchedAt: string
  registryUrl: string
  entries: RegistryPluginEntry[]
}

export class PluginRegistryCache {
  private readonly cachePath: string

  constructor(cachePath: string) {
    this.cachePath = cachePath
  }

  read(): RegistryCacheFile | null {
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

  write(cache: RegistryCacheFile): void {
    try {
      mkdirSync(dirname(this.cachePath), { recursive: true })
      writeFileSync(this.cachePath, JSON.stringify(cache, null, 2))
    } catch {
      // Ignore cache write failures: discovery still returns in-memory data.
    }
  }

  isFresh(fetchedAt: string): boolean {
    const timestamp = Date.parse(fetchedAt)
    return Number.isFinite(timestamp) && Date.now() - timestamp < REGISTRY_CACHE_TTL_MS
  }
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
