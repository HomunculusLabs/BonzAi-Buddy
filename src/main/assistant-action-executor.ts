import { clipboard, shell, type BrowserWindow } from 'electron'
import type {
  AssistantAction,
  AssistantActionParams,
  AssistantActionType,
  ShellState
} from '../shared/contracts'
import {
  captureDiscordScreenshot,
  checkCuaDriverStatus,
  scrollDiscord,
  snapshotDiscordState
} from './cua-driver'
import type { DiscordBrowserActionService } from './discord-browser-service'
import {
  normalizeScrollDirection,
  normalizeText,
  sanitizeAssistantActionParams,
  truncate
} from './assistant-action-param-utils'
import { describeImageWithVision } from './vision-client'
import type { BonziWorkspaceFileService } from './bonzi-workspace-file-service'

interface AssistantActionExecutorDeps {
  shellState: ShellState
  companionWindow: BrowserWindow | null
  discordBrowserService: DiscordBrowserActionService
  workspaceFileService: BonziWorkspaceFileService
}

export interface WorkflowBonziDesktopActionProposal {
  type: AssistantActionType
  requiresConfirmation?: boolean
  params?: AssistantActionParams
}

export async function executeWorkflowBonziDesktopAction(
  proposal: WorkflowBonziDesktopActionProposal,
  deps: AssistantActionExecutorDeps,
  options: { approved: boolean }
): Promise<string> {
  const params = sanitizeAssistantActionParams(proposal.params)
  const requiresConfirmation =
    proposal.requiresConfirmation === true || requiresConfirmationByPolicy(proposal.type)

  if (requiresConfirmation && !options.approved) {
    throw new Error(
      `Workflow approval is required before executing ${proposal.type}.`
    )
  }

  const action: AssistantAction = {
    id: 'workflow-bonzi-desktop-action',
    type: proposal.type,
    title: `Workflow ${proposal.type}`,
    description: 'Workflow-executed Bonzi desktop action.',
    requiresConfirmation,
    status: 'pending',
    ...(params ? { params } : {})
  }

  return executeAssistantAction(action, deps)
}

export async function executeAssistantAction(
  action: AssistantAction,
  deps: AssistantActionExecutorDeps
): Promise<string> {
  switch (action.type) {
    case 'report-shell-state':
      return [
        `Stage: ${deps.shellState.stage}`,
        `Platform: ${deps.shellState.platform}`,
        `VRM asset: ${deps.shellState.vrmAssetPath}`,
        `Workspace: ${deps.workspaceFileService.getWorkspaceDir()}`,
        `Provider: ${deps.shellState.assistant.provider.label}`,
        `Runtime: ${deps.shellState.assistant.runtime.backend} / ${deps.shellState.assistant.runtime.state}`
      ].join('\n')
    case 'copy-vrm-asset-path':
      clipboard.writeText(deps.shellState.vrmAssetPath)
      return `Copied the bundled VRM asset path to the clipboard: ${deps.shellState.vrmAssetPath}`
    case 'minimize-window':
      if (!deps.companionWindow || deps.companionWindow.isDestroyed()) {
        throw new Error('Bonzi companion window is not available to minimize.')
      }
      deps.companionWindow.minimize()
      return 'Bonzi companion window minimized.'
    case 'close-window':
      if (!deps.companionWindow || deps.companionWindow.isDestroyed()) {
        throw new Error('Bonzi companion window is not available to close.')
      }
      deps.companionWindow.close()
      return 'Bonzi companion window closed.'
    case 'open-url': {
      const url = resolveSafeHttpUrl(action.params?.url)
      if (isDiscordWebUrl(url)) {
        return deps.discordBrowserService.open({ url: url.toString() })
      }
      await shell.openExternal(url.toString())
      return `Opened ${url.toString()} in your default browser.`
    }
    case 'search-web': {
      const target = createSafeSearchTarget(action.params?.query)
      await shell.openExternal(target.url.toString())
      return `Opened a web search for: ${target.query}`
    }
    case 'cua-check-status':
      return checkCuaDriverStatus()
    case 'discord-snapshot':
      return snapshotDiscordState(action.params?.query)
    case 'discord-read-context':
      return deps.discordBrowserService.readContext({
        url: action.params?.url,
        query: action.params?.query
      })
    case 'discord-read-screenshot':
      return readDiscordScreenshotWithVision(action.params?.query)
    case 'discord-scroll':
      return scrollDiscord(resolveDiscordScrollDirection(action.params?.direction), action.params?.amount)
    case 'discord-type-draft':
      return deps.discordBrowserService.typeDraft({
        url: action.params?.url,
        text: action.params?.text ?? ''
      })
    case 'workspace-list-files':
      return deps.workspaceFileService.listFiles({
        directoryPath: action.params?.filePath
      })
    case 'workspace-read-file':
      return deps.workspaceFileService.readTextFile({
        filePath: action.params?.filePath ?? ''
      })
    case 'workspace-write-file':
      return deps.workspaceFileService.writeTextFile({
        filePath: action.params?.filePath ?? '',
        content: action.params?.content ?? ''
      })
    default:
      return assertNever(action.type)
  }
}

