import type {
  AssistantAction,
  AssistantActionType,
  BonziWorkflowRunSnapshot
} from '../../shared/contracts'
import type { BonziRuntimeMemoryService } from './runtime-memory-service'
import type {
  BonziRuntimeTurn,
  BonziRuntimeTurnRunner
} from './runtime-turn-runner'
import type {
  BonziWorkflowManager,
  WorkflowExternalActionState
} from './workflow-manager'
import { isTerminalRunStatus } from './workflow-snapshot-utils'

interface RuntimeWorkflowBridgeOptions {
  workflowManager: BonziWorkflowManager
  memoryService: BonziRuntimeMemoryService
  turnRunner: BonziRuntimeTurnRunner
}

export class BonziRuntimeWorkflowBridge {
  private readonly workflowManager: BonziWorkflowManager
  private readonly memoryService: BonziRuntimeMemoryService
  private readonly turnRunner: BonziRuntimeTurnRunner

  constructor(options: RuntimeWorkflowBridgeOptions) {
    this.workflowManager = options.workflowManager
    this.memoryService = options.memoryService
    this.turnRunner = options.turnRunner
  }

  async recordActionObservation(
    action: {
      type: AssistantActionType
      title: string
      status: string
      params?: unknown
    },
    resultMessage: string
  ): Promise<void> {
    return this.memoryService.recordActionObservation(action, resultMessage)
  }

  linkExternalAction(action: AssistantAction): BonziWorkflowRunSnapshot | null {
    if (!action.workflowRunId || !action.workflowStepId) {
      return null
    }

    return this.workflowManager.linkExternalAction({
      runId: action.workflowRunId,
      stepId: action.workflowStepId,
      actionId: action.id
    })
  }

  markExternalActionRunning(action: AssistantAction): BonziWorkflowRunSnapshot | null {
    if (!action.workflowRunId || !action.workflowStepId) {
      return null
    }

    return this.workflowManager.runExternalAction({
      runId: action.workflowRunId,
      stepId: action.workflowStepId,
      detail: `Running ${action.title}.`
    })
  }

  async recordExternalActionObservation(
    action: AssistantAction,
    resultMessage: string
  ): Promise<{
    workflowRun?: BonziWorkflowRunSnapshot
    shouldConsiderContinuation: boolean
  }> {
    await this.memoryService.recordActionObservation(action, resultMessage)

    if (!action.workflowRunId || !action.workflowStepId) {
      return { shouldConsiderContinuation: false }
    }

    const workflowRun =
      action.status === 'failed'
        ? this.workflowManager.failExternalAction({
            runId: action.workflowRunId,
            stepId: action.workflowStepId,
            detail: resultMessage
          })
        : this.workflowManager.completeExternalAction({
            runId: action.workflowRunId,
            stepId: action.workflowStepId,
            detail: resultMessage
          })

    if (!workflowRun) {
      return { shouldConsiderContinuation: false }
    }

    return {
      workflowRun,
      shouldConsiderContinuation:
        !isTerminalRunStatus(workflowRun.status) &&
        workflowRun.status !== 'cancel_requested'
    }
  }

  async continueWorkflowAfterAction(input: {
    action: AssistantAction
    observation: string
    continuationIndex: number
  }): Promise<BonziRuntimeTurn | null> {
    const runId = input.action.workflowRunId

    if (!runId) {
      return null
    }

    const run = this.workflowManager.getRun(runId)

    if (!run || isTerminalRunStatus(run.status) || run.status === 'cancel_requested') {
      return null
    }

    return this.turnRunner.continueWorkflow({
      runId,
      action: input.action,
      observation: input.observation,
      continuationIndex: input.continuationIndex
    })
  }

  getExternalActionState(runId: string): WorkflowExternalActionState {
    return this.workflowManager.getExternalActionState(runId)
  }

  hasOpenExternalActions(runId: string): boolean {
    return this.workflowManager.hasOpenExternalActions(runId)
  }

  hasAwaitingExternalActions(runId: string): boolean {
    return this.hasOpenExternalActions(runId)
  }

  failWorkflowRun(runId: string, error: string): BonziWorkflowRunSnapshot | null {
    return this.workflowManager.failRun(runId, { error })
  }
}
