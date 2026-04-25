export type AssistantProviderKind = 'eliza-classic' | 'openai-compatible'

export interface AssistantProviderInfo {
  kind: AssistantProviderKind
  label: string
}

export interface AssistantRuntimeStatus {
  backend: 'eliza'
  state: 'starting' | 'ready' | 'error'
  persistence: 'localdb'
  lastError?: string
}

export const ELIZA_OPTIONAL_PLUGIN_IDS = [
  'bonzi-context',
  'bonzi-desktop-actions'
] as const

export const ELIZA_REQUIRED_PLUGIN_IDS = ['localdb', 'provider'] as const

export type ElizaOptionalPluginId = (typeof ELIZA_OPTIONAL_PLUGIN_IDS)[number]

export type ElizaRequiredPluginId = (typeof ELIZA_REQUIRED_PLUGIN_IDS)[number]

export type ElizaPluginId = ElizaRequiredPluginId | ElizaOptionalPluginId

export interface ElizaInstalledPluginEntry {
  id: ElizaPluginId
  name: string
  packageName?: string
  description: string
  enabled: boolean
  required: boolean
  configurable: boolean
  removable: boolean
}

export interface ElizaAvailablePluginEntry {
  id: ElizaOptionalPluginId
  name: string
  packageName?: string
  description: string
}

export type ElizaPluginSettingsEntry = ElizaInstalledPluginEntry

export interface ElizaPluginSettings {
  installedPlugins: ElizaInstalledPluginEntry[]
  availablePlugins: ElizaAvailablePluginEntry[]
}

export type UpdateElizaPluginSettingsOperation =
  | { type: 'set-enabled'; id: ElizaOptionalPluginId; enabled: boolean }
  | { type: 'add'; id: ElizaOptionalPluginId }
  | { type: 'remove'; id: ElizaOptionalPluginId }

export interface UpdateElizaPluginSettingsRequest {
  operations: UpdateElizaPluginSettingsOperation[]
}

export type AssistantMessageRole = 'user' | 'assistant' | 'system'

export interface AssistantMessage {
  id: string
  role: AssistantMessageRole
  content: string
  createdAt: string
}

export const ASSISTANT_ACTION_TYPES = [
  'report-shell-state',
  'copy-vrm-asset-path',
  'minimize-window',
  'close-window',
  'open-url',
  'search-web',
  'cua-check-status',
  'discord-snapshot',
  'discord-read-screenshot',
  'discord-scroll',
  'discord-type-draft'
] as const

export type AssistantActionType = (typeof ASSISTANT_ACTION_TYPES)[number]

export type AssistantActionStatus =
  | 'pending'
  | 'needs_confirmation'
  | 'completed'
  | 'failed'

export interface AssistantActionParams {
  url?: string
  query?: string
  direction?: 'up' | 'down'
  amount?: number
  text?: string
}

export interface AssistantAction {
  id: string
  type: AssistantActionType
  title: string
  description: string
  requiresConfirmation: boolean
  status: AssistantActionStatus
  params?: AssistantActionParams
  resultMessage?: string
}

export interface AssistantCommandRequest {
  command: string
  history?: AssistantMessage[]
}

export interface AssistantCommandResponse {
  ok: boolean
  provider: AssistantProviderInfo
  reply?: AssistantMessage
  error?: string
  actions: AssistantAction[]
  warnings: string[]
}

export interface AssistantActionExecutionRequest {
  actionId: string
  confirmed: boolean
}

export interface AssistantActionExecutionResponse {
  ok: boolean
  message: string
  action?: AssistantAction
  confirmationRequired: boolean
}

export type AssistantEventEmoteId = 'wave' | 'happy-bounce'

export type AssistantEvent =
  | { type: 'runtime-status'; status: AssistantRuntimeStatus }
  | { type: 'play-emote'; emoteId: AssistantEventEmoteId }

export type ShellStateStage =
  | 'runtime-starting'
  | 'assistant-ready'
  | 'runtime-error'

export interface ShellState {
  stage: ShellStateStage
  platform: string
  vrmAssetPath: string
  notes: string[]
  assistant: {
    provider: AssistantProviderInfo
    availableActions: AssistantActionType[]
    warnings: string[]
    runtime: AssistantRuntimeStatus
  }
}
