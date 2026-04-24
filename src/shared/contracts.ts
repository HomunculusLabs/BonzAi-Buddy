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
  'close-window'
] as const

export type AssistantActionType = (typeof ASSISTANT_ACTION_TYPES)[number]

export type AssistantActionStatus =
  | 'pending'
  | 'needs_confirmation'
  | 'completed'
  | 'failed'

export interface AssistantAction {
  id: string
  type: AssistantActionType
  title: string
  description: string
  requiresConfirmation: boolean
  status: AssistantActionStatus
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
