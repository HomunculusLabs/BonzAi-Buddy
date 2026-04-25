import { app } from 'electron'
import { AsyncLocalStorage } from 'node:async_hooks'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  BonziWorkflowCallbackSnapshot,
  BonziWorkflowRunSnapshot,
  BonziWorkflowRunStatus,
  BonziWorkflowStepSnapshot,
  BonziWorkflowStepStatus
} from '../../shared/contracts'

const WORKFLOW_RUNS_FILE_NAME = 'bonzi-workflow-runs.json'
const WORKFLOW_RUNS_SCHEMA_VERSION = 1
const WORKFLOW_RUN_LIMIT = 100
const WORKFLOW_RUN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const WORKFLOW_CALLBACK_LIMIT = 40
const WORKFLOW_STEP_LIMIT = 200
const WORKFLOW_TEXT_LIMIT = 2_000
const WORKFLOW_COMMAND_LIMIT = 2_000
const WORKFLOW_STEP_TITLE_LIMIT = 200
const WORKFLOW_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000

interface PersistedWorkflowRunsFile {
  schemaVersion: number
  runs: BonziWorkflowRunSnapshot[]
}

export interface BonziWorkflowManagerOptions {
  persistencePath?: string
  now?: () => Date
}

interface PendingApprovalEntry {
  runId: string
  stepId: string
  resolve: (approved: boolean) => void
  promise: Promise<boolean>
  timeout: ReturnType<typeof setTimeout>
}

interface StartWorkflowStepInput {
  runId?: string
  title: string
  detail?: string
  pluginId?: string
  actionName?: string
}

interface UpdateWorkflowStepInput {
  runId: string
  stepId: string
  detail?: string
}

export class BonziWorkflowManager {
  private readonly persistencePath: string
  private readonly now: () => Date
  private readonly listeners = new Set<(run: BonziWorkflowRunSnapshot) => void>()
  private readonly runsById = new Map<string, BonziWorkflowRunSnapshot>()
  private readonly activeRunStorage = new AsyncLocalStorage<string>()
  private readonly pendingApprovals = new Map<string, PendingApprovalEntry>()
  private approvalsEnabled = true
  private runOrder: string[] = []

  constructor(options: BonziWorkflowManagerOptions = {}) {
    this.persistencePath =
      options.persistencePath ?? join(app.getPath('userData'), WORKFLOW_RUNS_FILE_NAME)
    this.now = options.now ?? (() => new Date())

    const loadedRuns = this.loadPersistedRuns()

    for (const run of loadedRuns) {
      this.runsById.set(run.id, run)
      this.runOrder.push(run.id)
    }

    this.markInterruptedRunsAtStartup()
    this.pruneRuns()
    this.persistRunsSafe()
  }

  createRun(input: {
    commandMessageId: string
    roomId: string
    userCommand: string
  }): BonziWorkflowRunSnapshot {
    const nowIso = this.now().toISOString()
    const run: BonziWorkflowRunSnapshot = {
      id: crypto.randomUUID(),
      commandMessageId: clampText(input.commandMessageId, 256) || crypto.randomUUID(),
      roomId: clampText(input.roomId, 256),
      userCommand: clampText(input.userCommand, WORKFLOW_COMMAND_LIMIT),
      status: 'queued',
      revision: 1,
      startedAt: nowIso,
      updatedAt: nowIso,
      steps: [],
      callbacks: []
    }

    this.upsertRun(run, { emit: true })
    return cloneRunSnapshot(run)
  }

  async runWithActiveRun<T>(
    runId: string,
    task: () => Promise<T>
  ): Promise<T> {
    return this.activeRunStorage.run(runId, async () => {
      this.markRunRunning(runId)
      return task()
    })
  }

  getActiveRunId(): string | null {
    const runId = this.activeRunStorage.getStore()
    return typeof runId === 'string' && runId.trim() ? runId : null
  }

  startStep(input: StartWorkflowStepInput): BonziWorkflowStepSnapshot | null {
    const runId = this.resolveRunId(input.runId)

    if (!runId) {
      return null
    }

    const nowIso = this.now().toISOString()
    const step: BonziWorkflowStepSnapshot = {
      id: crypto.randomUUID(),
      title: clampText(input.title, WORKFLOW_STEP_TITLE_LIMIT) || 'Workflow action',
      status: 'pending',
      startedAt: nowIso,
      updatedAt: nowIso,
      detail: clampOptionalText(input.detail, WORKFLOW_TEXT_LIMIT),
      pluginId: clampOptionalText(input.pluginId, 256),
      actionName: clampOptionalText(input.actionName, 256)
    }

    const updated = this.updateRun(runId, (current) => {
      if (isTerminalRunStatus(current.status)) {
        return current
      }

      return {
        ...current,
        status: current.status === 'queued' ? 'running' : current.status,
        steps: [...current.steps, step]
      }
    })

    return updated?.steps.find((candidate) => candidate.id === step.id) ?? null
  }

