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

export interface RuntimeApprovalSettings {
  approvalsEnabled: boolean
}

export interface UpdateRuntimeApprovalSettingsRequest {
  approvalsEnabled: boolean
  confirmedDisable?: boolean
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

export type BonziWorkflowRunStatus =
  | 'queued'
  | 'running'
  | 'awaiting_user'
  | 'cancel_requested'
  | 'cancelled'
  | 'completed'
  | 'failed'
  | 'interrupted'

export type BonziWorkflowStepStatus =
  | 'pending'
  | 'running'
  | 'awaiting_user'
  | 'awaiting_approval'
  | 'cancel_requested'
  | 'cancelled'
  | 'skipped'
  | 'completed'
  | 'failed'
  | 'interrupted'

export interface BonziWorkflowStepSnapshot {
  id: string
  title: string
  status: BonziWorkflowStepStatus
  startedAt: string
  updatedAt: string
  finishedAt?: string
  detail?: string
  pluginId?: string
  actionName?: string
  approvalPrompt?: string
  approvalRequestedAt?: string
  approvalRespondedAt?: string
  approvalApproved?: boolean
}

export interface BonziWorkflowCallbackSnapshot {
  id: string
  createdAt: string
  text?: string
  actionCount: number
}

export interface BonziWorkflowRunSnapshot {
  id: string
  commandMessageId: string
  roomId: string
  userCommand: string
  status: BonziWorkflowRunStatus
  revision: number
  startedAt: string
  updatedAt: string
  finishedAt?: string
  steps: BonziWorkflowStepSnapshot[]
  callbacks: BonziWorkflowCallbackSnapshot[]
  replyText?: string
  error?: string
}

export interface AssistantCommandResponse {
  ok: boolean
  provider: AssistantProviderInfo
  reply?: AssistantMessage
  error?: string
  actions: AssistantAction[]
  warnings: string[]
  workflowRun?: BonziWorkflowRunSnapshot
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

export interface RespondWorkflowApprovalRequest {
  runId: string
  stepId: string
  approved: boolean
}

export interface RespondWorkflowApprovalResponse {
  ok: boolean
  message: string
  run?: BonziWorkflowRunSnapshot
}

export interface CancelWorkflowRunRequest {
  runId: string
}

export interface CancelWorkflowRunResponse {
  ok: boolean
  message: string
  run?: BonziWorkflowRunSnapshot
}

export type AssistantEventEmoteId = 'wave' | 'happy-bounce'

export type AssistantEvent =
  | { type: 'runtime-status'; status: AssistantRuntimeStatus }
  | { type: 'play-emote'; emoteId: AssistantEventEmoteId }
  | { type: 'workflow-run-updated'; run: BonziWorkflowRunSnapshot }

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
    approvals: RuntimeApprovalSettings
  }
}
