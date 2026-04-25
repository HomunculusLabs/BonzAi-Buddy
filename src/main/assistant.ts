import type { BrowserWindow } from 'electron'
import {
  type AssistantAction,
  type AssistantActionExecutionRequest,
  type AssistantActionExecutionResponse,
  type AssistantActionType,
  type AssistantCommandRequest,
  type AssistantCommandResponse,
  type CancelWorkflowRunRequest,
  type CancelWorkflowRunResponse,
  type AssistantEvent,
  type AssistantMessage,
  type AssistantProviderInfo,
  type AssistantRuntimeStatus,
  type BonziWorkflowRunSnapshot,
  type ElizaPluginDiscoveryRequest,
  type RespondWorkflowApprovalRequest,
  type RespondWorkflowApprovalResponse,
  type ElizaPluginInstallRequest,
  type ElizaPluginOperationResult,
  type ElizaPluginSettings,
  type ElizaPluginUninstallRequest,
  type UpdateElizaPluginSettingsRequest,
  type ShellState
} from '../shared/contracts'
import { BonziRuntimeManager } from './eliza/runtime-manager'
import { truncate } from './assistant-action-param-utils'
import { executeAssistantAction } from './assistant-action-executor'
import { createPendingAssistantAction } from './assistant-action-presentation'

interface AssistantServiceOptions {
  getCompanionWindow: () => BrowserWindow | null
  getShellState: () => ShellState
}

export interface AssistantService {
  getProviderInfo: () => AssistantProviderInfo
  getStartupWarnings: () => string[]
  getRuntimeStatus: () => AssistantRuntimeStatus
  getPluginSettings: () => ElizaPluginSettings
  discoverPlugins: (
    request?: ElizaPluginDiscoveryRequest
  ) => Promise<ElizaPluginSettings>
  updatePluginSettings: (
    request: UpdateElizaPluginSettingsRequest
  ) => Promise<ElizaPluginSettings>
  installPlugin: (
    request: ElizaPluginInstallRequest
  ) => Promise<ElizaPluginOperationResult>
  uninstallPlugin: (
    request: ElizaPluginUninstallRequest
  ) => Promise<ElizaPluginOperationResult>
  getAvailableActionTypes: () => AssistantActionType[]
  getHistory: () => Promise<AssistantMessage[]>
  resetConversation: () => Promise<void>
  reloadRuntime: () => Promise<AssistantRuntimeStatus>
  subscribe: (listener: (event: AssistantEvent) => void) => () => void
  getWorkflowRuns: () => BonziWorkflowRunSnapshot[]
  getWorkflowRun: (id: string) => BonziWorkflowRunSnapshot | null
  respondWorkflowApproval: (
    request: RespondWorkflowApprovalRequest
  ) => Promise<RespondWorkflowApprovalResponse>
  cancelWorkflowRun: (
    request: CancelWorkflowRunRequest
  ) => Promise<CancelWorkflowRunResponse>
  sendCommand: (
    request: AssistantCommandRequest
  ) => Promise<AssistantCommandResponse>
  executeAction: (
    request: AssistantActionExecutionRequest
  ) => Promise<AssistantActionExecutionResponse>
  dispose: () => Promise<void>
}

