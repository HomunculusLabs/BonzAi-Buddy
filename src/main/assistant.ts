import { clipboard, type BrowserWindow } from 'electron'
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
  type ShellState
} from '../shared/contracts'
import {
  BonziRuntimeManager,
  type BonziProposedAction
} from './eliza/runtime-manager'

interface AssistantServiceOptions {
  getCompanionWindow: () => BrowserWindow | null
  getShellState: () => ShellState
}

const ACTION_DEFAULTS: Record<
  AssistantActionType,
  Omit<AssistantAction, 'id' | 'status' | 'resultMessage'>
> = {
  'report-shell-state': {
    type: 'report-shell-state',
    title: 'Report shell state',
    description:
      'Summarize the current platform, runtime stage, asset path, and active provider.',
    requiresConfirmation: false
  },
  'copy-vrm-asset-path': {
    type: 'copy-vrm-asset-path',
    title: 'Copy VRM asset path',
    description: 'Copy the bundled VRM asset path to the clipboard.',
    requiresConfirmation: false
  },
  'minimize-window': {
    type: 'minimize-window',
    title: 'Minimize companion window',
    description: 'Minimize the current Bonzi companion window.',
    requiresConfirmation: false
  },
  'close-window': {
    type: 'close-window',
    title: 'Close companion window',
    description: 'Close the current Bonzi companion window.',
    requiresConfirmation: true
  }
}

export interface AssistantService {
  getProviderInfo: () => AssistantProviderInfo
  getStartupWarnings: () => string[]
  getRuntimeStatus: () => AssistantRuntimeStatus
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
          const pendingAction = createPendingAction(action)
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
        const message = executeAllowlistedAction(
          action,
          options.getShellState(),
          options.getCompanionWindow()
        )

        const completedAction: AssistantAction = {
          ...action,
          status: 'completed',
          resultMessage: message
        }

        pendingActions.set(completedAction.id, completedAction)

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

function createPendingAction(action: BonziProposedAction): AssistantAction {
  const defaults = ACTION_DEFAULTS[action.type]

  return {
    id: crypto.randomUUID(),
    type: action.type,
    title: action.title?.trim() || defaults.title,
    description: action.description?.trim() || defaults.description,
    requiresConfirmation:
      defaults.requiresConfirmation || action.requiresConfirmation === true,
    status: 'pending'
  }
}

function executeAllowlistedAction(
  action: AssistantAction,
  shellState: ShellState,
  companionWindow: BrowserWindow | null
): string {
  switch (action.type) {
    case 'report-shell-state':
      return [
        `Stage: ${shellState.stage}`,
        `Platform: ${shellState.platform}`,
        `VRM asset: ${shellState.vrmAssetPath}`,
        `Provider: ${shellState.assistant.provider.label}`,
        `Runtime: ${shellState.assistant.runtime.backend} / ${shellState.assistant.runtime.state}`
      ].join('\n')
    case 'copy-vrm-asset-path':
      clipboard.writeText(shellState.vrmAssetPath)
      return `Copied the bundled VRM asset path to the clipboard: ${shellState.vrmAssetPath}`
    case 'minimize-window':
      if (!companionWindow || companionWindow.isDestroyed()) {
        throw new Error('Bonzi companion window is not available to minimize.')
      }
      companionWindow.minimize()
      return 'Bonzi companion window minimized.'
    case 'close-window':
      if (!companionWindow || companionWindow.isDestroyed()) {
        throw new Error('Bonzi companion window is not available to close.')
      }
      companionWindow.close()
      return 'Bonzi companion window closed.'
    default:
      return assertNever(action.type)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength - 1)}…`
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function assertNever(value: never): never {
  throw new Error(`Unsupported action: ${String(value)}`)
}
