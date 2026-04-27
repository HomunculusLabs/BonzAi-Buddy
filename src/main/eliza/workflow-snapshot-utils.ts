import type {
  BonziWorkflowCallbackSnapshot,
  BonziWorkflowRunSnapshot,
  BonziWorkflowRunStatus,
  BonziWorkflowStepSnapshot,
  BonziWorkflowStepStatus
} from '../../shared/contracts'
import { isRecord } from '../../shared/value-utils'

export const WORKFLOW_RUN_LIMIT = 100
export const WORKFLOW_RUN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
export const WORKFLOW_CALLBACK_LIMIT = 40
export const WORKFLOW_STEP_LIMIT = 200
export const WORKFLOW_TEXT_LIMIT = 2_000
export const WORKFLOW_COMMAND_LIMIT = 2_000
export const WORKFLOW_STEP_TITLE_LIMIT = 200
export const WORKFLOW_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000
export const WORKFLOW_CONTINUATION_MAX_STEPS_DEFAULT = 6
export const WORKFLOW_CONTINUATION_MAX_RUNTIME_MS_DEFAULT = 120_000
export const WORKFLOW_POST_ACTION_DELAY_MS_DEFAULT = 750

export function normalizePersistedRun(value: unknown): BonziWorkflowRunSnapshot | null {
  if (!isRecord(value)) {
    return null
  }

  if (typeof value.id !== 'string' || !value.id.trim()) {
    return null
  }

  const status = normalizeRunStatus(value.status)
  if (!status) {
    return null
  }

  const startedAt = normalizeIso(value.startedAt) ?? new Date().toISOString()
  const updatedAt = normalizeIso(value.updatedAt) ?? startedAt
  const finishedAt = normalizeIso(value.finishedAt)
  const revision = normalizePositiveInteger(value.revision) ?? 1

  return {
    id: value.id,
    commandMessageId: clampText(stringOrFallback(value.commandMessageId, value.id), 256),
    roomId: clampText(stringOrFallback(value.roomId, 'unknown-room'), 256),
    userCommand: clampText(stringOrFallback(value.userCommand, ''), WORKFLOW_COMMAND_LIMIT),
    status,
    revision,
    startedAt,
    updatedAt,
    ...(finishedAt ? { finishedAt } : {}),
    steps: normalizeSteps(value.steps),
    callbacks: normalizeCallbacks(value.callbacks),
    replyText: clampOptionalText(value.replyText, WORKFLOW_TEXT_LIMIT),
    error: clampOptionalText(value.error, WORKFLOW_TEXT_LIMIT)
  }
}

export function normalizeSteps(value: unknown): BonziWorkflowStepSnapshot[] {
  if (!Array.isArray(value)) {
    return []
  }

  const normalized = value
    .map((entry) => normalizeStep(entry))
    .filter((entry): entry is BonziWorkflowStepSnapshot => Boolean(entry))

  return limitSteps(normalized)
}

export function normalizeStep(value: unknown): BonziWorkflowStepSnapshot | null {
  if (!isRecord(value)) {
    return null
  }

  const status = normalizeStepStatus(value.status)

  if (!status) {
    return null
  }

  const id = typeof value.id === 'string' && value.id.trim() ? value.id : crypto.randomUUID()
  const startedAt = normalizeIso(value.startedAt) ?? new Date().toISOString()
  const updatedAt = normalizeIso(value.updatedAt) ?? startedAt
  const finishedAt = normalizeIso(value.finishedAt)
  const title = clampText(value.title, WORKFLOW_STEP_TITLE_LIMIT)

  if (!title) {
    return null
  }

  return {
    id,
    title,
    status,
    startedAt,
    updatedAt,
    ...(finishedAt ? { finishedAt } : {}),
    detail: clampOptionalText(value.detail, WORKFLOW_TEXT_LIMIT),
    pluginId: clampOptionalText(value.pluginId, 256),
    actionName: clampOptionalText(value.actionName, 256),
    approvalPrompt: clampOptionalText(value.approvalPrompt, WORKFLOW_TEXT_LIMIT),
    approvalRequestedAt: normalizeIso(value.approvalRequestedAt),
    approvalRespondedAt: normalizeIso(value.approvalRespondedAt),
    approvalApproved:
      typeof value.approvalApproved === 'boolean'
        ? value.approvalApproved
        : undefined,
    externalActionId: clampOptionalText(value.externalActionId, 256),
    externalActionType: clampOptionalText(value.externalActionType, 128),
    continuationId: clampOptionalText(value.continuationId, 256),
    continuationIndex: normalizeNonNegativeInteger(value.continuationIndex)
  }
}

