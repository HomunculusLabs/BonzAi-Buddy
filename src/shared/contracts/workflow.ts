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