  runStep(input: UpdateWorkflowStepInput): BonziWorkflowStepSnapshot | null {
    return this.transitionStep(input, 'running')
  }

  completeStep(input: UpdateWorkflowStepInput): BonziWorkflowStepSnapshot | null {
    return this.transitionStep(input, 'completed')
  }

  failStep(input: UpdateWorkflowStepInput): BonziWorkflowStepSnapshot | null {
    return this.transitionStep(input, 'failed')
  }

  skipStep(input: UpdateWorkflowStepInput): BonziWorkflowStepSnapshot | null {
    return this.transitionStep(input, 'skipped')
  }

  async requestStepApproval(input: {
    runId: string
    stepId: string
    prompt: string
  }): Promise<boolean> {
    const runId = this.resolveRunId(input.runId)
    const stepId = clampText(input.stepId, 256)
    const prompt = clampText(input.prompt, WORKFLOW_TEXT_LIMIT)

    if (!runId || !stepId || !prompt) {
      return false
    }

    const run = this.getRun(runId)

    if (!run || isTerminalRunStatus(run.status)) {
      return false
    }

    const approvalKey = pendingApprovalKey(runId, stepId)

    const existing = this.pendingApprovals.get(approvalKey)
    if (existing) {
      return existing.promise
    }

    if (!this.approvalsEnabled) {
      const step = run.steps.find((candidate) => candidate.id === stepId)
      if (!step || isTerminalStepStatus(step.status)) {
        return false
      }

      const autoApproved = this.autoApproveStep(runId, stepId, prompt)
      return Boolean(autoApproved)
    }

    const updated = this.updateRun(runId, (current) => {
      const step = current.steps.find((candidate) => candidate.id === stepId)

      if (!step || isTerminalStepStatus(step.status)) {
        return current
      }

      const nowIso = this.now().toISOString()

      return {
        ...current,
        status: 'awaiting_user',
        steps: current.steps.map((candidate) => {
          if (candidate.id !== stepId) {
            return candidate
          }

          return {
            ...candidate,
            status: 'awaiting_approval',
            updatedAt: nowIso,
            finishedAt: undefined,
            approvalPrompt: prompt || candidate.approvalPrompt,
            approvalRequestedAt: nowIso,
            approvalRespondedAt: undefined,
            approvalApproved: undefined
          }
        })
      }
    })

    const updatedStep = updated?.steps.find((step) => step.id === stepId)

    if (!updatedStep || updatedStep.status !== 'awaiting_approval') {
      return false
    }

    let resolvePromise!: (approved: boolean) => void
    const timeout = setTimeout(() => {
      this.respondToApproval({ runId, stepId, approved: false })
    }, WORKFLOW_APPROVAL_TIMEOUT_MS)
    timeout.unref?.()

    const promise = new Promise<boolean>((resolve) => {
      resolvePromise = resolve
    }).finally(() => {
      clearTimeout(timeout)
      this.pendingApprovals.delete(approvalKey)
    })

    this.pendingApprovals.set(approvalKey, {
      runId,
      stepId,
      resolve: resolvePromise,
      promise,
      timeout
    })

    return promise
  }

  setApprovalsEnabled(enabled: boolean): void {
    const nextEnabled = enabled === true

    if (this.approvalsEnabled === nextEnabled) {
      return
    }

    this.approvalsEnabled = nextEnabled

    if (!nextEnabled) {
      this.approvePendingApprovals()
    }
  }

  getApprovalsEnabled(): boolean {
    return this.approvalsEnabled
  }

