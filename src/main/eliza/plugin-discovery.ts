import { app } from 'electron'
import { join } from 'node:path'
import type {
  AssistantProviderInfo,
  ElizaPluginDiscoveryRequest,
  ElizaPluginSettings
} from '../../shared/contracts'
import { BonziPluginSettingsStore } from './plugin-settings'
import { buildDiscoveryResult, buildDiscoveryState, mergeRegistryEntries } from './plugin-discovery-merge'
import {
  PluginRegistryCache,
  REGISTRY_CACHE_FILE_NAME
} from './plugin-registry-cache'
import { PluginRegistryClient } from './plugin-registry-client'

const DEFAULT_REGISTRY_URL =
  'https://raw.githubusercontent.com/elizaos-plugins/registry/main/generated-registry.json'

interface BonziPluginDiscoveryServiceOptions {
  settingsStore?: BonziPluginSettingsStore
  cachePath?: string
  registryUrl?: string
  fetchImpl?: typeof fetch
}

export class BonziPluginDiscoveryService {
  private readonly settingsStore: BonziPluginSettingsStore
  private readonly registryClient: PluginRegistryClient

  constructor(options: BonziPluginDiscoveryServiceOptions = {}) {
    this.settingsStore = options.settingsStore ?? new BonziPluginSettingsStore()

    const cachePath =
      options.cachePath ??
      join(app.getPath('userData'), REGISTRY_CACHE_FILE_NAME)
    const registryUrl =
      process.env.BONZI_ELIZA_PLUGIN_REGISTRY_URL?.trim() ||
      options.registryUrl ||
      DEFAULT_REGISTRY_URL
    const cache = new PluginRegistryCache(cachePath)

    this.registryClient = new PluginRegistryClient({
      registryUrl,
      fetchImpl: options.fetchImpl,
      cache
    })
  }

  async discover(
    provider: AssistantProviderInfo,
    request: ElizaPluginDiscoveryRequest = {}
  ): Promise<ElizaPluginSettings> {
    const settings = this.settingsStore.getSettings(provider)
    const persisted = this.settingsStore.getPersistedPluginInventorySnapshot()
    const state = buildDiscoveryState({
      settings,
      persisted
    })
    const warnings: string[] = []

    const loadedRegistry = await this.registryClient.loadEntries({
      forceRefresh: request.forceRefresh === true
    })
    warnings.push(...loadedRegistry.warnings)

    mergeRegistryEntries(state, loadedRegistry.entries)

    return buildDiscoveryResult(state, warnings)
  }
}
