import type {
  AssistantAction,
  AssistantActionType
} from '../shared/contracts'
import type { BonziProposedAction } from './eliza/runtime-manager'
import { sanitizeAssistantActionParams } from './assistant-action-param-utils'

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
  },
  'open-url': {
    type: 'open-url',
    title: 'Open URL',
    description: 'Open an http or https URL in the system default browser.',
    requiresConfirmation: false
  },
  'search-web': {
    type: 'search-web',
    title: 'Search web',
    description: 'Open a safely encoded web search in the system default browser.',
    requiresConfirmation: false
  },
  'cua-check-status': {
    type: 'cua-check-status',
    title: 'Check Cua Driver status',
    description:
      'Check whether Cua Driver is installed, reachable, running, and has the required macOS permissions.',
    requiresConfirmation: false
  },
  'discord-snapshot': {
    type: 'discord-snapshot',
    title: 'Inspect native Discord app',
    description:
      'Use Cua Driver to inspect the native Discord app. Prefer Discord Web DOM context unless the user explicitly asks for the app/Cua path. This does not send messages.',
    requiresConfirmation: false
  },
  'discord-read-context': {
    type: 'discord-read-context',
    title: 'Read Discord context',
    description:
      'Use Discord Web in a browser session and extract the visible chat context from the DOM. This uses no screenshots or OCR and does not send messages.',
    requiresConfirmation: false
  },
  'discord-read-screenshot': {
    type: 'discord-read-screenshot',
    title: 'Read Discord screenshot',
    description:
      'Capture the Discord window screenshot and ask the configured OpenAI vision model to read it. This does not send messages.',
    requiresConfirmation: false
  },
  'discord-scroll': {
    type: 'discord-scroll',
    title: 'Scroll Discord',
    description:
      'Use Cua Driver to scroll Discord up or down, then return a short follow-up snapshot. This does not send messages.',
    requiresConfirmation: false
  },
  'discord-type-draft': {
    type: 'discord-type-draft',
    title: 'Type Discord draft',
    description:
      'Use Discord Web in a browser session to type a draft into the composer. This will not press Enter or send the message.',
    requiresConfirmation: false
  }
}

export function createPendingAssistantAction(
  action: BonziProposedAction,
  options: { approvalsEnabled?: boolean } = {}
): AssistantAction {
  const defaults = ACTION_DEFAULTS[action.type]
  const params = sanitizeAssistantActionParams(action.params)
  const requiresConfirmation =
    defaults.requiresConfirmation || action.requiresConfirmation === true
  const description = action.description?.trim() || defaults.description

  return {
    id: crypto.randomUUID(),
    type: action.type,
    title: action.title?.trim() || defaults.title,
    description:
      requiresConfirmation && options.approvalsEnabled === false
        ? `${description} Approvals are currently disabled, so this will run when clicked.`
        : description,
    requiresConfirmation,
    status: 'pending',
    ...(params ? { params } : {}),
    ...(action.workflowRunId ? { workflowRunId: action.workflowRunId } : {}),
    ...(action.workflowStepId ? { workflowStepId: action.workflowStepId } : {}),
    ...(action.commandMessageId ? { commandMessageId: action.commandMessageId } : {}),
    ...(action.continuationId ? { continuationId: action.continuationId } : {}),
    ...(typeof action.continuationIndex === 'number'
      ? { continuationIndex: action.continuationIndex }
      : {})
  }
}
