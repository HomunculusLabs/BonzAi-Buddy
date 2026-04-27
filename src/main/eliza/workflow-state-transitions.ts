import type {
  BonziWorkflowRunSnapshot,
  BonziWorkflowStepSnapshot,
  BonziWorkflowStepStatus
} from '../../shared/contracts'
import {
  WORKFLOW_TEXT_LIMIT,
  clampOptionalText,
  clampText,
  isTerminalRunStatus,
  isTerminalStepStatus
} from './workflow-snapshot-utils'

export interface WorkflowTransitionContext {
  nowIso: string
}

export function appendWorkflowStep(
  run: BonziWorkflowRunSnapshot,
  step: BonziWorkflowStepSnapshot
): BonziWorkflowRunSnapshot {
  if (isTerminalRunStatus(run.status)) {
    return run
  }

  return {
    ...run,
    status: run.status === 'queued' ? 'running' : run.status,
    steps: [...run.steps, step]
  }
}

export function markWorkflowRunRunning(
  run: BonziWorkflowRunSnapshot
): BonziWorkflowRunSnapshot {
  if (
    run.status === 'queued' ||
    run.status === 'awaiting_user' ||
    run.status === 'awaiting_external_action'
  ) {
    return {
      ...run,
      status: 'running'
    }
  }

  return run
}

export function transitionWorkflowStep(
  run: BonziWorkflowRunSnapshot,
  input: {
    stepId: string
    status: BonziWorkflowStepStatus
    detail?: string
  },
  context: WorkflowTransitionContext
): BonziWorkflowRunSnapshot {
  if (isTerminalRunStatus(run.status)) {
    return run
  }

  return {
    ...run,
    status:
      run.status === 'awaiting_user' ||
      run.status === 'awaiting_external_action' ||
      run.status === 'queued'
        ? 'running'
        : run.status,
    steps: run.steps.map((step) => {
      if (step.id !== input.stepId || isTerminalStepStatus(step.status)) {
        return step
      }

      return {
        ...step,
        status: input.status,
        updatedAt: context.nowIso,
        finishedAt: isTerminalStepStatus(input.status) ? context.nowIso : undefined,
        detail:
          input.detail !== undefined
            ? clampOptionalText(input.detail, WORKFLOW_TEXT_LIMIT)
            : step.detail
      }
    })
  }
}

export function appendExternalActionWorkflowStep(
  run: BonziWorkflowRunSnapshot,
  step: BonziWorkflowStepSnapshot
): BonziWorkflowRunSnapshot {
  if (isTerminalRunStatus(run.status)) {
    return run
  }

  return {
    ...run,
    status: 'awaiting_external_action',
    steps: [
      ...run.steps,
      {
        ...step,
        status: 'awaiting_external_action',
        finishedAt: undefined
      }
    ]
  }
}

export function linkWorkflowExternalAction(
  run: BonziWorkflowRunSnapshot,
  input: { stepId: string; actionId: string }
): BonziWorkflowRunSnapshot {
  if (isTerminalRunStatus(run.status)) {
    return run
  }

  return {
    ...run,
    steps: run.steps.map((step) =>
      step.id === input.stepId
        ? { ...step, externalActionId: clampText(input.actionId, 256) }
        : step
    )
  }
}

export function startWorkflowExternalAction(
  run: BonziWorkflowRunSnapshot,
  input: { stepId: string; detail?: string },
  context: WorkflowTransitionContext
): BonziWorkflowRunSnapshot {
  return transitionExternalActionStep(run, input, 'running', context)
}

export function completeWorkflowExternalAction(
  run: BonziWorkflowRunSnapshot,
  input: { stepId: string; detail?: string },
  context: WorkflowTransitionContext
): BonziWorkflowRunSnapshot {
  return transitionExternalActionStep(run, input, 'completed', context)
}

export function failWorkflowExternalAction(
  run: BonziWorkflowRunSnapshot,
  input: { stepId: string; detail?: string },
  context: WorkflowTransitionContext
): BonziWorkflowRunSnapshot {
  return transitionExternalActionStep(run, input, 'failed', context)
}

function transitionExternalActionStep(
  run: BonziWorkflowRunSnapshot,
  input: { stepId: string; detail?: string },
  status: Extract<BonziWorkflowStepStatus, 'running' | 'completed' | 'failed'>,
  context: WorkflowTransitionContext
): BonziWorkflowRunSnapshot {
  if (isTerminalRunStatus(run.status)) {
    return run
  }

  let found = false
  const steps = run.steps.map((step) => {
    if (step.id !== input.stepId || isTerminalStepStatus(step.status)) {
      return step
    }

    found = true
    return {
      ...step,
      status,
      updatedAt: context.nowIso,
      finishedAt: isTerminalStepStatus(status) ? context.nowIso : undefined,
      detail:
        input.detail !== undefined
          ? clampOptionalText(input.detail, WORKFLOW_TEXT_LIMIT)
          : step.detail
    }
  })

  if (!found) {
    return run
  }

  const hasAwaitingExternalAction = steps.some(
    (step) =>
      Boolean(step.externalActionType) && step.status === 'awaiting_external_action'
  )

  return {
    ...run,
    status: hasAwaitingExternalAction ? 'awaiting_external_action' : 'running',
    steps
  }
}

