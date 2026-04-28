import type { BonziWorkflowRunSnapshot } from './workflow'

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
  'close-window',
  'open-url',
  'search-web',
  'cua-check-status',
  'discord-snapshot',
  'discord-read-context',
  'discord-read-screenshot',
  'discord-scroll',
  'discord-type-draft',
  'workspace-list-files',
  'workspace-read-file',
  'workspace-write-file'
] as const

export type AssistantActionType = (typeof ASSISTANT_ACTION_TYPES)[number]

export type AssistantActionStatus =
  | 'pending'
  | 'needs_confirmation'
  | 'running'
  | 'completed'
  | 'failed'

export interface AssistantActionParams {
  url?: string
  query?: string
  direction?: 'up' | 'down'
  amount?: number
  text?: string
  filePath?: string
  content?: string
}

export interface AssistantAction {
  id: string
  type: AssistantActionType
  title: string
  description: string
  requiresConfirmation: boolean
  status: AssistantActionStatus
  params?: AssistantActionParams
  workflowRunId?: string
  workflowStepId?: string
  commandMessageId?: string
  continuationId?: string
  continuationIndex?: number
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
  continuationScheduled?: boolean
  workflowRun?: BonziWorkflowRunSnapshot
}

export type AssistantEventEmoteId = 'wave' | 'happy-bounce'

export interface AssistantTurnEventPayload {
  message: AssistantMessage
  actions: AssistantAction[]
  warnings: string[]
  workflowRun?: BonziWorkflowRunSnapshot
  parentActionId?: string
}

export type AssistantEvent =
  | { type: 'runtime-status'; status: AssistantRuntimeStatus }
  | { type: 'play-emote'; emoteId: AssistantEventEmoteId }
  | { type: 'workflow-run-updated'; run: BonziWorkflowRunSnapshot }
  | { type: 'assistant-action-updated'; action: AssistantAction }
  | { type: 'assistant-turn-created'; turn: AssistantTurnEventPayload }
