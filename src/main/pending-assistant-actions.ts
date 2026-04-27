import type { BrowserWindow } from 'electron'
import type {
  AssistantAction,
  AssistantActionExecutionResponse,
  RuntimeApprovalSettings,
  ShellState
} from '../shared/contracts'
import { normalizeError } from '../shared/value-utils'
import { executeAssistantAction } from './assistant-action-executor'
import { createPendingAssistantAction } from './assistant-action-presentation'
import type { DiscordBrowserActionService } from './discord-browser-service'
import type { BonziProposedAction } from './eliza/runtime-manager'

interface PendingAssistantActionsOptions {
  getShellState: () => ShellState
  getCompanionWindow: () => BrowserWindow | null
  getApprovalSettings: () => RuntimeApprovalSettings
  discordBrowserService: DiscordBrowserActionService
  recordActionObservation: (
    action: AssistantAction,
    message: string
  ) => Promise<void>
}

export class PendingAssistantActions {
  private readonly pendingActions = new Map<string, AssistantAction>()

  constructor(private readonly options: PendingAssistantActionsOptions) {}

  clear(): void {
    this.pendingActions.clear()
  }

  async createActionsForRuntimeTurn(
    proposals: BonziProposedAction[]
  ): Promise<AssistantAction[]> {
    const approvalSettings = this.options.getApprovalSettings()
    const actions: AssistantAction[] = []

    for (const proposal of proposals) {
      const pendingAction = createPendingAssistantAction(proposal, approvalSettings)
      this.pendingActions.set(pendingAction.id, pendingAction)

      if (approvalSettings.approvalsEnabled) {
        actions.push(pendingAction)
        continue
      }

      const executedAction = await this.executePendingAction(pendingAction)
      this.pendingActions.set(executedAction.id, executedAction)
      actions.push(executedAction)
    }

    return actions
  }

  async execute(request: {
    actionId: string
    confirmed: boolean
  }): Promise<AssistantActionExecutionResponse> {
    const action = this.pendingActions.get(request.actionId)

    if (!action) {
      return {
        ok: false,
        message: 'That assistant action is no longer available.',
        confirmationRequired: false
      }
    }

    if (action.status === 'completed') {
      return {
        ok: true,
        action,
        message: action.resultMessage ?? 'Action already completed.',
        confirmationRequired: false
      }
    }

    const approvalsEnabled = this.options.getApprovalSettings().approvalsEnabled

    if (approvalsEnabled && action.requiresConfirmation && !request.confirmed) {
      const awaitingConfirmation: AssistantAction = {
        ...action,
        status: 'needs_confirmation'
      }

      this.pendingActions.set(awaitingConfirmation.id, awaitingConfirmation)

      return {
        ok: false,
        action: awaitingConfirmation,
        message: 'Confirmation required. Run the action again to approve it.',
        confirmationRequired: true
      }
    }

    const executedAction = await this.executePendingAction(action)
    this.pendingActions.set(executedAction.id, executedAction)

    return {
      ok: executedAction.status === 'completed',
      action: executedAction,
      message: executedAction.resultMessage ?? 'Action finished.',
      confirmationRequired: false
    }
  }

  private async executePendingAction(action: AssistantAction): Promise<AssistantAction> {
    try {
      const message = await executeAssistantAction(action, {
        shellState: this.options.getShellState(),
        companionWindow: this.options.getCompanionWindow(),
        discordBrowserService: this.options.discordBrowserService
      })

      const completedAction: AssistantAction = {
        ...action,
        status: 'completed',
        resultMessage: message
      }

      await this.options.recordActionObservation(completedAction, message)
      return completedAction
    } catch (error) {
      const failedAction: AssistantAction = {
        ...action,
        status: 'failed',
        resultMessage: normalizeError(error)
      }

      await this.options.recordActionObservation(
        failedAction,
        failedAction.resultMessage ?? 'Action failed.'
      )
      return failedAction
    }
  }
}
