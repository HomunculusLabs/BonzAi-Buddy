import type {
  AssistantProviderInfo,
  ElizaOptionalPluginId,
  ElizaPluginExecutionPolicy,
  ElizaPluginLifecycleStatus,
  ElizaPluginSource
} from '../../shared/contracts'

export interface BonziElizaPluginRuntimeSettings {
  contextEnabled: boolean
  desktopActionsEnabled: boolean
  approvalsEnabled: boolean
}

export interface OptionalPluginCatalogEntry {
  id: ElizaOptionalPluginId
  name: string
  packageName?: string
  description: string
  defaultInstalled: boolean
  defaultEnabled: boolean
}

export interface PersistedPluginRecord {
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

export interface PersistedSettingsFileV2 {
  schemaVersion: 2
  plugins: Record<string, PersistedPluginRecord>
  approvalsEnabled?: boolean
}

export interface PersistedSettingsFileLegacy {
  plugins?: Record<string, boolean>
  catalog?: {
    installed?: Record<string, boolean>
  }
}

export type NormalizedPluginInventory = Record<string, PersistedPluginRecord>

export interface LoadedSettingsState {
  inventory: NormalizedPluginInventory
  approvalsEnabled: boolean
  needsRewrite: boolean
  fileExisted: boolean
}

export const SETTINGS_FILE_NAME = 'bonzi-settings.json'

export const OPTIONAL_PLUGIN_CATALOG = [
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

export const DEFAULT_PLUGIN_RUNTIME_SETTINGS: BonziElizaPluginRuntimeSettings = {
  contextEnabled: true,
  desktopActionsEnabled: true,
  approvalsEnabled: true
}

export const PROVIDER_PACKAGE_NAMES: Record<AssistantProviderInfo['kind'], string> = {
  'eliza-classic': '@elizaos/plugin-eliza-classic',
  'openai-compatible': '@elizaos/plugin-openai'
}
