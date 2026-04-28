import type { Action, ActionResult, Plugin } from '@elizaos/core/node'
import { normalizeText } from '../assistant-action-param-utils'
import {
  BONZI_DESKTOP_ACTION_SPECS,
  type BonziDesktopActionSpec
} from './bonzi-desktop-action-catalog'
import {
  createActionParams,
  hasRequiredActionParams
} from './bonzi-desktop-action-params'
import { createBonziDesktopActionProposal } from './bonzi-desktop-action-proposals'

export {
  bonziActionTypeFromElizaActionName,
  createBonziDesktopActionProposal
} from './bonzi-desktop-action-proposals'
export type { BonziDesktopActionProposal } from './bonzi-desktop-action-proposals'

export function formatBonziDesktopActionPromptList(options: {
  approvalsEnabled?: boolean
} = {}): string {
  const approvalsEnabled = options.approvalsEnabled !== false

  return BONZI_DESKTOP_ACTION_SPECS.map(
    (spec) =>
      `- ${spec.elizaName}: ${spec.description}${
        spec.requiresConfirmation && approvalsEnabled
          ? ' Bonzi requires explicit UI confirmation before execution.'
          : ''
      }`
  ).join('\n')
}

export function createBonziDesktopActionsPlugin(options: {
  approvalsEnabled?: boolean
} = {}): Plugin {
  const approvalsEnabled = options.approvalsEnabled !== false

  return {
    name: 'bonzi-desktop-actions',
    description:
      approvalsEnabled
        ? 'Native elizaOS actions for Bonzi desktop capabilities. Actions propose Bonzi UI operations; Electron execution remains in the confirmation-aware Bonzi bridge.'
        : 'Native elizaOS actions for Bonzi desktop capabilities. Actions propose Bonzi UI operations; approval prompts are disabled by user setting.',
    actions: BONZI_DESKTOP_ACTION_SPECS.map((spec) =>
      createBonziDesktopAction(spec, { approvalsEnabled })
    )
  }
}

function createBonziDesktopAction(
  spec: BonziDesktopActionSpec,
  pluginOptions: { approvalsEnabled: boolean }
): Action {
  return {
    name: spec.elizaName,
    similes: spec.similes,
    description: [
      spec.description,
      'This does not directly execute Electron/window side effects inside elizaOS.',
      pluginOptions.approvalsEnabled
        ? 'It creates a Bonzi UI action card; the user approves/runs it through Bonzi.'
        : 'It creates a Bonzi UI action card; approval prompts are currently disabled by user setting.'
    ].join(' '),
    parameters: spec.parameters,
    validate: async () => true,
    handler: async (_runtime, message, _state, options) => {
      const parameters = isRecord(options?.parameters) ? options.parameters : {}
      const messageText = normalizeText(message.content.text)
      return createBonziActionResult(spec, parameters, messageText, pluginOptions)
    }
  }
}

function createBonziActionResult(
  spec: BonziDesktopActionSpec,
  parameters: Record<string, unknown>,
  messageText: string,
  options: { approvalsEnabled: boolean }
): ActionResult {
  const params = createActionParams(spec.type, parameters, messageText)

  if (spec.missingParameterMessage && !hasRequiredActionParams(spec.type, params)) {
    return {
      success: false,
      text: spec.missingParameterMessage,
      data: {
        actionName: spec.elizaName,
        bonziActionType: spec.type,
        bonziActionMissingParameters: true
      }
    }
  }

  const proposal = createBonziDesktopActionProposal(spec.type, params)
  const confirmationNote = spec.requiresConfirmation && options.approvalsEnabled
    ? ' It will require explicit confirmation in Bonzi before anything happens.'
    : ''

  return {
    success: true,
    text: `${proposal.title} is ready in Bonzi's action tray.${confirmationNote}`,
    values: {
      bonziActionType: spec.type,
      bonziActionRequiresConfirmation: spec.requiresConfirmation,
      bonziActionParams: params ?? null
    },
    data: {
      actionName: spec.elizaName,
      bonziActionParams: params ?? null,
      bonziProposedAction: proposal
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
