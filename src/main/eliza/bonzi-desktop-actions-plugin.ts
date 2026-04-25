import type { Action, ActionResult, Plugin } from '@elizaos/core/node'
import type {
  AssistantActionParams,
  AssistantActionType
} from '../../shared/contracts'
import {
  hasAssistantActionParams,
  normalizeDiscordDraftText,
  normalizeScrollAmount,
  normalizeScrollDirection,
  normalizeText,
  truncate
} from '../assistant-action-param-utils'

interface BonziDesktopActionSpec {
  elizaName: string
  type: AssistantActionType
  title: string
  description: string
  requiresConfirmation: boolean
  similes: string[]
  parameters?: Action['parameters']
  missingParameterMessage?: string
}

export interface BonziDesktopActionProposal {
  type: AssistantActionType
  title: string
  description: string
  requiresConfirmation: boolean
  params?: AssistantActionParams
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
  },
  {
    elizaName: 'OPEN_URL',
    type: 'open-url',
    title: 'Open URL',
    description:
      'Ask Bonzi to open an http or https URL in the system default browser.',
    requiresConfirmation: false,
    similes: ['OPEN_WEBSITE', 'OPEN_WEB_PAGE', 'LAUNCH_URL', 'open-url'],
    parameters: [
      {
        name: 'url',
        description:
          'The http/https URL or bare website domain the user wants to open, such as https://example.com or example.com.',
        required: true,
        schema: { type: 'string' },
        examples: ['https://example.com', 'example.com']
      }
    ],
    missingParameterMessage: 'I need a website URL before I can prepare an open-url action.'
  },
  {
    elizaName: 'SEARCH_WEB',
    type: 'search-web',
    title: 'Search web',
    description:
      'Ask Bonzi to open a safely encoded web search in the system default browser.',
    requiresConfirmation: false,
    similes: ['WEB_SEARCH', 'SEARCH_IN_BROWSER', 'GOOGLE_SEARCH', 'search-web'],
    parameters: [
      {
        name: 'query',
        description: 'The plain-language search query the user wants to search for.',
        required: true,
        schema: { type: 'string' },
        examples: ['weather tomorrow', 'elizaOS action parameters']
      }
    ],
    missingParameterMessage: 'I need a search query before I can prepare a search-web action.'
  },
  {
    elizaName: 'CUA_CHECK_STATUS',
    type: 'cua-check-status',
    title: 'Check Cua Driver status',
    description:
      'Ask Bonzi to check whether Cua Driver is installed, reachable, running, and has the macOS permissions it needs. Bonzi will not install anything automatically.',
    requiresConfirmation: false,
    similes: ['CHECK_CUA_STATUS', 'CUA_STATUS', 'CHECK_COMPUTER_USE_DRIVER', 'cua-check-status']
  },
  {
    elizaName: 'DISCORD_SNAPSHOT',
    type: 'discord-snapshot',
    title: 'Inspect Discord',
    description:
      'Ask Bonzi to use Cua Driver to launch or find Discord and return a readable snapshot of the current Discord window for context. This does not send messages.',
    requiresConfirmation: false,
    similes: ['SNAPSHOT_DISCORD', 'READ_DISCORD', 'INSPECT_DISCORD', 'discord-snapshot'],
    parameters: [
      {
        name: 'query',
        description:
          'Optional short query describing what to inspect in the Discord window, such as current channel messages or message composer.',
        required: false,
        schema: { type: 'string' },
        examples: ['current channel messages', 'message composer']
      }
    ]
  },
  {
    elizaName: 'DISCORD_READ_SCREENSHOT',
    type: 'discord-read-screenshot',
    title: 'Read Discord screenshot',
    description:
      'Ask Bonzi to capture the Discord window screenshot with Cua Driver, send it to the configured OpenAI vision model, and record the visual readback. This does not send messages.',
    requiresConfirmation: false,
    similes: ['READ_DISCORD_SCREENSHOT', 'VISION_READ_DISCORD', 'ANALYZE_DISCORD_SCREENSHOT', 'discord-read-screenshot'],
    parameters: [
      {
        name: 'query',
        description:
          'Optional short instruction for what to read from the Discord screenshot, such as latest messages or reply context.',
        required: false,
        schema: { type: 'string' },
        examples: ['latest visible messages', 'what should I reply to?']
      }
    ]
  },
  {
    elizaName: 'DISCORD_SCROLL',
    type: 'discord-scroll',
    title: 'Scroll Discord',
    description:
      'Ask Bonzi to use Cua Driver to scroll the Discord window up or down, then inspect the result. This does not send messages.',
    requiresConfirmation: false,
    similes: ['SCROLL_DISCORD', 'DISCORD_SCROLL_UP', 'DISCORD_SCROLL_DOWN', 'discord-scroll'],
    parameters: [
      {
        name: 'direction',
        description: 'Scroll direction: up or down.',
        required: true,
        schema: { type: 'string', enum: ['up', 'down'] },
        examples: ['up', 'down']
      },
      {
        name: 'amount',
        description: 'Optional conservative scroll amount from 1 to 10. Defaults to 5.',
        required: false,
        schema: { type: 'number' },
        examples: [3, 5]
      }
    ],
    missingParameterMessage: 'I need a scroll direction, either up or down, before I can prepare a Discord scroll action.'
  },
  {
    elizaName: 'DISCORD_TYPE_DRAFT',
    type: 'discord-type-draft',
    title: 'Type Discord draft',
    description:
      'Ask Bonzi to type a draft into Discord using Cua Driver. Bonzi will not press Enter or send the message.',
    requiresConfirmation: false,
    similes: ['TYPE_DISCORD_DRAFT', 'PREPARE_DISCORD_REPLY', 'DRAFT_DISCORD_REPLY', 'discord-type-draft'],
    parameters: [
      {
        name: 'text',
        description:
          'The exact draft text to type into the focused or target Discord message field. Bonzi will not send it.',
        required: true,
        schema: { type: 'string' },
        examples: ['Thanks, I will take a look.']
      }
    ],
    missingParameterMessage: 'I need the draft text before I can prepare a Discord type-draft action.'
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
  type: AssistantActionType,
  params?: AssistantActionParams
): BonziDesktopActionProposal {
  const spec = ACTION_SPEC_BY_TYPE.get(type)

  if (!spec) {
    throw new Error(`Unsupported Bonzi desktop action: ${type}`)
  }

  return {
    type: spec.type,
    title: actionTitle(spec, params),
    description: actionDescription(spec, params),
    requiresConfirmation: spec.requiresConfirmation,
    ...(hasAssistantActionParams(params) ? { params } : {})
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
    parameters: spec.parameters,
    validate: async () => true,
    handler: async (_runtime, message, _state, options) => {
      const parameters = isRecord(options?.parameters) ? options.parameters : {}
      const messageText = normalizeText(message.content.text)
      return createBonziActionResult(spec, parameters, messageText)
    }
  }
}