async function readDiscordScreenshotWithVision(query: string | undefined): Promise<string> {
  const screenshot = await captureDiscordScreenshot(query)
  const prompt = [
    'You are reading a screenshot of Discord for Bonzi, a desktop assistant.',
    'Extract the visible conversation context precisely enough for Bonzi to draft a relevant reply.',
    'Focus on channel/server names, visible usernames, timestamps if visible, message text, and the latest actionable request.',
    'If text is unclear, say what is uncertain. Do not invent unseen messages.',
    query ? `User request: ${query}` : ''
  ]
    .filter(Boolean)
    .join('\n')
  const visualReadback = await describeImageWithVision({
    imagePath: screenshot.imagePath,
    prompt
  })

  return [
    `Vision readback for Discord (${screenshot.targetDescription}):`,
    visualReadback,
    '',
    'Cua accessibility context:',
    screenshot.stateText
  ].join('\n')
}

function requiresConfirmationByPolicy(type: AssistantActionType): boolean {
  return type === 'close-window' || type === 'workspace-write-file'
}

function resolveSafeHttpUrl(rawUrl: unknown): URL {
  const input = normalizeText(rawUrl)

  if (!input) {
    throw new Error('Cannot open a browser URL because no URL was provided.')
  }

  if (input.length > 2_048) {
    throw new Error('Cannot open a browser URL longer than 2048 characters.')
  }

  if (/\s/.test(input)) {
    throw new Error('Cannot open a browser URL containing whitespace.')
  }

  const withScheme = input.includes('://') ? input : `https://${input}`
  let url: URL

  try {
    url = new URL(withScheme)
  } catch {
    throw new Error('Cannot open an invalid browser URL.')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Bonzi can only open http and https URLs.')
  }

  if (!url.hostname) {
    throw new Error('Cannot open a browser URL without a hostname.')
  }

  if (url.username || url.password) {
    throw new Error('Bonzi does not open URLs with embedded credentials.')
  }

  return url
}

function isDiscordWebUrl(url: URL): boolean {
  return url.protocol === 'https:'
    && (url.hostname === 'discord.com' || url.hostname === 'discordapp.com')
}

function createSafeSearchTarget(rawQuery: unknown): { query: string; url: URL } {
  const query = normalizeText(rawQuery)

  if (!query) {
    throw new Error('Cannot search the web because no query was provided.')
  }

  const normalizedQuery = truncate(query, 500)
  const url = new URL('https://www.google.com/search')
  url.searchParams.set('q', normalizedQuery)

  return { query: normalizedQuery, url }
}

function resolveDiscordScrollDirection(value: unknown): 'up' | 'down' {
  const direction = normalizeScrollDirection(value)

  if (!direction) {
    throw new Error('Discord scroll actions require direction to be up or down.')
  }

  return direction
}

function assertNever(value: never): never {
  throw new Error(`Unsupported action: ${String(value)}`)
}
