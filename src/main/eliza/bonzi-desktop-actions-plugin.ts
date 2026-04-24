import type { Action, ActionResult, Plugin } from '@elizaos/core/node'
import type { AssistantActionType } from '../../shared/contracts'

interface BonziDesktopActionSpec {
  elizaName: string
  type: AssistantActionType
  title: string
  description: string
  requiresConfirmation: boolean
  similes: string[]
}

export interface BonziDesktopActionProposal {
  type: AssistantActionType
  title: string
  description: string
  requiresConfirmation: boolean
}

const BONZI_DESKTOP_ACTION_SPECS = [
  {
    elizaName: 'REPORT_SHELL_STATE',
    type: 'report-shell-state',
    title: 'Report shell state',
    description:
      'Ask Bonzi to show the current platform, runtime stage, asset path, and active provider.',
    requiresConfirmation: false,
    similes: [
      'REPORT_DESKTOP_STATE',
      'SHOW_SHELL_STATE',
      'CHECK_SHELL_STATE',
      'report-shell-state'
    ]
  },
  {
    elizaName: 'COPY_VRM_ASSET_PATH',
    type: 'copy-vrm-asset-path',
    title: 'Copy VRM asset path',
    description: 'Ask Bonzi to copy the bundled VRM asset path to the clipboard.',
    requiresConfirmation: false,
    similes: ['COPY_ASSET_PATH', 'COPY_MODEL_PATH', 'copy-vrm-asset-path']
  },
  {
    elizaName: 'MINIMIZE_WINDOW',
    type: 'minimize-window',
    title: 'Minimize companion window',
    description: 'Ask Bonzi to minimize the companion window.',
    requiresConfirmation: false,
    similes: ['MINIMIZE_BONZI', 'HIDE_WINDOW', 'minimize-window']
  },
  {
    elizaName: 'CLOSE_WINDOW',
    type: 'close-window',
    title: 'Close companion window',
    description:
      'Ask Bonzi to close the companion window. Bonzi will require explicit UI confirmation before closing.',
    requiresConfirmation: true,
    similes: ['CLOSE_BONZI', 'QUIT_WINDOW', 'close-window']
  }
] as const satisfies readonly BonziDesktopActionSpec[]

const ACTION_TYPE_BY_ELIZA_NAME = new Map<string, AssistantActionType>(
  BONZI_DESKTOP_ACTION_SPECS.map((spec) => [spec.elizaName, spec.type])
)

const ACTION_SPEC_BY_TYPE = new Map<AssistantActionType, BonziDesktopActionSpec>(
  BONZI_DESKTOP_ACTION_SPECS.map((spec) => [spec.type, spec])
)

export function formatBonziDesktopActionPromptList(): string {
  return BONZI_DESKTOP_ACTION_SPECS.map(
    (spec) =>
      `- ${spec.elizaName}: ${spec.description}${
        spec.requiresConfirmation
          ? ' Bonzi requires explicit UI confirmation before execution.'
          : ''
      }`
  ).join('\n')
}

export function createBonziDesktopActionsPlugin(): Plugin {
  return {
    name: 'bonzi-desktop-actions',
    description:
      'Native elizaOS actions for Bonzi desktop capabilities. Actions propose Bonzi UI operations; Electron execution remains in the confirmation-aware Bonzi bridge.',
    actions: BONZI_DESKTOP_ACTION_SPECS.map(createBonziDesktopAction)
  }
}

export function bonziActionTypeFromElizaActionName(
  actionName: unknown
): AssistantActionType | null {
  if (typeof actionName !== 'string') {
    return null
  }

  return ACTION_TYPE_BY_ELIZA_NAME.get(actionName.trim().toUpperCase()) ?? null
}

export function createBonziDesktopActionProposal(
  type: AssistantActionType
): BonziDesktopActionProposal {
  const spec = ACTION_SPEC_BY_TYPE.get(type)

  if (!spec) {
    throw new Error(`Unsupported Bonzi desktop action: ${type}`)
  }

  return {
    type: spec.type,
    title: spec.title,
    description: spec.description,
    requiresConfirmation: spec.requiresConfirmation
  }
}

function createBonziDesktopAction(spec: BonziDesktopActionSpec): Action {
  return {
    name: spec.elizaName,
    similes: spec.similes,
    description: [
      spec.description,
      'This does not directly execute Electron/window side effects inside elizaOS.',
      'It creates a Bonzi UI action card; the user approves/runs it through Bonzi.'
    ].join(' '),
    validate: async () => true,
    handler: async () => createBonziActionResult(spec)
  }
}

function createBonziActionResult(spec: BonziDesktopActionSpec): ActionResult {
  const proposal = createBonziDesktopActionProposal(spec.type)
  const confirmationNote = spec.requiresConfirmation
    ? ' It will require explicit confirmation in Bonzi before anything happens.'
    : ''

  return {
    success: true,
    text: `${spec.title} is ready in Bonzi's action tray.${confirmationNote}`,
    values: {
      bonziActionType: spec.type,
      bonziActionRequiresConfirmation: spec.requiresConfirmation
    },
    data: {
      actionName: spec.elizaName,
      bonziProposedAction: proposal
    }
  }
}