  respondToApproval(input: {
    runId: string
    stepId: string
    approved: boolean
  }): BonziWorkflowRunSnapshot | null {
    const runId = this.resolveRunId(input.runId)
    const stepId = clampText(input.stepId, 256)

    if (!runId || !stepId) {
      return null
    }

    const approvalKey = pendingApprovalKey(runId, stepId)
    const pending = this.pendingApprovals.get(approvalKey)
    const currentRun = this.runsById.get(runId)
    const currentStep = currentRun?.steps.find((candidate) => candidate.id === stepId)

    if (
      !pending ||
      !currentRun ||
      !currentStep ||
      currentStep.status !== 'awaiting_approval' ||
      isTerminalRunStatus(currentRun.status)
    ) {
      return null
    }

    const run = this.updateRun(runId, (current) => {
      const step = current.steps.find((candidate) => candidate.id === stepId)

      if (!step || step.status !== 'awaiting_approval' || isTerminalRunStatus(current.status)) {
        return current
      }

      const nowIso = this.now().toISOString()

      return {
        ...current,
        status: current.status === 'cancel_requested' ? 'cancelled' : 'running',
        steps: current.steps.map((candidate) => {
          if (candidate.id !== stepId) {
            return candidate
          }

          if (input.approved) {
            return {
              ...candidate,
              status: 'running',
              updatedAt: nowIso,
              finishedAt: undefined,
              approvalRespondedAt: nowIso,
              approvalApproved: true
            }
          }

          return {
            ...candidate,
            status: 'skipped',
            updatedAt: nowIso,
            finishedAt: nowIso,
            detail: candidate.detail ?? 'User declined action.',
            approvalRespondedAt: nowIso,
            approvalApproved: false
          }
        })
      }
    })

    this.pendingApprovals.delete(approvalKey)
    clearTimeout(pending.timeout)
    pending.resolve(input.approved)

    return run
  }

  cancelRun(runId: string): BonziWorkflowRunSnapshot | null {
    const normalizedRunId = this.resolveRunId(runId)

    if (!normalizedRunId) {
      return null
    }

    const requested = this.updateRun(normalizedRunId, (current) => {
      if (isTerminalRunStatus(current.status)) {
        return current
      }

      const nowIso = this.now().toISOString()

      return {
        ...current,
        status: 'cancel_requested',
        error: current.error ?? 'Workflow cancellation requested.',
        steps: current.steps.map((step) => {
          if (isTerminalStepStatus(step.status)) {
            return step
          }

          return {
            ...step,
            status: 'cancel_requested',
            updatedAt: nowIso,
            finishedAt: undefined
          }
        })
      }
    })

    if (!requested || isTerminalRunStatus(requested.status)) {
      return requested
    }

    for (const [approvalKey, pending] of this.pendingApprovals.entries()) {
      if (pending.runId !== normalizedRunId) {
        continue
      }

      this.pendingApprovals.delete(approvalKey)
      clearTimeout(pending.timeout)
      pending.resolve(false)
    }

    return this.updateRun(normalizedRunId, (current) => {
      if (isTerminalRunStatus(current.status)) {
        return current
      }

      const nowIso = this.now().toISOString()

      return {
        ...current,
        status: 'cancelled',
        error: current.error ?? 'Workflow cancelled by user.',
        steps: current.steps.map((step) => {
          if (isTerminalStepStatus(step.status)) {
            return step
          }

          return {
            ...step,
            status: 'cancelled',
            updatedAt: nowIso,
            finishedAt: nowIso,
            approvalRespondedAt:
              step.status === 'awaiting_approval'
                ? step.approvalRespondedAt ?? nowIso
                : step.approvalRespondedAt,
            approvalApproved:
              step.status === 'awaiting_approval'
                ? step.approvalApproved ?? false
                : step.approvalApproved
          }
        })
      }
    })
  }

  recordCallback(
    runId: string,
    callback: {
      text?: string
      actionCount?: number
    }
  ): BonziWorkflowRunSnapshot | null {
    return this.updateRun(runId, (current) => {
      const text = clampOptionalText(callback.text, WORKFLOW_TEXT_LIMIT)
      const actionCount = normalizeActionCount(callback.actionCount)

      if (!text && actionCount === 0) {
        return current
      }

      const nextCallbacks: BonziWorkflowCallbackSnapshot[] = [
        ...current.callbacks,
        {
          id: crypto.randomUUID(),
          createdAt: this.now().toISOString(),
          ...(text ? { text } : {}),
          actionCount
        }
      ]

      if (nextCallbacks.length > WORKFLOW_CALLBACK_LIMIT) {
        nextCallbacks.splice(0, nextCallbacks.length - WORKFLOW_CALLBACK_LIMIT)
      }

      return {
        ...current,
        callbacks: nextCallbacks
      }
    })
  }

