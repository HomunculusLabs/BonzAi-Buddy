import type { Action } from '@elizaos/core/node'
import type { AssistantActionType } from '../../shared/contracts'

export interface BonziDesktopActionSpec {
  elizaName: string
  type: AssistantActionType
  title: string
  description: string
  requiresConfirmation: boolean
  similes: string[]
  parameters?: Action['parameters']
  missingParameterMessage?: string
}

export const BONZI_DESKTOP_ACTION_SPECS = [
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
    description: 'Ask Bonzi to close the companion window.',
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
    elizaName: 'HERMES_RUN',
    type: 'hermes-run',
    title: 'Consult Hermes secondary runtime',
    description:
      'Ask Bonzi to consult Hermes as a secondary specialist. Hermes returns advisory observation text only; Eliza remains the orchestrator and decides any user-facing response or follow-up Bonzi action.',
    requiresConfirmation: false,
    similes: ['CONSULT_HERMES', 'ASK_HERMES', 'HERMES_CONSULT', 'HERMES_RUN', 'hermes-run'],
    parameters: [
      {
        name: 'prompt',
        description:
          'The bounded consultation prompt for Hermes. Include only context Hermes needs to provide advisory observations back to Eliza.',
        required: true,
        schema: { type: 'string' },
        examples: ['Review this plan and point out risks.']
      }
    ],
    missingParameterMessage: 'I need a prompt before I can prepare a Hermes consultation action.'
  },
  {
    elizaName: 'INSPECT_CRON_JOBS',
    type: 'inspect-cron-jobs',
    title: 'Inspect Hermes cron jobs',
    description:
      'Ask Bonzi to inspect Hermes scheduled cron jobs through the secondary Hermes runtime and return an observation. This is read-only, and Eliza decides any follow-up action.',
    requiresConfirmation: false,
    similes: ['CHECK_CRON_JOBS', 'LIST_CRON_JOBS', 'CHECK_HERMES_CRON', 'HERMES_CRON_STATUS', 'inspect-cron-jobs'],
    parameters: [
      {
        name: 'query',
        description:
          'Optional short filter for Hermes cron output, such as a project, job name, or topic.',
        required: false,
        schema: { type: 'string' },
        examples: ['llm wiki', 'daily']
      }
    ]
  },
  {
    elizaName: 'DISCORD_READ_CONTEXT',
    type: 'discord-read-context',
    title: 'Read Discord context',
    description:
      'Default Discord reading action. Ask Bonzi to use its internal Discord Web browser session and extract the current chat context from the DOM. This uses no screenshots or OCR, does not use the native Discord app, and does not send messages.',
    requiresConfirmation: false,
    similes: ['READ_DISCORD', 'INSPECT_DISCORD', 'READ_DISCORD_CONTEXT', 'READ_DISCORD_WEB', 'DISCORD_CONTEXT', 'discord-read-context'],
    parameters: [
      {
        name: 'url',
        description:
          'Optional Discord Web channel or DM URL to open before reading, such as https://discord.com/channels/@me.',
        required: false,
        schema: { type: 'string' },
        examples: ['https://discord.com/channels/@me']
      },
      {
        name: 'query',
        description:
          'Optional short instruction for what to read from the Discord Web DOM, such as latest messages or reply context.',
        required: false,
        schema: { type: 'string' },
        examples: ['latest visible messages', 'what should I reply to?']
      }
    ]
  },
  {
    elizaName: 'DISCORD_SNAPSHOT',
    type: 'discord-snapshot',
    title: 'Inspect native Discord app',
    description:
      'Ask Bonzi to use Cua Driver to launch or find the native Discord app and return an accessibility snapshot. Use this only when the user explicitly asks for the native app or Cua Driver. This does not send messages.',
    requiresConfirmation: false,
    similes: ['SNAPSHOT_DISCORD_APP', 'INSPECT_NATIVE_DISCORD', 'CUA_DISCORD_SNAPSHOT', 'discord-snapshot'],
    parameters: [
      {
        name: 'query',
        description:
          'Optional short query describing what to inspect in the native Discord app window.',
        required: false,
        schema: { type: 'string' },
        examples: ['native app message composer']
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
      'Ask Bonzi to type a draft into the Discord Web composer in its internal browser session using DOM insertion. Bonzi will not press Enter or send the message.',
    requiresConfirmation: false,
    similes: ['TYPE_DISCORD_DRAFT', 'PREPARE_DISCORD_REPLY', 'DRAFT_DISCORD_REPLY', 'discord-type-draft'],
    parameters: [
      {
        name: 'url',
        description:
          'Optional Discord Web channel or DM URL to open before typing the draft.',
        required: false,
        schema: { type: 'string' },
        examples: ['https://discord.com/channels/@me']
      },
      {
        name: 'text',
        description:
          'The exact draft text to type into the Discord Web message composer. Bonzi will not send it.',
        required: true,
        schema: { type: 'string' },
        examples: ['Thanks, I will take a look.']
      }
    ],
    missingParameterMessage: 'I need the draft text before I can prepare a Discord type-draft action.'
  },
  {
    elizaName: 'WORKSPACE_LIST_FILES',
    type: 'workspace-list-files',
    title: 'List workspace files',
    description:
      "Ask Bonzi to list files in Bonzi's dedicated writable workspace folder. Bonzi cannot list arbitrary folders.",
    requiresConfirmation: false,
    similes: ['LIST_WORKSPACE_FILES', 'SHOW_WORKSPACE', 'WORKSPACE_FILES', 'workspace-list-files'],
    parameters: [
      {
        name: 'filePath',
        description:
          'Optional relative workspace directory path to list. Use an empty value for the workspace root.',
        required: false,
        schema: { type: 'string' },
        examples: ['', 'notes']
      }
    ]
  },
  {
    elizaName: 'WORKSPACE_READ_FILE',
    type: 'workspace-read-file',
    title: 'Read workspace file',
    description:
      "Ask Bonzi to read a UTF-8 text file from Bonzi's dedicated writable workspace folder. Paths must be relative and stay inside the workspace.",
    requiresConfirmation: false,
    similes: ['READ_WORKSPACE_FILE', 'OPEN_WORKSPACE_FILE', 'workspace-read-file'],
    parameters: [
      {
        name: 'filePath',
        description:
          "Relative path to a text file inside Bonzi's workspace folder, such as notes/todo.md.",
        required: true,
        schema: { type: 'string' },
        examples: ['notes/todo.md']
      }
    ],
    missingParameterMessage: 'I need a relative workspace file path before I can prepare a read action.'
  },
  {
    elizaName: 'WORKSPACE_WRITE_FILE',
    type: 'workspace-write-file',
    title: 'Write workspace file',
    description:
      "Ask Bonzi to write a UTF-8 text file inside Bonzi's dedicated writable workspace folder. Paths must be relative and stay inside the workspace.",
    requiresConfirmation: true,
    similes: ['WRITE_WORKSPACE_FILE', 'SAVE_WORKSPACE_FILE', 'CREATE_WORKSPACE_FILE', 'workspace-write-file'],
    parameters: [
      {
        name: 'filePath',
        description:
          "Relative destination path inside Bonzi's workspace folder, such as notes/todo.md. Do not use absolute paths or .. segments.",
        required: true,
        schema: { type: 'string' },
        examples: ['notes/todo.md']
      },
      {
        name: 'content',
        description: 'UTF-8 text content to write. This action is limited to small text files.',
        required: true,
        schema: { type: 'string' },
        examples: ['# Notes\n- Remember this.']
      }
    ],
    missingParameterMessage: 'I need both a relative workspace file path and file content before I can prepare a write action.'
  }
] as const satisfies readonly BonziDesktopActionSpec[]

export const ACTION_TYPE_BY_ELIZA_NAME = new Map<string, AssistantActionType>(
  BONZI_DESKTOP_ACTION_SPECS.flatMap((spec) => [
    [spec.elizaName, spec.type] as const,
    ...spec.similes.map((simile) => [simile.trim().toUpperCase(), spec.type] as const)
  ])
)

export const ACTION_SPEC_BY_TYPE = new Map<AssistantActionType, BonziDesktopActionSpec>(
  BONZI_DESKTOP_ACTION_SPECS.map((spec) => [spec.type, spec])
)
