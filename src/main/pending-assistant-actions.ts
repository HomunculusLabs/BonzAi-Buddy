import type { BrowserWindow } from 'electron'
import type {
  AssistantAction,
  AssistantActionExecutionResponse,
  AssistantActionStatus,
  BonziWorkflowRunSnapshot,
  RuntimeApprovalSettings,
  ShellState
} from '../shared/contracts'
import { normalizeError } from '../shared/value-utils'
import { executeAssistantAction } from './assistant-action-executor'
import { createPendingAssistantAction } from './assistant-action-presentation'
import type { DiscordBrowserActionService } from './discord-browser-service'
import type { BonziWorkspaceFileService } from './bonzi-workspace-file-service'
import type { BonziProposedAction } from './eliza/runtime-manager'
import type { HermesSecondaryRuntimeService } from './hermes/hermes-secondary-runtime-service'

interface PendingAssistantActionsOptions {
  getShellState: () => ShellState
  getCompanionWindow: () => BrowserWindow | null
  getApprovalSettings: () => RuntimeApprovalSettings
  discordBrowserService: DiscordBrowserActionService
  workspaceFileService: BonziWorkspaceFileService
  hermesService?: Pick<HermesSecondaryRuntimeService, 'runConsultation' | 'inspectCronJobs'>
  linkExternalAction: (action: AssistantAction) => void
  markExternalActionRunning: (action: AssistantAction) => void
  onActionUpdated: (action: AssistantAction) => void
  onActionExecutionFinished: (input: {
    action: AssistantAction
    resultMessage: string
  }) => Promise<PendingActionContinuationResult>
}

interface PendingActionContinuationResult {
  continuationScheduled: boolean
  workflowRun?: BonziWorkflowRunSnapshot
}

interface PendingActionExecutionResult extends PendingActionContinuationResult {
  action: AssistantAction
}

interface PendingActionExecutionEnvironment {
  getShellState: () => ShellState
  getCompanionWindow: () => BrowserWindow | null
  discordBrowserService: DiscordBrowserActionService
  workspaceFileService: BonziWorkspaceFileService
  hermesService?: Pick<HermesSecondaryRuntimeService, 'runConsultation' | 'inspectCronJobs'>
}

interface PendingActionWorkflowHooks {
  markExternalActionRunning: (action: AssistantAction) => void
  onActionUpdated: (action: AssistantAction) => void
  onActionExecutionFinished: (input: {
    action: AssistantAction
    resultMessage: string
  }) => Promise<PendingActionContinuationResult>
}

class PendingAssistantActionStore {
  private readonly pendingActions = new Map<string, AssistantAction>()
  private executionGeneration = 0

  get currentGeneration(): number {
    return this.executionGeneration
  }

  clear(): void {
    this.executionGeneration += 1
    this.pendingActions.clear()
  }

  get(actionId: string): AssistantAction | undefined {
    return this.pendingActions.get(actionId)
  }

  save(action: AssistantAction): AssistantAction {
    this.pendingActions.set(action.id, action)
    return action
  }

  isCurrentGeneration(generation: number): boolean {
    return generation === this.executionGeneration
  }
}

class PendingAssistantActionRunner {
  constructor(
    private readonly store: PendingAssistantActionStore,
    private readonly environment: PendingActionExecutionEnvironment,
    private readonly hooks: PendingActionWorkflowHooks
  ) {}

  async execute(
    action: AssistantAction,
    generation: number
  ): Promise<PendingActionExecutionResult> {
    const runningAction = this.transition(action, 'running')
    this.hooks.markExternalActionRunning(runningAction)
    this.hooks.onActionUpdated(runningAction)

    try {
      const message = await executeAssistantAction(runningAction, {
        shellState: this.environment.getShellState(),
        companionWindow: this.environment.getCompanionWindow(),
        discordBrowserService: this.environment.discordBrowserService,
        workspaceFileService: this.environment.workspaceFileService,
        hermesService: this.environment.hermesService
      })

      return this.finish({
        action: runningAction,
        generation,
        status: 'completed',
        resultMessage: message
      })
    } catch (error) {
      const resultMessage = normalizeError(error)
      return this.finish({
        action: runningAction,
        generation,
        status: 'failed',
        resultMessage
      })
    }
  }

  private transition(
    action: AssistantAction,
    status: AssistantActionStatus,
    resultMessage?: string
  ): AssistantAction {
    const nextAction: AssistantAction = {
      ...action,
      status,
      ...(resultMessage ? { resultMessage } : {})
    }

    this.store.save(nextAction)
    return nextAction
  }

  private async finish(input: {
    action: AssistantAction
    generation: number
    status: Extract<AssistantActionStatus, 'completed' | 'failed'>
    resultMessage: string
  }): Promise<PendingActionExecutionResult> {
    const finishedAction: AssistantAction = {
      ...input.action,
      status: input.status,
      resultMessage: input.resultMessage
    }

    if (!this.store.isCurrentGeneration(input.generation)) {
      return {
        action: finishedAction,
        continuationScheduled: false
      }
    }

    this.store.save(finishedAction)
    const continuation = await this.hooks.onActionExecutionFinished({
      action: finishedAction,
      resultMessage: input.resultMessage
    })
    this.hooks.onActionUpdated(finishedAction)

    return {
      action: finishedAction,
      continuationScheduled: continuation.continuationScheduled,
      workflowRun: continuation.workflowRun
    }
  }
}

