import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import type {
  AssistantProviderInfo,
  ElizaCharacterSettings,
  ElizaPluginExecutionPolicy,
  ElizaPluginId,
  ElizaPluginLifecycleStatus,
  ElizaPluginSettings,
  ElizaPluginSource,
  RuntimeApprovalSettings,
  UpdateElizaCharacterSettingsRequest,
  UpdateElizaPluginSettingsRequest,
  UpdateRuntimeApprovalSettingsRequest
} from '../../shared/contracts'
import { isRecord, normalizeOptionalString } from '../../shared/value-utils'
import {
  DEFAULT_PLUGIN_RUNTIME_SETTINGS,
  SETTINGS_FILE_NAME,
  type BonziElizaPluginRuntimeSettings,
  type BonziPersistedPluginRecordSnapshot,
  type LoadedSettingsState,
  type NormalizedPluginInventory,
  type PersistedSettingsFileV2
} from './plugin-settings-model'
import {
  canonicalizePluginExecutionPolicy,
  canonicalizePluginLifecycleStatus,
  createDefaultPluginState,
  defaultEnabledForPlugin,
  isRequiredPluginId,
  normalizeParsedSettings,
  normalizePluginId,
  normalizeStringArray,
  validateUpdateRequest,
  withBuiltInDefaults
} from './plugin-settings-normalization'
import {
  getDefaultCharacterSettings,
  toElizaCharacterSettings,
  toPersistedCharacterSettings,
  validateCharacterSettingsUpdate
} from './character-settings-validation'
import {
  buildPluginSettings,
  buildRuntimeSettings
} from './plugin-settings-projection'

export type {
  BonziElizaPluginRuntimeSettings,
  BonziPersistedPluginRecordSnapshot
} from './plugin-settings-model'

export class BonziPluginSettingsStore {
  private readonly settingsPath: string

  constructor(settingsPath = join(app.getPath('userData'), SETTINGS_FILE_NAME)) {
    this.settingsPath = settingsPath
  }

  getRuntimeSettings(): BonziElizaPluginRuntimeSettings {
    const loaded = this.readPersistedPluginInventory()

    return buildRuntimeSettings({
      inventory: loaded.inventory,
      approvalsEnabled: loaded.approvalsEnabled,
      characterSettings: loaded.characterSettings
    })
  }

  getRuntimeApprovalSettings(): RuntimeApprovalSettings {
    return {
      approvalsEnabled: this.readPersistedPluginInventory().approvalsEnabled
    }
  }

  getCharacterSettings(): ElizaCharacterSettings {
    return toElizaCharacterSettings(
      this.readPersistedPluginInventory().characterSettings
    )
  }

  updateCharacterSettings(
    request: UpdateElizaCharacterSettingsRequest
  ): ElizaCharacterSettings {
    const characterSettings = validateCharacterSettingsUpdate(request)
    const loaded = this.readPersistedPluginInventory()

    this.writePersistedSettings({
      schemaVersion: 2,
      plugins: loaded.inventory,
      approvalsEnabled: loaded.approvalsEnabled,
      character: toPersistedCharacterSettings(characterSettings)
    })

    return toElizaCharacterSettings(characterSettings)
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
      approvalsEnabled: request.approvalsEnabled,
      character: toPersistedCharacterSettings(loaded.characterSettings)
    })

    return {
      approvalsEnabled: request.approvalsEnabled
    }
  }

  getSettings(provider: AssistantProviderInfo): ElizaPluginSettings {
    return buildPluginSettings({
      provider,
      inventory: this.getNormalizedPluginInventory()
    })
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
      approvalsEnabled: loaded.approvalsEnabled,
      character: toPersistedCharacterSettings(loaded.characterSettings)
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
      approvalsEnabled: loaded.approvalsEnabled,
      character: toPersistedCharacterSettings(loaded.characterSettings)
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
      approvalsEnabled: loaded.approvalsEnabled,
      character: toPersistedCharacterSettings(loaded.characterSettings)
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
      approvalsEnabled: loaded.approvalsEnabled,
      character: toPersistedCharacterSettings(loaded.characterSettings)
    })

    return this.getSettings(provider)
  }

  private getNormalizedPluginInventory(): NormalizedPluginInventory {
    const loaded = this.readPersistedPluginInventory()
    return loaded.inventory
  }

  private readPersistedPluginInventory(): LoadedSettingsState {
    if (!existsSync(this.settingsPath)) {
      return {
        inventory: withBuiltInDefaults({}).inventory,
        approvalsEnabled: DEFAULT_PLUGIN_RUNTIME_SETTINGS.approvalsEnabled,
        characterSettings: getDefaultCharacterSettings(),
        needsRewrite: false,
        fileExisted: false
      }
    }

    try {
      const parsed = JSON.parse(readFileSync(this.settingsPath, 'utf8'))
      const loaded = normalizeParsedSettings(parsed)
      const withDefaults = withBuiltInDefaults(loaded.inventory)
      const needsRewrite = loaded.needsRewrite || withDefaults.injectedBuiltIns

      if (needsRewrite && loaded.fileExisted) {
        this.writePersistedSettings({
          schemaVersion: 2,
          plugins: withDefaults.inventory,
          approvalsEnabled: loaded.approvalsEnabled,
          character: toPersistedCharacterSettings(loaded.characterSettings)
        })
      }

      return {
        inventory: withDefaults.inventory,
        approvalsEnabled: loaded.approvalsEnabled,
        characterSettings: loaded.characterSettings,
        needsRewrite,
        fileExisted: loaded.fileExisted
      }
    } catch {
      const withDefaults = withBuiltInDefaults({})

      this.writePersistedSettings({
        schemaVersion: 2,
        plugins: withDefaults.inventory,
        approvalsEnabled: DEFAULT_PLUGIN_RUNTIME_SETTINGS.approvalsEnabled,
        character: toPersistedCharacterSettings(getDefaultCharacterSettings())
      })

      return {
        inventory: withDefaults.inventory,
        approvalsEnabled: DEFAULT_PLUGIN_RUNTIME_SETTINGS.approvalsEnabled,
        characterSettings: getDefaultCharacterSettings(),
        needsRewrite: true,
        fileExisted: true
      }
    }
  }

  private writePersistedSettings(settings: PersistedSettingsFileV2): void {
    mkdirSync(dirname(this.settingsPath), { recursive: true })
    writeFileSync(this.settingsPath, JSON.stringify(settings, null, 2))
  }
}