export function requestWorkflowStepApproval(
  run: BonziWorkflowRunSnapshot,
  input: {
    stepId: string
    prompt: string
  },
  context: WorkflowTransitionContext
): BonziWorkflowRunSnapshot {
  if (isTerminalRunStatus(run.status)) {
    return run
  }

  const step = run.steps.find((candidate) => candidate.id === input.stepId)

  if (!step || isTerminalStepStatus(step.status)) {
    return run
  }

  return {
    ...run,
    status: 'awaiting_user',
    steps: run.steps.map((candidate) => {
      if (candidate.id !== input.stepId) {
        return candidate
      }

      return {
        ...candidate,
        status: 'awaiting_approval',
        updatedAt: context.nowIso,
        finishedAt: undefined,
        approvalPrompt: input.prompt || candidate.approvalPrompt,
        approvalRequestedAt: context.nowIso,
        approvalRespondedAt: undefined,
        approvalApproved: undefined
      }
    })
  }
}

export function autoApproveWorkflowStep(
  run: BonziWorkflowRunSnapshot,
  input: {
    stepId: string
    prompt: string
  },
  context: WorkflowTransitionContext
): BonziWorkflowRunSnapshot {
  const step = run.steps.find((candidate) => candidate.id === input.stepId)

  if (!step || isTerminalStepStatus(step.status) || isTerminalRunStatus(run.status)) {
    return run
  }

  return {
    ...run,
    status:
      run.status === 'queued' || run.status === 'awaiting_user'
        ? 'running'
        : run.status,
    steps: run.steps.map((candidate) => {
      if (candidate.id !== input.stepId) {
        return candidate
      }

      return {
        ...candidate,
        status: 'running',
        updatedAt: context.nowIso,
        finishedAt: undefined,
        approvalPrompt: input.prompt || candidate.approvalPrompt,
        approvalRequestedAt: context.nowIso,
        approvalRespondedAt: context.nowIso,
        approvalApproved: true
      }
    })
  }
}

export function respondToWorkflowStepApproval(
  run: BonziWorkflowRunSnapshot,
  input: {
    stepId: string
    approved: boolean
  },
  context: WorkflowTransitionContext
): BonziWorkflowRunSnapshot {
  const step = run.steps.find((candidate) => candidate.id === input.stepId)

  if (!step || step.status !== 'awaiting_approval' || isTerminalRunStatus(run.status)) {
    return run
  }

  return {
    ...run,
    status: run.status === 'cancel_requested' ? 'cancelled' : 'running',
    steps: run.steps.map((candidate) => {
      if (candidate.id !== input.stepId) {
        return candidate
      }

      if (input.approved) {
        return {
          ...candidate,
          status: 'running',
          updatedAt: context.nowIso,
          finishedAt: undefined,
          approvalRespondedAt: context.nowIso,
          approvalApproved: true
        }
      }

      return {
        ...candidate,
        status: 'skipped',
        updatedAt: context.nowIso,
        finishedAt: context.nowIso,
        detail: candidate.detail ?? 'User declined action.',
        approvalRespondedAt: context.nowIso,
        approvalApproved: false
      }
    })
  }
}

export function requestWorkflowRunCancellation(
  run: BonziWorkflowRunSnapshot,
  context: WorkflowTransitionContext
): BonziWorkflowRunSnapshot {
  if (isTerminalRunStatus(run.status)) {
    return run
  }

  return {
    ...run,
    status: 'cancel_requested',
    error: run.error ?? 'Workflow cancellation requested.',
    steps: run.steps.map((step) => {
      if (isTerminalStepStatus(step.status)) {
        return step
      }

      return {
        ...step,
        status: 'cancel_requested',
        updatedAt: context.nowIso,
        finishedAt: undefined
      }
    })
  }
}

export function cancelWorkflowRun(
  run: BonziWorkflowRunSnapshot,
  context: WorkflowTransitionContext
): BonziWorkflowRunSnapshot {
  if (isTerminalRunStatus(run.status)) {
    return run
  }

  return {
    ...run,
    status: 'cancelled',
    error: run.error ?? 'Workflow cancelled by user.',
    steps: run.steps.map((step) => {
      if (isTerminalStepStatus(step.status)) {
        return step
      }

      return {
        ...step,
        status: 'cancelled',
        updatedAt: context.nowIso,
        finishedAt: context.nowIso,
        approvalRespondedAt:
          step.status === 'awaiting_approval'
            ? step.approvalRespondedAt ?? context.nowIso
            : step.approvalRespondedAt,
        approvalApproved:
          step.status === 'awaiting_approval'
            ? step.approvalApproved ?? false
            : step.approvalApproved
      }
    })
  }
}

export function completeWorkflowRun(
  run: BonziWorkflowRunSnapshot,
  result: {
    replyText?: string
  } = {}
): BonziWorkflowRunSnapshot {
  if (run.status === 'cancel_requested' || run.status === 'cancelled') {
    return {
      ...run,
      status: 'cancelled'
    }
  }

  if (isTerminalRunStatus(run.status)) {
    return run
  }

  return {
    ...run,
    status: 'completed',
    ...(result.replyText
      ? { replyText: clampText(result.replyText, WORKFLOW_TEXT_LIMIT) }
      : {}),
    error: undefined
  }
}

export function failWorkflowRun(
  run: BonziWorkflowRunSnapshot,
  failure: {
    error: string
  }
): BonziWorkflowRunSnapshot {
  if (run.status === 'cancel_requested' || run.status === 'cancelled') {
    return {
      ...run,
      status: 'cancelled',
      error: run.error ?? 'Workflow cancelled by user.'
    }
  }

  if (isTerminalRunStatus(run.status)) {
    return run
  }

  return {
    ...run,
    status: 'failed',
    error: clampText(failure.error, WORKFLOW_TEXT_LIMIT)
  }
}
