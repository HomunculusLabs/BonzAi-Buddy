import type {
  AssistantAction,
  AssistantMessage,
  BonziWorkflowRunSnapshot
} from '../shared/contracts'
import { normalizeError } from '../shared/value-utils'
import type { BonziRuntimeManager } from './eliza/runtime-manager'
import type { PendingAssistantActions } from './pending-assistant-actions'

type ContinuationTimer = ReturnType<typeof setTimeout>
type ContinuationPhase = 'idle' | 'scheduled' | 'running'

interface RunContinuationState {
  startedAtMs: number
  continuationCount: number
  phase: ContinuationPhase
  scheduledTimer?: ContinuationTimer
  lastAction?: AssistantAction
  lastObservation?: string
  rescheduleRequested: boolean
}

type ContinuationScheduleOutcome =
  | 'scheduled'
  | 'already_pending'
  | 'blocked_by_external_action'
  | 'stopped_by_guard'

interface ContinuationScheduleResult {
  outcome: ContinuationScheduleOutcome
  continuationScheduled: boolean
  workflowRun?: BonziWorkflowRunSnapshot
}

interface WorkflowContinuationCoordinatorOptions {
  runtimeManager: BonziRuntimeManager
  pendingActions: PendingAssistantActions
  createAssistantMessage: (
    role: AssistantMessage['role'],
    content: string
  ) => AssistantMessage
}

export class BonziWorkflowContinuationCoordinator {
  private readonly runtimeManager: BonziRuntimeManager
  private readonly pendingActions: PendingAssistantActions
  private readonly createAssistantMessage: WorkflowContinuationCoordinatorOptions['createAssistantMessage']
  private readonly statesByRunId = new Map<string, RunContinuationState>()

  constructor(options: WorkflowContinuationCoordinatorOptions) {
    this.runtimeManager = options.runtimeManager
    this.pendingActions = options.pendingActions
    this.createAssistantMessage = options.createAssistantMessage
  }

  async handleActionExecutionFinished(input: {
    action: AssistantAction
    resultMessage: string
  }): Promise<{
    continuationScheduled: boolean
    workflowRun?: BonziWorkflowRunSnapshot
  }> {
    const observation = await this.runtimeManager.recordExternalActionObservation(
      input.action,
      input.resultMessage
    )
    const runId = input.action.workflowRunId

    if (!runId || !observation.shouldConsiderContinuation) {
      return {
        continuationScheduled: false,
        workflowRun: observation.workflowRun
      }
    }

    const state = this.getOrCreateState(runId)
    state.lastAction = input.action
    state.lastObservation = input.resultMessage

    const scheduled = this.requestContinuation(runId, state)

    return {
      continuationScheduled: scheduled.continuationScheduled,
      workflowRun: scheduled.workflowRun ?? observation.workflowRun
    }
  }

  dispose(): void {
    for (const state of this.statesByRunId.values()) {
      this.clearScheduledTimer(state)
    }

    this.statesByRunId.clear()
  }

  private getOrCreateState(runId: string): RunContinuationState {
    const existing = this.statesByRunId.get(runId)

    if (existing) {
      return existing
    }

    const state: RunContinuationState = {
      startedAtMs: Date.now(),
      continuationCount: 0,
      phase: 'idle',
      rescheduleRequested: false
    }
    this.statesByRunId.set(runId, state)
    return state
  }

  private requestContinuation(
    runId: string,
    state: RunContinuationState
  ): ContinuationScheduleResult {
    if (this.runtimeManager.hasOpenExternalActions(runId)) {
      return {
        outcome: 'blocked_by_external_action',
        continuationScheduled: false
      }
    }

    return this.scheduleContinuation(runId, state)
  }

