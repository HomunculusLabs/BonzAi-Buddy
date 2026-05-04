import type {
  AssistantProviderInfo,
  ElizaCharacterSettings,
  PersistedAssistantProviderSettings,
  ElizaOptionalPluginId,
  ElizaPluginExecutionPolicy,
  ElizaPluginLifecycleStatus,
  ElizaPluginSource,
  RuntimeContinuationSettings,
  RuntimeRoutingSettings
} from '../../shared/contracts'

export interface SanitizedBonziMessageExample {
  name: string
  content: {
    text: string
  }
}

export interface SanitizedBonziCharacterOverride {
  name?: string
  system?: string
  bio?: string | string[]
  lore?: string[]
  messageExamples?: SanitizedBonziMessageExample[][]
  postExamples?: string[]
  topics?: string[]
  adjectives?: string[]
  style?: {
    all?: string[]
    chat?: string[]
    post?: string[]
  }
}

export interface PersistedCharacterSettings {
  enabled: boolean
  characterJson: string
}

export interface NormalizedCharacterSettings extends ElizaCharacterSettings {
  override: SanitizedBonziCharacterOverride | null
}

export interface BonziElizaPluginRuntimeSettings {
  contextEnabled: boolean
  desktopActionsEnabled: boolean
  approvalsEnabled: boolean
  continuation: RuntimeContinuationSettings
  character: {
    enabled: boolean
    characterJson: string
    override: SanitizedBonziCharacterOverride | null
  }
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

export interface PersistedRuntimeContinuationSettings {
  maxSteps?: number
  maxRuntimeMs?: number
  postActionDelayMs?: number
}

export interface PersistedSettingsFileV2 {
  schemaVersion: 2
  plugins: Record<string, PersistedPluginRecord>
  approvalsEnabled?: boolean
  continuation?: PersistedRuntimeContinuationSettings
  character?: PersistedCharacterSettings
  provider?: PersistedAssistantProviderSettings
  routing?: RuntimeRoutingSettings
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
  continuation: RuntimeContinuationSettings
  characterSettings: NormalizedCharacterSettings
  providerSettings: PersistedAssistantProviderSettings
  routingSettings: RuntimeRoutingSettings
  routingWarnings: string[]
  needsRewrite: boolean
  fileExisted: boolean
}

export const SETTINGS_FILE_NAME = 'bonzi-settings.json'

export const DEFAULT_RUNTIME_ROUTING_SETTINGS: RuntimeRoutingSettings = {
  enabled: true,
  rules: []
}

export const DEFAULT_CHARACTER_SETTINGS: NormalizedCharacterSettings = {
  enabled: false,
  characterJson: '{}',
  defaultCharacterJson: '{}',
  warnings: [],
  override: null
}

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
  approvalsEnabled: true,
  continuation: {
    maxSteps: 6,
    maxRuntimeMs: 120_000,
    postActionDelayMs: 750
  },
  character: {
    enabled: DEFAULT_CHARACTER_SETTINGS.enabled,
    characterJson: DEFAULT_CHARACTER_SETTINGS.characterJson,
    override: DEFAULT_CHARACTER_SETTINGS.override
  }
}

export const PROVIDER_PACKAGE_NAMES: Record<AssistantProviderInfo['kind'], string> = {
  'eliza-classic': '@elizaos/plugin-eliza-classic',
  'openai-compatible': '@elizaos/plugin-openai',
  'pi-ai': '@elizaos/plugin-pi-ai'
}