export class PendingAssistantActions {
  private readonly store = new PendingAssistantActionStore()
  private readonly runner: PendingAssistantActionRunner

  constructor(private readonly options: PendingAssistantActionsOptions) {
    this.runner = new PendingAssistantActionRunner(
      this.store,
      {
        getShellState: options.getShellState,
        getCompanionWindow: options.getCompanionWindow,
        discordBrowserService: options.discordBrowserService,
        workspaceFileService: options.workspaceFileService,
        hermesService: options.hermesService
      },
      {
        markExternalActionRunning: options.markExternalActionRunning,
        onActionUpdated: options.onActionUpdated,
        onActionExecutionFinished: options.onActionExecutionFinished
      }
    )
  }

  clear(): void {
    this.store.clear()
  }

  async createActionsForRuntimeTurn(
    proposals: BonziProposedAction[]
  ): Promise<AssistantAction[]> {
    const approvalSettings = this.options.getApprovalSettings()
    const actions: AssistantAction[] = []

    for (const proposal of proposals) {
      const pendingAction = this.createPendingAction(proposal, approvalSettings)

      if (
        approvalSettings.approvalsEnabled ||
        requiresNonBypassableConfirmation(pendingAction)
      ) {
        actions.push(pendingAction)
        continue
      }

      const executed = await this.runner.execute(
        pendingAction,
        this.store.currentGeneration
      )
      actions.push(executed.action)
    }

    return actions
  }

  async execute(request: {
    actionId: string
    confirmed: boolean
  }): Promise<AssistantActionExecutionResponse> {
    const action = this.store.get(request.actionId)

    if (!action) {
      return {
        ok: false,
        message: 'That assistant action is no longer available.',
        confirmationRequired: false
      }
    }

    const unavailableResponse = this.buildUnavailableExecutionResponse(action)
    if (unavailableResponse) {
      return unavailableResponse
    }

    const confirmationResponse = this.requestConfirmationIfNeeded(action, request)
    if (confirmationResponse) {
      return confirmationResponse
    }

    const executed = await this.runner.execute(action, this.store.currentGeneration)
    return {
      ok: executed.action.status === 'completed',
      action: executed.action,
      message: formatActionExecutionMessage(executed.action),
      confirmationRequired: false,
      continuationScheduled: executed.continuationScheduled,
      workflowRun: executed.workflowRun
    }
  }

  private createPendingAction(
    proposal: BonziProposedAction,
    approvalSettings: RuntimeApprovalSettings
  ): AssistantAction {
    const pendingAction = createPendingAssistantAction(proposal, approvalSettings)
    this.store.save(pendingAction)
    this.options.linkExternalAction(pendingAction)
    return pendingAction
  }

  private buildUnavailableExecutionResponse(
    action: AssistantAction
  ): AssistantActionExecutionResponse | null {
    if (action.status === 'completed' || action.status === 'failed') {
      return {
        ok: action.status === 'completed',
        action,
        message: action.resultMessage ?? 'Action already finished.',
        confirmationRequired: false
      }
    }

    if (action.status === 'running') {
      return {
        ok: false,
        action,
        message: 'Action is already running.',
        confirmationRequired: false
      }
    }

    return null
  }

  private requestConfirmationIfNeeded(
    action: AssistantAction,
    request: { confirmed: boolean }
  ): AssistantActionExecutionResponse | null {
    const approvalsEnabled = this.options.getApprovalSettings().approvalsEnabled
    const requiresPolicyConfirmation = requiresNonBypassableConfirmation(action)
    const requiresConfirmation =
      (action.requiresConfirmation || requiresPolicyConfirmation) &&
      (approvalsEnabled || requiresPolicyConfirmation)

    if (!requiresConfirmation || request.confirmed) {
      return null
    }

    const awaitingConfirmation: AssistantAction = {
      ...action,
      status: 'needs_confirmation'
    }

    this.store.save(awaitingConfirmation)
    this.options.onActionUpdated(awaitingConfirmation)

    return {
      ok: false,
      action: awaitingConfirmation,
      message: 'Confirmation required. Run the action again to approve it.',
      confirmationRequired: true
    }
  }
}

function requiresNonBypassableConfirmation(action: AssistantAction): boolean {
  return action.type === 'workspace-write-file'
}

function formatActionExecutionMessage(action: AssistantAction): string {
  if (action.type !== 'hermes-run') {
    return action.resultMessage ?? 'Action finished.'
  }

  if (action.status === 'completed') {
    return 'Hermes consultation completed. Eliza is synthesizing the final answer.'
  }

  if (action.status === 'failed') {
    const detail = summarizeForDisplay(action.resultMessage ?? '', 400)
    return detail
      ? `Hermes consultation failed: ${detail}`
      : 'Hermes consultation failed.'
  }

  return action.resultMessage ?? 'Hermes consultation finished.'
}

function summarizeForDisplay(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/gu, ' ').trim()
  if (!normalized) {
    return ''
  }

  return normalized.length > maxLength
    ? `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
    : normalized
}