  completeRun(
    runId: string,
    result: {
      replyText?: string
    } = {}
  ): BonziWorkflowRunSnapshot | null {
    return this.updateRun(runId, (current) => {
      if (current.status === 'cancel_requested' || current.status === 'cancelled') {
        return {
          ...current,
          status: 'cancelled'
        }
      }

      if (isTerminalRunStatus(current.status)) {
        return current
      }

      return {
        ...current,
        status: 'completed',
        ...(result.replyText
          ? { replyText: clampText(result.replyText, WORKFLOW_TEXT_LIMIT) }
          : {}),
        error: undefined
      }
    })
  }

  failRun(
    runId: string,
    failure: {
      error: string
    }
  ): BonziWorkflowRunSnapshot | null {
    return this.updateRun(runId, (current) => {
      if (current.status === 'cancel_requested' || current.status === 'cancelled') {
        return {
          ...current,
          status: 'cancelled',
          error: current.error ?? 'Workflow cancelled by user.'
        }
      }

      if (isTerminalRunStatus(current.status)) {
        return current
      }

      return {
        ...current,
        status: 'failed',
        error: clampText(failure.error, WORKFLOW_TEXT_LIMIT)
      }
    })
  }

  getRuns(): BonziWorkflowRunSnapshot[] {
    this.pruneRuns()
    return this.runOrder
      .map((runId) => this.runsById.get(runId))
      .filter((run): run is BonziWorkflowRunSnapshot => Boolean(run))
      .map((run) => cloneRunSnapshot(run))
  }

  getRun(id: string): BonziWorkflowRunSnapshot | null {
    const run = this.runsById.get(id)
    return run ? cloneRunSnapshot(run) : null
  }

  subscribe(listener: (run: BonziWorkflowRunSnapshot) => void): () => void {
    this.listeners.add(listener)

    return (): void => {
      this.listeners.delete(listener)
    }
  }

  dispose(): void {
    for (const pending of this.pendingApprovals.values()) {
      clearTimeout(pending.timeout)
      pending.resolve(false)
    }

    this.pendingApprovals.clear()
    this.listeners.clear()
  }

  private autoApproveStep(
    runId: string,
    stepId: string,
    prompt: string
  ): BonziWorkflowRunSnapshot | null {
    return this.updateRun(runId, (current) => {
      const step = current.steps.find((candidate) => candidate.id === stepId)

      if (!step || isTerminalStepStatus(step.status) || isTerminalRunStatus(current.status)) {
        return current
      }

      const nowIso = this.now().toISOString()

      return {
        ...current,
        status: current.status === 'queued' || current.status === 'awaiting_user'
          ? 'running'
          : current.status,
        steps: current.steps.map((candidate) => {
          if (candidate.id !== stepId) {
            return candidate
          }

          return {
            ...candidate,
            status: 'running',
            updatedAt: nowIso,
            finishedAt: undefined,
            approvalPrompt: prompt || candidate.approvalPrompt,
            approvalRequestedAt: nowIso,
            approvalRespondedAt: nowIso,
            approvalApproved: true
          }
        })
      }
    })
  }

  private approvePendingApprovals(): void {
    for (const [approvalKey, pending] of Array.from(this.pendingApprovals.entries())) {
      this.autoApproveStep(pending.runId, pending.stepId, '')
      this.pendingApprovals.delete(approvalKey)
      clearTimeout(pending.timeout)
      pending.resolve(true)
    }
  }

  private transitionStep(
    input: UpdateWorkflowStepInput,
    status: BonziWorkflowStepStatus
  ): BonziWorkflowStepSnapshot | null {
    const run = this.updateRun(input.runId, (current) => {
      if (isTerminalRunStatus(current.status)) {
        return current
      }

      const nowIso = this.now().toISOString()

      return {
        ...current,
        status:
          current.status === 'awaiting_user' || current.status === 'queued'
            ? 'running'
            : current.status,
        steps: current.steps.map((step) => {
          if (step.id !== input.stepId || isTerminalStepStatus(step.status)) {
            return step
          }

          return {
            ...step,
            status,
            updatedAt: nowIso,
            finishedAt: isTerminalStepStatus(status) ? nowIso : undefined,
            detail:
              input.detail !== undefined
                ? clampOptionalText(input.detail, WORKFLOW_TEXT_LIMIT)
                : step.detail
          }
        })
      }
    })

    return run?.steps.find((step) => step.id === input.stepId) ?? null
  }

  private resolveRunId(runId: string | undefined): string | null {
    const candidate =
      typeof runId === 'string' && runId.trim()
        ? runId.trim()
        : this.getActiveRunId()

    return candidate && this.runsById.has(candidate) ? candidate : null
  }