export function createAssistantService(
  options: AssistantServiceOptions
): AssistantService {
  const runtimeManager = new BonziRuntimeManager({
    getShellState: options.getShellState,
    getCompanionWindow: options.getCompanionWindow
  })
  const pendingActions = new Map<string, AssistantAction>()

  return {
    getProviderInfo: () => runtimeManager.getProviderInfo(),
    getStartupWarnings: () => runtimeManager.getStartupWarnings(),
    getRuntimeStatus: () => runtimeManager.getRuntimeStatus(),
    getPluginSettings: () => runtimeManager.getPluginSettings(),
    discoverPlugins: (request) => runtimeManager.discoverPlugins(request),
    updatePluginSettings: (request) => runtimeManager.updatePluginSettings(request),
    installPlugin: (request) => runtimeManager.installPlugin(request),
    uninstallPlugin: (request) => runtimeManager.uninstallPlugin(request),
    getAvailableActionTypes: () => runtimeManager.getAvailableActionTypes(),
    getHistory: () => runtimeManager.getHistory(),
    async resetConversation(): Promise<void> {
      pendingActions.clear()
      await runtimeManager.resetConversation()
    },
    async reloadRuntime(): Promise<AssistantRuntimeStatus> {
      pendingActions.clear()
      return runtimeManager.reloadRuntime()
    },
    subscribe: (listener) => runtimeManager.subscribe(listener),
    getWorkflowRuns: () => runtimeManager.getWorkflowRuns(),
    getWorkflowRun: (id) => runtimeManager.getWorkflowRun(id),
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

      const run = runtimeManager.respondToWorkflowApproval(normalized)

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
    },
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

      const run = runtimeManager.cancelWorkflowRun(normalized.runId)

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
    },
    async sendCommand(
      request: AssistantCommandRequest
    ): Promise<AssistantCommandResponse> {
      const normalizedRequest = normalizeCommandRequest(request)
      const provider = runtimeManager.getProviderInfo()
      const startupWarnings = runtimeManager.getStartupWarnings()

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
        const runtimeTurn = await runtimeManager.sendCommand(normalizedRequest.command)
        const actions = runtimeTurn.actions.map((action) => {
          const pendingAction = createPendingAssistantAction(action)
          pendingActions.set(pendingAction.id, pendingAction)
          return pendingAction
        })

        return {
          ok: true,
          provider: runtimeManager.getProviderInfo(),
          reply: createAssistantMessage('assistant', runtimeTurn.reply),
          actions,
          warnings: [...runtimeManager.getStartupWarnings(), ...runtimeTurn.warnings],
          workflowRun: runtimeTurn.workflowRun
        }
      } catch (error) {
        return {
          ok: false,
          provider: runtimeManager.getProviderInfo(),
          error: normalizeError(error),
          actions: [],
          warnings: runtimeManager.getStartupWarnings()
        }
      }
    },
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

      const action = pendingActions.get(normalizedRequest.actionId)

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

      if (action.requiresConfirmation && !normalizedRequest.confirmed) {
        const awaitingConfirmation: AssistantAction = {
          ...action,
          status: 'needs_confirmation'
        }

        pendingActions.set(awaitingConfirmation.id, awaitingConfirmation)

        return {
          ok: false,
          action: awaitingConfirmation,
          message: 'Confirmation required. Run the action again to approve it.',
          confirmationRequired: true
        }
      }

      try {
        const message = await executeAssistantAction(action, {
          shellState: options.getShellState(),
          companionWindow: options.getCompanionWindow()
        })

        const completedAction: AssistantAction = {
          ...action,
          status: 'completed',
          resultMessage: message
        }

        pendingActions.set(completedAction.id, completedAction)
        await runtimeManager.recordActionObservation(completedAction, message)

        return {
          ok: true,
          action: completedAction,
          message,
          confirmationRequired: false
        }
      } catch (error) {
        const failedAction: AssistantAction = {
          ...action,
          status: 'failed',
          resultMessage: normalizeError(error)
        }

        pendingActions.set(failedAction.id, failedAction)
        await runtimeManager.recordActionObservation(
          failedAction,
          failedAction.resultMessage ?? 'Action failed.'
        )

        return {
          ok: false,
          action: failedAction,
          message: failedAction.resultMessage ?? 'Action failed.',
          confirmationRequired: false
        }
      }
    },
    async dispose(): Promise<void> {
      pendingActions.clear()
      await runtimeManager.dispose()
    }
  }
}

function normalizeCommandRequest(request: unknown): {
  command: string
  error?: string
} {
  if (!isRecord(request)) {
    return {
      command: '',
      error: 'Malformed assistant request.'
    }
  }

  const command = typeof request.command === 'string' ? request.command.trim() : ''

  if (!command) {
    return {
      command: '',
      error: 'Enter a command before sending it to the assistant.'
    }
  }

  return {
    command: truncate(command, 2_000)
  }
}

function normalizeActionExecutionRequest(request: unknown): {
  actionId: string
  confirmed: boolean
  error?: string
} {
  if (!isRecord(request)) {
    return {
      actionId: '',
      confirmed: false,
      error: 'Malformed assistant action request.'
    }
  }

  if (typeof request.actionId !== 'string' || !request.actionId.trim()) {
    return {
      actionId: '',
      confirmed: false,
      error: 'Assistant action requests must include a valid actionId.'
    }
  }

  if (typeof request.confirmed !== 'boolean') {
    return {
      actionId: '',
      confirmed: false,
      error: 'Assistant action requests must include a boolean confirmed flag.'
    }
  }

  return {
    actionId: request.actionId,
    confirmed: request.confirmed
  }
}

function normalizeWorkflowApprovalRequest(request: unknown): {
  runId: string
  stepId: string
  approved: boolean
  error?: string
} {
  if (!isRecord(request)) {
    return {
      runId: '',
      stepId: '',
      approved: false,
      error: 'Malformed workflow approval request.'
    }
  }

  const runId = typeof request.runId === 'string' ? request.runId.trim() : ''
  const stepId = typeof request.stepId === 'string' ? request.stepId.trim() : ''

  if (!runId) {
    return {
      runId: '',
      stepId: '',
      approved: false,
      error: 'Workflow approval requests must include a runId.'
    }
  }

  if (!stepId) {
    return {
      runId: '',
      stepId: '',
      approved: false,
      error: 'Workflow approval requests must include a stepId.'
    }
  }

  if (typeof request.approved !== 'boolean') {
    return {
      runId: '',
      stepId: '',
      approved: false,
      error: 'Workflow approval requests must include a boolean approved flag.'
    }
  }

  return {
    runId,
    stepId,
    approved: request.approved
  }
}

function normalizeCancelWorkflowRequest(request: unknown): {
  runId: string
  error?: string
} {
  if (!isRecord(request)) {
    return {
      runId: '',
      error: 'Malformed cancel workflow request.'
    }
  }

  const runId = typeof request.runId === 'string' ? request.runId.trim() : ''

  if (!runId) {
    return {
      runId: '',
      error: 'Cancel workflow requests must include a runId.'
    }
  }

  return {
    runId
  }
}

function createAssistantMessage(
  role: AssistantMessage['role'],
  content: string
): AssistantMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString()
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