function createBonziActionResult(
  spec: BonziDesktopActionSpec,
  parameters: Record<string, unknown>,
  messageText: string
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
  const confirmationNote = spec.requiresConfirmation
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

function createActionParams(
  type: AssistantActionType,
  parameters: Record<string, unknown>,
  messageText: string
): AssistantActionParams | undefined {
  switch (type) {
    case 'open-url': {
      const url =
        normalizeText(parameters.url) || inferUrlLikeText(messageText)
      return url ? { url: truncate(url, 2_048) } : undefined
    }
    case 'search-web': {
      const query =
        normalizeText(parameters.query) || inferSearchQueryFromText(messageText)
      return query ? { query: truncate(query, 500) } : undefined
    }
    case 'discord-snapshot': {
      const query = normalizeText(parameters.query)
      return query ? { query: truncate(query, 200) } : undefined
    }
    case 'discord-scroll': {
      const direction = normalizeScrollDirection(parameters.direction) || inferScrollDirectionFromText(messageText)
      const amount = normalizeScrollAmount(parameters.amount)
      return direction ? { direction, amount } : undefined
    }
    case 'discord-type-draft': {
      const text = normalizeDiscordDraftText(parameters.text) || normalizeDiscordDraftText(inferDiscordDraftText(messageText))
      return text ? { text: truncate(text, 2_000) } : undefined
    }
    default:
      return undefined
  }
}

function actionTitle(
  spec: BonziDesktopActionSpec,
  params: AssistantActionParams | undefined
): string {
  if (spec.type === 'search-web' && params?.query) {
    return 'Search the web'
  }

  if (spec.type === 'discord-scroll' && params?.direction) {
    return `Scroll Discord ${params.direction}`
  }

  if (spec.type === 'discord-type-draft' && params?.text) {
    return 'Type Discord draft'
  }

  return spec.title
}

function actionDescription(
  spec: BonziDesktopActionSpec,
  params: AssistantActionParams | undefined
): string {
  if (spec.type === 'open-url' && params?.url) {
    return `Open ${params.url} in your default browser.`
  }

  if (spec.type === 'search-web' && params?.query) {
    return `Search the web for “${params.query}” in your default browser.`
  }

  if (spec.type === 'discord-snapshot' && params?.query) {
    return `Inspect Discord with query: “${params.query}”. This does not send messages.`
  }

  if (spec.type === 'discord-read-screenshot' && params?.query) {
    return `Read the Discord screenshot with vision query: “${params.query}”. This does not send messages.`
  }

  if (spec.type === 'discord-scroll' && params?.direction) {
    return `Scroll Discord ${params.direction} by ${params.amount ?? 5}, then return a short snapshot. This does not send messages.`
  }

  if (spec.type === 'discord-type-draft' && params?.text) {
    return `Type this Discord draft without pressing Enter or sending it: “${truncate(params.text, 160)}”`
  }

  return spec.description
}

function inferUrlLikeText(text: string): string {
  const explicitUrl = text.match(/https?:\/\/[^\s<>'"]+/i)?.[0]

  if (explicitUrl) {
    return stripTrailingSentencePunctuation(explicitUrl)
  }

  const domain = text.match(
    /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?:\/[^\s<>'"]*)?/i
  )?.[0]

  return domain ? stripTrailingSentencePunctuation(domain) : ''
}

function inferSearchQueryFromText(text: string): string {
  const trimmed = text.trim()
  const commandMatch = trimmed.match(
    /^(?:please\s+)?(?:search|look\s+up|google|find)(?:\s+(?:the\s+)?(?:web|internet|online))?(?:\s+for)?(?:\s+(.+))?$/i
  )

  if (commandMatch) {
    return commandMatch[1]?.trim() ?? ''
  }

  return trimmed
}

function stripTrailingSentencePunctuation(value: string): string {
  return value.replace(/[),.;!?]+$/g, '')
}

function hasRequiredActionParams(
  type: AssistantActionType,
  params: AssistantActionParams | undefined
): boolean {
  switch (type) {
    case 'open-url':
      return Boolean(params?.url)
    case 'search-web':
      return Boolean(params?.query)
    case 'discord-scroll':
      return params?.direction === 'up' || params?.direction === 'down'
    case 'discord-type-draft':
      return Boolean(params?.text)
    default:
      return true
  }
}

function inferScrollDirectionFromText(text: string): 'up' | 'down' | undefined {
  if (/\b(up|older|previous|back)\b/i.test(text)) {
    return 'up'
  }

  if (/\b(down|newer|next|forward)\b/i.test(text)) {
    return 'down'
  }

  return undefined
}

function inferDiscordDraftText(text: string): string {
  const quoted = text.match(/[“"]([^”"]{1,2000})[”"]/u)?.[1]

  if (quoted) {
    return quoted.trim()
  }

  const draftMatch = text.match(
    /(?:draft|type|reply(?:\s+with)?|respond(?:\s+with)?|say)\s*[:：]?\s*(.+)$/is
  )

  return draftMatch?.[1]?.trim() ?? ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
