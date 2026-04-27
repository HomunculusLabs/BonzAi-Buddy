export const ELIZA_OPTIONAL_PLUGIN_IDS = [
  'bonzi-context',
  'bonzi-desktop-actions'
] as const

export const ELIZA_REQUIRED_PLUGIN_IDS = ['localdb', 'provider'] as const

export type ElizaOptionalPluginId = (typeof ELIZA_OPTIONAL_PLUGIN_IDS)[number]

export type ElizaRequiredPluginId = (typeof ELIZA_REQUIRED_PLUGIN_IDS)[number]

export type ElizaPluginId = string

export type ElizaPluginSource =
  | 'required'
  | 'bonzi-builtin'
  | 'registry'
  | 'local-workspace'
  | 'installed-package'
  | 'unknown'
  | 'user-configured'
  | 'external'

export type ElizaPluginLifecycleStatus =
  | 'available'
  | 'installing'
  | 'installed'
  | 'enabled'
  | 'disabled'
  | 'install_failed'
  | 'load_failed'
  | 'incompatible'
  | 'uninstalling'
  | 'removed'
  | 'error'
  | 'unknown'

export type ElizaPluginExecutionPolicy =
  | 'trusted_auto'
  | 'confirm_each_action'
  | 'disabled'
  | 'manual'

export interface ElizaPluginInventoryEntry {
  id: ElizaPluginId
  installed: boolean
  enabled: boolean
  source: ElizaPluginSource
  lifecycleStatus: ElizaPluginLifecycleStatus
  executionPolicy: ElizaPluginExecutionPolicy
  name?: string
  packageName?: string
  version?: string
  description?: string
  repository?: string
  capabilities?: string[]
  compatibility?: string[]
  warnings?: string[]
  errors?: string[]
}

export interface ElizaInstalledPluginEntry {
  id: ElizaPluginId
  name: string
  packageName?: string
  version?: string
  description: string
  enabled: boolean
  required: boolean
  configurable: boolean
  removable: boolean
  source?: ElizaPluginSource
  lifecycleStatus?: ElizaPluginLifecycleStatus
  executionPolicy?: ElizaPluginExecutionPolicy
  capabilities?: string[]
  compatibility?: string[]
  repository?: string
  warnings?: string[]
  errors?: string[]
}

export interface ElizaAvailablePluginEntry {
  id: ElizaPluginId
  name: string
  packageName?: string
  version?: string
  description: string
  source?: ElizaPluginSource
  lifecycleStatus?: ElizaPluginLifecycleStatus
  executionPolicy?: ElizaPluginExecutionPolicy
  capabilities?: string[]
  compatibility?: string[]
  repository?: string
  warnings?: string[]
  errors?: string[]
}

export type ElizaPluginSettingsEntry = ElizaInstalledPluginEntry

export interface ElizaPluginSettings {
  installedPlugins: ElizaInstalledPluginEntry[]
  availablePlugins: ElizaAvailablePluginEntry[]
  inventory?: ElizaPluginInventoryEntry[]
  warnings?: string[]
  errors?: string[]
  operations?: ElizaPluginOperationSnapshot[]
}

export type UpdateElizaPluginSettingsOperation =
  | { type: 'set-enabled'; id: ElizaPluginId; enabled: boolean }
  | { type: 'add'; id: ElizaPluginId }
  | { type: 'remove'; id: ElizaPluginId }

export interface UpdateElizaPluginSettingsRequest {
  operations: UpdateElizaPluginSettingsOperation[]
}

export interface ElizaPluginDiscoveryRequest {
  forceRefresh?: boolean
}

export interface ElizaPluginInstallRequest {
  id?: ElizaPluginId
  pluginId?: ElizaPluginId
  packageName?: string
  versionRange?: string
  registryRef?: string
  lifecycleStatus?: ElizaPluginLifecycleStatus
  confirmed?: boolean
  confirmationOperationId?: string
  ignoreScripts?: boolean
}

export interface ElizaPluginUpdateRequest {
  id: ElizaPluginId
  version?: string
}

export interface ElizaPluginUninstallRequest {
  id?: ElizaPluginId
  pluginId?: ElizaPluginId
  packageName?: string
  confirmed?: boolean
}

export type ElizaPluginOperationType =
  | 'discover'
  | 'install'
  | 'update'
  | 'uninstall'

export type ElizaPluginOperationStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export interface ElizaPluginOperationSnapshot {
  operationId: string
  type: ElizaPluginOperationType
  pluginId?: ElizaPluginId
  status: ElizaPluginOperationStatus
  startedAt: string
  finishedAt?: string
  warnings?: string[]
  error?: string
  stdout?: string
  stderr?: string
  workspaceDir?: string
  command?: string
  timeoutMs?: number
}

export interface ElizaPluginOperationResult {
  ok: boolean
  confirmationRequired: boolean
  message: string
  operation: ElizaPluginOperationSnapshot
  settings: ElizaPluginSettings
}

export type ElizaPluginInstallEligibilityCode =
  | 'eligible'
  | 'missing_package_name'
  | 'incompatible'

export interface ElizaPluginInstallEligibility {
  eligible: boolean
  code: ElizaPluginInstallEligibilityCode
  reason?: string
}

export function derivePluginInstallEligibility(input: {
  packageName?: string
  lifecycleStatus?: ElizaPluginLifecycleStatus
}): ElizaPluginInstallEligibility {
  if (input.lifecycleStatus === 'incompatible') {
    return {
      eligible: false,
      code: 'incompatible',
      reason:
        'Cannot install this plugin because registry metadata marked it incompatible with the current runtime.'
    }
  }

  if (!input.packageName) {
    return {
      eligible: false,
      code: 'missing_package_name',
      reason:
        'Cannot install this plugin because registry metadata did not include a package name.'
    }
  }

  return {
    eligible: true,
    code: 'eligible'
  }
}