  private markRunRunning(runId: string): void {
    this.updateRun(runId, (current) => {
      if (current.status === 'queued' || current.status === 'awaiting_user') {
        return {
          ...current,
          status: 'running'
        }
      }

      return current
    })
  }

  private updateRun(
    runId: string,
    updater: (current: BonziWorkflowRunSnapshot) => BonziWorkflowRunSnapshot
  ): BonziWorkflowRunSnapshot | null {
    const current = this.runsById.get(runId)

    if (!current) {
      return null
    }

    const nowIso = this.now().toISOString()
    const next = updater(cloneRunSnapshot(current))
    const finalized = this.finalizeRunUpdate(current, next, nowIso)
    this.upsertRun(finalized, { emit: true })
    return cloneRunSnapshot(finalized)
  }

  private finalizeRunUpdate(
    previous: BonziWorkflowRunSnapshot,
    next: BonziWorkflowRunSnapshot,
    nowIso: string
  ): BonziWorkflowRunSnapshot {
    const status = next.status
    const shouldFinish = isTerminalRunStatus(status)

    return {
      ...next,
      id: previous.id,
      commandMessageId: previous.commandMessageId,
      roomId: previous.roomId,
      userCommand: previous.userCommand,
      revision: previous.revision + 1,
      startedAt: previous.startedAt,
      updatedAt: nowIso,
      finishedAt: shouldFinish ? next.finishedAt ?? nowIso : undefined,
      callbacks: limitCallbacks(next.callbacks),
      replyText: clampOptionalText(next.replyText, WORKFLOW_TEXT_LIMIT),
      error: clampOptionalText(next.error, WORKFLOW_TEXT_LIMIT),
      steps: limitSteps(next.steps)
    }
  }

  private upsertRun(
    run: BonziWorkflowRunSnapshot,
    options: {
      emit: boolean
    }
  ): void {
    this.runsById.set(run.id, run)
    this.runOrder = [run.id, ...this.runOrder.filter((id) => id !== run.id)]
    this.pruneRuns()
    this.persistRunsSafe()

    if (!options.emit) {
      return
    }

    const snapshot = cloneRunSnapshot(run)
    for (const listener of this.listeners) {
      listener(snapshot)
    }
  }

  private markInterruptedRunsAtStartup(): void {
    const nowIso = this.now().toISOString()

    for (const runId of this.runOrder) {
      const run = this.runsById.get(runId)

      if (
        !run ||
        (run.status !== 'queued' &&
          run.status !== 'running' &&
          run.status !== 'awaiting_user' &&
          run.status !== 'cancel_requested')
      ) {
        continue
      }

      const interrupted: BonziWorkflowRunSnapshot = {
        ...run,
        status: 'interrupted',
        revision: run.revision + 1,
        updatedAt: nowIso,
        finishedAt: nowIso,
        error: run.error ?? 'Run interrupted while Bonzi was restarting.',
        steps: run.steps.map((step) => {
          if (isTerminalStepStatus(step.status)) {
            return step
          }

          return {
            ...step,
            status: 'interrupted',
            updatedAt: nowIso,
            finishedAt: nowIso
          }
        })
      }

      this.runsById.set(runId, interrupted)
    }
  }

  private pruneRuns(): void {
    const cutoff = this.now().getTime() - WORKFLOW_RUN_MAX_AGE_MS
    const nextOrder: string[] = []

    for (const runId of this.runOrder) {
      const run = this.runsById.get(runId)

      if (!run) {
        continue
      }

      if (Date.parse(run.updatedAt) < cutoff) {
        this.runsById.delete(runId)
        continue
      }

      nextOrder.push(runId)

      if (nextOrder.length >= WORKFLOW_RUN_LIMIT) {
        break
      }
    }

    this.runOrder = nextOrder

    for (const runId of Array.from(this.runsById.keys())) {
      if (!this.runOrder.includes(runId)) {
        this.runsById.delete(runId)
      }
    }
  }

  private loadPersistedRuns(): BonziWorkflowRunSnapshot[] {
    if (!existsSync(this.persistencePath)) {
      return []
    }

    try {
      const parsed = JSON.parse(readFileSync(this.persistencePath, 'utf8'))

      if (!isRecord(parsed) || !Array.isArray(parsed.runs)) {
        return []
      }

      const schemaVersion = Number(parsed.schemaVersion)
      if (!Number.isFinite(schemaVersion) || schemaVersion < 1) {
        return []
      }

      const runs = parsed.runs
        .map((entry) => normalizePersistedRun(entry))
        .filter((run): run is BonziWorkflowRunSnapshot => Boolean(run))

      return runs
    } catch (error) {
      console.error('Failed to load workflow runs; starting fresh.', error)
      return []
    }
  }