  private scheduleContinuation(
    runId: string,
    state: RunContinuationState
  ): ContinuationScheduleResult {
    if (state.phase === 'running' || state.phase === 'scheduled') {
      state.rescheduleRequested = true
      return {
        outcome: 'already_pending',
        continuationScheduled: true
      }
    }

    const guardRun = this.checkGuards(runId, state)

    if (guardRun) {
      return {
        outcome: 'stopped_by_guard',
        continuationScheduled: false,
        workflowRun: guardRun
      }
    }

    const delayMs = this.runtimeManager.getRuntimeApprovalSettings().continuation.postActionDelayMs
    state.phase = 'scheduled'
    state.scheduledTimer = setTimeout(() => {
      state.scheduledTimer = undefined
      void this.runContinuation(runId, state)
    }, delayMs)

    return {
      outcome: 'scheduled',
      continuationScheduled: true
    }
  }

  private checkGuards(
    runId: string,
    state: RunContinuationState
  ): BonziWorkflowRunSnapshot | null {
    const settings = this.runtimeManager.getRuntimeApprovalSettings().continuation
    const elapsedMs = Date.now() - state.startedAtMs

    if (state.continuationCount >= settings.maxSteps) {
      const run = this.runtimeManager.failWorkflowRun(
        runId,
        'Workflow stopped after reaching continuation limit.'
      )
      this.statesByRunId.delete(runId)
      return run
    }

    if (elapsedMs >= settings.maxRuntimeMs) {
      const run = this.runtimeManager.failWorkflowRun(
        runId,
        'Workflow stopped after reaching runtime limit.'
      )
      this.statesByRunId.delete(runId)
      return run
    }

    return null
  }

  private async runContinuation(
    runId: string,
    state: RunContinuationState
  ): Promise<void> {
    state.phase = 'idle'
    const action = state.lastAction
    const observation = state.lastObservation

    if (!action || observation === undefined) {
      this.statesByRunId.delete(runId)
      return
    }

    if (this.runtimeManager.hasOpenExternalActions(runId)) {
      return
    }

    const run = this.runtimeManager.getWorkflowRun(runId)

    if (!run || isTerminalWorkflowRunStatus(run.status) || run.status === 'cancel_requested') {
      this.statesByRunId.delete(runId)
      return
    }

    state.phase = 'running'
    state.rescheduleRequested = false
    state.continuationCount += 1

    try {
      const turn = await this.runtimeManager.continueWorkflowAfterAction({
        action,
        observation,
        continuationIndex: state.continuationCount
      })

      if (!turn) {
        this.statesByRunId.delete(runId)
        return
      }

      const actions = await this.pendingActions.createActionsForRuntimeTurn(turn.actions)
      const workflowRun = turn.workflowRun?.id
        ? this.runtimeManager.getWorkflowRun(turn.workflowRun.id) ?? turn.workflowRun
        : undefined

      this.runtimeManager.emitAssistantTurnCreated({
        message: this.createAssistantMessage('assistant', turn.reply),
        actions,
        warnings: turn.warnings,
        workflowRun,
        parentActionId: action.id
      })

      if (actions.length === 0 || workflowRun?.status === 'completed') {
        this.statesByRunId.delete(runId)
      }
    } catch (error) {
      this.runtimeManager.failWorkflowRun(runId, normalizeError(error))
      this.statesByRunId.delete(runId)
    } finally {
      const latestState = this.statesByRunId.get(runId)

      if (!latestState) {
        return
      }

      latestState.phase = 'idle'

      if (latestState.rescheduleRequested) {
        latestState.rescheduleRequested = false
        this.requestContinuation(runId, latestState)
      }
    }
  }

  private clearScheduledTimer(state: RunContinuationState): void {
    if (!state.scheduledTimer) {
      return
    }

    clearTimeout(state.scheduledTimer)
    state.scheduledTimer = undefined
    state.phase = 'idle'
  }
}

function isTerminalWorkflowRunStatus(status: BonziWorkflowRunSnapshot['status']): boolean {
  return (
    status === 'cancelled' ||
    status === 'completed' ||
    status === 'failed' ||
    status === 'interrupted'
  )
}
