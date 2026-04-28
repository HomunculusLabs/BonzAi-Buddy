import type {
  BonziWorkflowRunSnapshot,
  CancelWorkflowRunRequest,
  CancelWorkflowRunResponse,
  RespondWorkflowApprovalRequest,
  RespondWorkflowApprovalResponse
} from '../shared/contracts'
import {
  normalizeCancelWorkflowRequest,
  normalizeWorkflowApprovalRequest
} from './assistant-request-normalization'

interface AssistantWorkflowRuntimeManager {
  respondToWorkflowApproval(input: {
    runId: string
    stepId: string
    approved: boolean
  }): BonziWorkflowRunSnapshot | null
  cancelWorkflowRun(runId: string): BonziWorkflowRunSnapshot | null
}

interface AssistantWorkflowUseCaseOptions {
  runtimeManager: AssistantWorkflowRuntimeManager
}

export class AssistantWorkflowUseCase {
  private readonly runtimeManager: AssistantWorkflowRuntimeManager

  constructor(options: AssistantWorkflowUseCaseOptions) {
    this.runtimeManager = options.runtimeManager
  }

  async respondWorkflowApproval(
    request: RespondWorkflowApprovalRequest
  ): Promise<RespondWorkflowApprovalResponse> {
    const normalized = normalizeWorkflowApprovalRequest(request)

    if (normalized.error) {
      return {
        ok: false,
        message: normalized.error
      }
    }

    const run = this.runtimeManager.respondToWorkflowApproval(normalized)

    if (!run) {
      return {
        ok: false,
        message: 'Workflow run or step could not be found.'
      }
    }

    return {
      ok: true,
      message: normalized.approved
        ? 'Workflow action approved.'
        : 'Workflow action declined.',
      run
    }
  }

  async cancelWorkflowRun(
    request: CancelWorkflowRunRequest
  ): Promise<CancelWorkflowRunResponse> {
    const normalized = normalizeCancelWorkflowRequest(request)

    if (normalized.error) {
      return {
        ok: false,
        message: normalized.error
      }
    }

    const run = this.runtimeManager.cancelWorkflowRun(normalized.runId)

    if (!run) {
      return {
        ok: false,
        message: 'Workflow run could not be found.'
      }
    }

    return {
      ok: true,
      message: 'Workflow cancellation requested.',
      run
    }
  }
}