export function normalizeCallbacks(value: unknown): BonziWorkflowCallbackSnapshot[] {
  if (!Array.isArray(value)) {
    return []
  }

  const normalized = value
    .map((entry) => normalizeCallback(entry))
    .filter((entry): entry is BonziWorkflowCallbackSnapshot => Boolean(entry))

  return limitCallbacks(normalized)
}

export function normalizeCallback(value: unknown): BonziWorkflowCallbackSnapshot | null {
  if (!isRecord(value)) {
    return null
  }

  const id = typeof value.id === 'string' && value.id.trim() ? value.id : crypto.randomUUID()
  const createdAt = normalizeIso(value.createdAt) ?? new Date().toISOString()
  const text = clampOptionalText(value.text, WORKFLOW_TEXT_LIMIT)
  const actionCount = normalizeActionCount(value.actionCount)

  if (!text && actionCount === 0) {
    return null
  }

  return {
    id,
    createdAt,
    ...(text ? { text } : {}),
    actionCount
  }
}

export function limitSteps(steps: BonziWorkflowStepSnapshot[]): BonziWorkflowStepSnapshot[] {
  const normalized = steps.map((step) => ({
    ...step,
    detail: clampOptionalText(step.detail, WORKFLOW_TEXT_LIMIT),
    title: clampText(step.title, WORKFLOW_STEP_TITLE_LIMIT)
  }))

  if (normalized.length <= WORKFLOW_STEP_LIMIT) {
    return normalized
  }

  return normalized.slice(normalized.length - WORKFLOW_STEP_LIMIT)
}

export function limitCallbacks(
  callbacks: BonziWorkflowCallbackSnapshot[]
): BonziWorkflowCallbackSnapshot[] {
  if (callbacks.length <= WORKFLOW_CALLBACK_LIMIT) {
    return callbacks
  }

  return callbacks.slice(callbacks.length - WORKFLOW_CALLBACK_LIMIT)
}

export function normalizeRunStatus(value: unknown): BonziWorkflowRunStatus | null {
  if (
    value === 'queued' ||
    value === 'running' ||
    value === 'awaiting_user' ||
    value === 'awaiting_external_action' ||
    value === 'cancel_requested' ||
    value === 'cancelled' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'interrupted'
  ) {
    return value
  }

  return null
}

export function normalizeStepStatus(value: unknown): BonziWorkflowStepStatus | null {
  if (
    value === 'pending' ||
    value === 'running' ||
    value === 'awaiting_user' ||
    value === 'awaiting_approval' ||
    value === 'awaiting_external_action' ||
    value === 'cancel_requested' ||
    value === 'cancelled' ||
    value === 'skipped' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'interrupted'
  ) {
    return value
  }

  return null
}

export function normalizeIso(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return undefined
  }

  return parsed.toISOString()
}

export function normalizePositiveInteger(value: unknown): number | undefined {
  const numeric = typeof value === 'number' ? value : Number(value)

  if (!Number.isFinite(numeric) || numeric < 1) {
    return undefined
  }

  return Math.floor(numeric)
}

export function normalizeNonNegativeInteger(value: unknown): number | undefined {
  const numeric = typeof value === 'number' ? value : Number(value)

  if (!Number.isFinite(numeric) || numeric < 0) {
    return undefined
  }

  return Math.floor(numeric)
}

export function normalizeActionCount(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value)

  if (!Number.isFinite(numeric) || numeric < 0) {
    return 0
  }

  return Math.min(500, Math.floor(numeric))
}

export function clampText(value: unknown, maxLength: number): string {
  const text = typeof value === 'string' ? value.trim() : ''

  if (text.length <= maxLength) {
    return text
  }

  return `${text.slice(0, maxLength - 1)}…`
}

export function clampOptionalText(value: unknown, maxLength: number): string | undefined {
  const text = clampText(value, maxLength)
  return text.length > 0 ? text : undefined
}

export function stringOrFallback(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : fallback
}

export function isTerminalRunStatus(status: BonziWorkflowRunStatus): boolean {
  return (
    status === 'cancelled' ||
    status === 'completed' ||
    status === 'failed' ||
    status === 'interrupted'
  )
}

export function isTerminalStepStatus(status: BonziWorkflowStepStatus): boolean {
  return (
    status === 'cancelled' ||
    status === 'skipped' ||
    status === 'completed' ||
    status === 'failed' ||
    status === 'interrupted'
  )
}

export function pendingApprovalKey(runId: string, stepId: string): string {
  return `${runId}:${stepId}`
}

export function cloneRunSnapshot(run: BonziWorkflowRunSnapshot): BonziWorkflowRunSnapshot {
  return {
    ...run,
    steps: run.steps.map((step) => ({ ...step })),
    callbacks: run.callbacks.map((callback) => ({ ...callback }))
  }
}