  private persistRunsSafe(): void {
    try {
      const payload: PersistedWorkflowRunsFile = {
        schemaVersion: WORKFLOW_RUNS_SCHEMA_VERSION,
        runs: this.runOrder
          .map((runId) => this.runsById.get(runId))
          .filter((run): run is BonziWorkflowRunSnapshot => Boolean(run))
      }

      mkdirSync(dirname(this.persistencePath), { recursive: true })
      writeFileSync(this.persistencePath, JSON.stringify(payload, null, 2))
    } catch (error) {
      console.error('Failed to persist workflow runs.', error)
    }
  }
}

function normalizePersistedRun(value: unknown): BonziWorkflowRunSnapshot | null {
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

function normalizeSteps(value: unknown): BonziWorkflowStepSnapshot[] {
  if (!Array.isArray(value)) {
    return []
  }

  const normalized = value
    .map((entry) => normalizeStep(entry))
    .filter((entry): entry is BonziWorkflowStepSnapshot => Boolean(entry))

  return limitSteps(normalized)
}

function normalizeStep(value: unknown): BonziWorkflowStepSnapshot | null {
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
        : undefined
  }
}

function normalizeCallbacks(value: unknown): BonziWorkflowCallbackSnapshot[] {
  if (!Array.isArray(value)) {
    return []
  }

  const normalized = value
    .map((entry) => normalizeCallback(entry))
    .filter((entry): entry is BonziWorkflowCallbackSnapshot => Boolean(entry))

  return limitCallbacks(normalized)
}

function normalizeCallback(value: unknown): BonziWorkflowCallbackSnapshot | null {
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

function limitSteps(steps: BonziWorkflowStepSnapshot[]): BonziWorkflowStepSnapshot[] {
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

function limitCallbacks(
  callbacks: BonziWorkflowCallbackSnapshot[]
): BonziWorkflowCallbackSnapshot[] {
  if (callbacks.length <= WORKFLOW_CALLBACK_LIMIT) {
    return callbacks
  }

  return callbacks.slice(callbacks.length - WORKFLOW_CALLBACK_LIMIT)
}

function normalizeRunStatus(value: unknown): BonziWorkflowRunStatus | null {
  if (
    value === 'queued' ||
    value === 'running' ||
    value === 'awaiting_user' ||
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

function normalizeStepStatus(value: unknown): BonziWorkflowStepStatus | null {
  if (
    value === 'pending' ||
    value === 'running' ||
    value === 'awaiting_user' ||
    value === 'awaiting_approval' ||
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

function normalizeIso(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return undefined
  }

  return parsed.toISOString()
}

function normalizePositiveInteger(value: unknown): number | undefined {
  const numeric = typeof value === 'number' ? value : Number(value)

  if (!Number.isFinite(numeric) || numeric < 1) {
    return undefined
  }

  return Math.floor(numeric)
}

function normalizeActionCount(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value)

  if (!Number.isFinite(numeric) || numeric < 0) {
    return 0
  }

  return Math.min(500, Math.floor(numeric))
}

function clampText(value: unknown, maxLength: number): string {
  const text = typeof value === 'string' ? value.trim() : ''

  if (text.length <= maxLength) {
    return text
  }

  return `${text.slice(0, maxLength - 1)}…`
}

function clampOptionalText(value: unknown, maxLength: number): string | undefined {
  const text = clampText(value, maxLength)
  return text.length > 0 ? text : undefined
}

function stringOrFallback(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : fallback
}

function isTerminalRunStatus(status: BonziWorkflowRunStatus): boolean {
  return (
    status === 'cancelled' ||
    status === 'completed' ||
    status === 'failed' ||
    status === 'interrupted'
  )
}

function isTerminalStepStatus(status: BonziWorkflowStepStatus): boolean {
  return (
    status === 'cancelled' ||
    status === 'skipped' ||
    status === 'completed' ||
    status === 'failed' ||
    status === 'interrupted'
  )
}

function pendingApprovalKey(runId: string, stepId: string): string {
  return `${runId}:${stepId}`
}

function cloneRunSnapshot(run: BonziWorkflowRunSnapshot): BonziWorkflowRunSnapshot {
  return {
    ...run,
    steps: run.steps.map((step) => ({ ...step })),
    callbacks: run.callbacks.map((callback) => ({ ...callback }))
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
