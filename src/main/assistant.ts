import type { BrowserWindow } from 'electron'
import {
  type AssistantAction,
  type AssistantActionExecutionRequest,
  type AssistantActionExecutionResponse,
  type AssistantActionType,
  type AssistantCommandRequest,
  type AssistantCommandResponse,
  type AssistantEvent,
  type AssistantMessage,
  type AssistantProviderInfo,
  type AssistantRuntimeStatus,
  type ElizaPluginSettings,
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
  updatePluginSettings: (
    request: UpdateElizaPluginSettingsRequest
  ) => Promise<ElizaPluginSettings>
  getAvailableActionTypes: () => AssistantActionType[]
  getHistory: () => Promise<AssistantMessage[]>
  resetConversation: () => Promise<void>
  subscribe: (listener: (event: AssistantEvent) => void) => () => void
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
    getShellState: options.getShellState
  })
  const pendingActions = new Map<string, AssistantAction>()

  return {
    getProviderInfo: () => runtimeManager.getProviderInfo(),
    getStartupWarnings: () => runtimeManager.getStartupWarnings(),
    getRuntimeStatus: () => runtimeManager.getRuntimeStatus(),
    getPluginSettings: () => runtimeManager.getPluginSettings(),
    updatePluginSettings: (request) => runtimeManager.updatePluginSettings(request),
    getAvailableActionTypes: () => runtimeManager.getAvailableActionTypes(),
    getHistory: () => runtimeManager.getHistory(),
    async resetConversation(): Promise<void> {
      pendingActions.clear()
      await runtimeManager.resetConversation()
    },
    subscribe: (listener) => runtimeManager.subscribe(listener),
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
          warnings: [...runtimeManager.getStartupWarnings(), ...runtimeTurn.warnings]
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
