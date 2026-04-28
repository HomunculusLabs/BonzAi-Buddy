import type {
  AssistantCommandRequest,
  AssistantCommandResponse,
  AssistantMessage,
  AssistantProviderInfo,
  BonziWorkflowRunSnapshot
} from '../shared/contracts'
import { normalizeError } from '../shared/value-utils'
import { normalizeCommandRequest } from './assistant-request-normalization'
import type { BonziRuntimeTurn } from './eliza/runtime-manager'
import type { PendingAssistantActions } from './pending-assistant-actions'

interface AssistantCommandRuntimeManager {
  getProviderInfo(): AssistantProviderInfo
  getStartupWarnings(): string[]
  sendCommand(command: string): Promise<BonziRuntimeTurn>
  getWorkflowRun(id: string): BonziWorkflowRunSnapshot | null
}

interface AssistantCommandUseCaseOptions {
  runtimeManager: AssistantCommandRuntimeManager
  pendingActions: PendingAssistantActions
  createAssistantMessage: (
    role: AssistantMessage['role'],
    content: string
  ) => AssistantMessage
}

export class AssistantCommandUseCase {
  private readonly runtimeManager: AssistantCommandRuntimeManager
  private readonly pendingActions: PendingAssistantActions
  private readonly createAssistantMessage: AssistantCommandUseCaseOptions['createAssistantMessage']

  constructor(options: AssistantCommandUseCaseOptions) {
    this.runtimeManager = options.runtimeManager
    this.pendingActions = options.pendingActions
    this.createAssistantMessage = options.createAssistantMessage
  }

  async sendCommand(
    request: AssistantCommandRequest
  ): Promise<AssistantCommandResponse> {
    const normalizedRequest = normalizeCommandRequest(request)
    const provider = this.runtimeManager.getProviderInfo()
    const startupWarnings = this.runtimeManager.getStartupWarnings()

    if (normalizedRequest.error) {
      return {
        ok: false,
        provider,
        error: normalizedRequest.error,
        actions: [],
        warnings: startupWarnings
      }
    }

    try {
      const runtimeTurn = await this.runtimeManager.sendCommand(normalizedRequest.command)
      const actions = await this.pendingActions.createActionsForRuntimeTurn(
        runtimeTurn.actions
      )

      const latestWorkflowRun = runtimeTurn.workflowRun?.id
        ? this.runtimeManager.getWorkflowRun(runtimeTurn.workflowRun.id) ?? runtimeTurn.workflowRun
        : undefined

      return {
        ok: true,
        provider: this.runtimeManager.getProviderInfo(),
        reply: this.createAssistantMessage('assistant', runtimeTurn.reply),
        actions,
        warnings: [...this.runtimeManager.getStartupWarnings(), ...runtimeTurn.warnings],
        workflowRun: latestWorkflowRun
      }
    } catch (error) {
      return {
        ok: false,
        provider: this.runtimeManager.getProviderInfo(),
        error: normalizeError(error),
        actions: [],
        warnings: this.runtimeManager.getStartupWarnings()
      }
    }
  }
}
