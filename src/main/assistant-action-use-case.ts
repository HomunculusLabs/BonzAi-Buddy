import type {
  AssistantActionExecutionRequest,
  AssistantActionExecutionResponse
} from '../shared/contracts'
import { normalizeActionExecutionRequest } from './assistant-request-normalization'
import type { PendingAssistantActions } from './pending-assistant-actions'

interface AssistantActionUseCaseOptions {
  pendingActions: PendingAssistantActions
}

export class AssistantActionUseCase {
  private readonly pendingActions: PendingAssistantActions

  constructor(options: AssistantActionUseCaseOptions) {
    this.pendingActions = options.pendingActions
  }

  async executeAction(
    request: AssistantActionExecutionRequest
  ): Promise<AssistantActionExecutionResponse> {
    const normalizedRequest = normalizeActionExecutionRequest(request)

    if (normalizedRequest.error) {
      return {
        ok: false,
        message: normalizedRequest.error,
        confirmationRequired: false
      }
    }

    return this.pendingActions.execute(normalizedRequest)
  }
}
