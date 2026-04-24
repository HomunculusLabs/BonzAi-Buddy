import { clipboard, type BrowserWindow } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ASSISTANT_ACTION_TYPES,
  type AssistantAction,
  type AssistantActionExecutionRequest,
  type AssistantActionExecutionResponse,
  type AssistantActionType,
  type AssistantCommandRequest,
  type AssistantCommandResponse,
  type AssistantMessage,
  type AssistantProviderInfo,
  type AssistantProviderKind,
  type ShellState
} from '../shared/contracts'

const DEFAULT_OPENAI_BASE_URL = 'https://api.z.ai/api/coding/paas/v4'
const DEFAULT_OPENAI_MODEL = 'GLM-5.1'
const DEFAULT_SYSTEM_PROMPT = `You are Bonzi, a desktop companion assistant.
Respond with JSON only using this shape:
{"reply":"string","actions":[{"type":"report-shell-state","title":"string","description":"string","requiresConfirmation":false}]}

Rules:
- Only propose actions from this allowlist: ${ASSISTANT_ACTION_TYPES.join(', ')}.
- Never propose shell commands, file writes, network calls, or any unrestricted execution.
- Keep actions optional; return an empty array when none are needed.
- "close-window" must be treated as a confirmation-gated action.`

type RuntimeEnv = Record<string, string>

interface AssistantProviderTurn {
  reply: string
  actions: ProposedAction[]
  warnings: string[]
}

interface AssistantProvider {
  info: AssistantProviderInfo
  generateResponse: (
    request: AssistantCommandRequest,
    shellState: ShellState
  ) => Promise<AssistantProviderTurn>
}

interface ProposedAction {
  type: AssistantActionType
  title?: string
  description?: string
  requiresConfirmation?: boolean
}

interface AssistantServiceOptions {
  getCompanionWindow: () => BrowserWindow | null
  getShellState: () => ShellState
}

interface AssistantProviderSelection {
  provider: AssistantProvider
  warnings: string[]
}

const ACTION_DEFAULTS: Record<
  AssistantActionType,
  Omit<AssistantAction, 'id' | 'status' | 'resultMessage'>
> = {
  'report-shell-state': {
    type: 'report-shell-state',
    title: 'Report shell state',
    description: 'Summarize the current platform, stage, asset path, and active provider.',
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
  sendCommand: (
    request: AssistantCommandRequest
  ) => Promise<AssistantCommandResponse>
  executeAction: (
    request: AssistantActionExecutionRequest
  ) => Promise<AssistantActionExecutionResponse>
}

export function createAssistantService(
  options: AssistantServiceOptions
): AssistantService {
  const env = loadRuntimeEnv()
  const providerSelection = selectProvider(env)
  const pendingActions = new Map<string, AssistantAction>()

  return {
    getProviderInfo: () => providerSelection.provider.info,
    getStartupWarnings: () => [...providerSelection.warnings],
    async sendCommand(
      request: AssistantCommandRequest
    ): Promise<AssistantCommandResponse> {
      const normalizedRequest = normalizeCommandRequest(request)

      if (normalizedRequest.error) {
        return {
          ok: false,
          provider: providerSelection.provider.info,
          error: normalizedRequest.error,
          actions: [],
          warnings: []
        }
      }

      try {
        const providerTurn = await providerSelection.provider.generateResponse(
          normalizedRequest,
          options.getShellState()
        )

        const actions = providerTurn.actions.map((action) => {
          const normalized = createPendingAction(action)
          pendingActions.set(normalized.id, normalized)
          return normalized
        })

        return {
          ok: true,
          provider: providerSelection.provider.info,
          reply: createAssistantMessage('assistant', providerTurn.reply),
          actions,
          warnings: providerTurn.warnings
        }
      } catch (error) {
        return {
          ok: false,
          provider: providerSelection.provider.info,
          error: normalizeError(error),
          actions: [],
          warnings: []
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
    }
  }
}

function sanitizeHistory(history: AssistantMessage[]): AssistantMessage[] {
  return history
    .filter(
      (message) => message.role === 'user' || message.role === 'assistant'
    )
    .slice(-10)
}

function normalizeCommandRequest(request: unknown): {
  command: string
  history: AssistantMessage[]
  error?: string
} {
  if (!isRecord(request)) {
    return {
      command: '',
      history: [],
      error: 'Malformed assistant request.'
    }
  }

  const command = typeof request.command === 'string' ? request.command.trim() : ''

  if (!command) {
    return {
      command: '',
      history: [],
      error: 'Enter a command before sending it to the assistant.'
    }
  }

  const history = Array.isArray(request.history)
    ? sanitizeHistory(
        request.history.flatMap((message) => normalizeHistoryMessage(message))
      )
    : []

  return {
    command: truncate(command, 2_000),
    history
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

function normalizeHistoryMessage(message: unknown): AssistantMessage[] {
  if (!isRecord(message)) {
    return []
  }

  if (
    message.role !== 'user' &&
    message.role !== 'assistant' &&
    message.role !== 'system'
  ) {
    return []
  }

  if (typeof message.content !== 'string' || !message.content.trim()) {
    return []
  }

  return [
    {
      id:
        typeof message.id === 'string' && message.id.trim()
          ? message.id
          : crypto.randomUUID(),
      role: message.role,
      content: truncate(message.content.trim(), 4_000),
      createdAt:
        typeof message.createdAt === 'string' && message.createdAt.trim()
          ? message.createdAt
          : new Date().toISOString()
    }
  ]
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

function createPendingAction(action: ProposedAction): AssistantAction {
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
        `Provider: ${shellState.assistant.provider.label}`
      ].join('\n')
    case 'copy-vrm-asset-path':
      clipboard.writeText(shellState.vrmAssetPath)
      return `Copied the bundled VRM asset path to the clipboard: ${shellState.vrmAssetPath}`
    case 'minimize-window':
      companionWindow?.minimize()
      return 'Bonzi companion window minimized.'
    case 'close-window':
      companionWindow?.close()
      return 'Bonzi companion window closed.'
    default:
      return assertNever(action.type)
  }
}

function selectProvider(env: RuntimeEnv): AssistantProviderSelection {
  const requestedProvider = normalizeProviderKind(
    env.BONZI_ASSISTANT_PROVIDER
  )

  if (requestedProvider === 'openai-compatible') {
    const apiKey = env.BONZI_OPENAI_API_KEY?.trim()
    const model = env.BONZI_OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL
    const baseUrl =
      env.BONZI_OPENAI_BASE_URL?.trim() || DEFAULT_OPENAI_BASE_URL

    if (!apiKey) {
      return {
        provider: createMockProvider('Mock provider (fallback)'),
        warnings: [
          'BONZI_ASSISTANT_PROVIDER=openai-compatible was requested, but BONZI_OPENAI_API_KEY is missing. Falling back to the mock provider.'
        ]
      }
    }

    return {
      provider: createOpenAiCompatibleProvider({
        apiKey,
        baseUrl,
        model,
        systemPrompt:
          env.BONZI_OPENAI_SYSTEM_PROMPT?.trim() || DEFAULT_SYSTEM_PROMPT
      }),
      warnings: []
    }
  }

  return {
    provider: createMockProvider(),
    warnings: []
  }
}

function createMockProvider(label = 'Mock provider'): AssistantProvider {
  return {
    info: {
      kind: 'mock',
      label
    },
    async generateResponse(
      request: AssistantCommandRequest,
      shellState: ShellState
    ): Promise<AssistantProviderTurn> {
      const command = request.command.toLowerCase()
      const actions: ProposedAction[] = []
      const replySegments: string[] = []

      if (
        command.includes('state') ||
        command.includes('status') ||
        command.includes('platform')
      ) {
        actions.push({ type: 'report-shell-state' })
        replySegments.push(
          'I can summarize the current shell state through the allowlisted state-report action.'
        )
      }

      if (
        (command.includes('copy') && command.includes('path')) ||
        command.includes('asset path')
      ) {
        actions.push({ type: 'copy-vrm-asset-path' })
        replySegments.push(
          'I can copy the bundled VRM asset path without touching the filesystem or shell.'
        )
      }

      if (command.includes('minimize')) {
        actions.push({ type: 'minimize-window' })
        replySegments.push(
          'I can minimize the companion window through the typed allowlist.'
        )
      }

      if (command.includes('close') || command.includes('quit')) {
        actions.push({
          type: 'close-window',
          description:
            'Close the Bonzi companion window. This action is confirmation-gated.',
          requiresConfirmation: true
        })
        replySegments.push(
          'Closing the window is possible, but it stays behind an explicit confirmation step.'
        )
      }

      if (replySegments.length === 0) {
        replySegments.push(
          `Mock provider active. I received "${request.command}" and can safely suggest allowlisted desktop actions.`
        )
        replySegments.push(
          `Try "show shell state", "copy asset path", or "minimize window". Provider: ${shellState.assistant.provider.label}.`
        )
      }

      return {
        reply: replySegments.join(' '),
        actions: dedupeActions(actions),
        warnings: []
      }
    }
  }
}

function createOpenAiCompatibleProvider(config: {
  apiKey: string
  baseUrl: string
  model: string
  systemPrompt: string
}): AssistantProvider {
  const normalizedBaseUrl = config.baseUrl.replace(/\/$/, '')

  return {
    info: {
      kind: 'openai-compatible',
      label: `OpenAI-compatible (${config.model})`
    },
    async generateResponse(
      request: AssistantCommandRequest,
      shellState: ShellState
    ): Promise<AssistantProviderTurn> {
      const response = await fetch(`${normalizedBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
          model: config.model,
          temperature: 0.3,
          messages: [
            {
              role: 'system',
              content: buildSystemPrompt(config.systemPrompt, shellState)
            },
            ...request.history.map((message) => ({
              role: message.role,
              content: message.content
            })),
            {
              role: 'user',
              content: request.command
            }
          ]
        })
      })

      if (!response.ok) {
        throw new Error(
          `OpenAI-compatible request failed (${response.status}): ${truncate(
            await response.text(),
            280
          )}`
        )
      }

      const payload = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?:
              | string
              | Array<{
                  type?: string
                  text?: string
                }>
          }
        }>
      }

      const rawContent = extractCompletionContent(payload)
      const parsed = parseProviderJson(rawContent)

      return {
        reply: parsed.reply,
        actions: sanitizeProposedActions(parsed.actions),
        warnings: parsed.warning ? [parsed.warning] : []
      }
    }
  }
}

function buildSystemPrompt(
  basePrompt: string,
  shellState: ShellState
): string {
  return `${basePrompt}

Current shell state:
${JSON.stringify(shellState, null, 2)}`
}

function extractCompletionContent(payload: {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>
    }
  }>
}): string {
  const content = payload.choices?.[0]?.message?.content

  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n')
  }

  throw new Error('Provider response did not include assistant content.')
}

function parseProviderJson(content: string): {
  reply: string
  actions: ProposedAction[]
  warning?: string
} {
  const cleaned = stripCodeFence(content)

  try {
    const parsed = JSON.parse(cleaned) as {
      reply?: unknown
      actions?: unknown
    }

    return {
      reply:
        typeof parsed.reply === 'string' && parsed.reply.trim()
          ? parsed.reply.trim()
          : 'The provider returned JSON without a usable reply.',
      actions: Array.isArray(parsed.actions)
        ? sanitizeProposedActions(parsed.actions)
        : []
    }
  } catch {
    return {
      reply: content.trim() || 'The provider returned an empty response.',
      actions: [],
      warning:
        'Provider returned non-JSON text, so assistant actions were disabled for this turn.'
    }
  }
}

function sanitizeProposedActions(actions: unknown[]): ProposedAction[] {
  return dedupeActions(
    actions.flatMap((action) => {
      if (!isRecord(action)) {
        return []
      }

      const type = action.type

      if (!isAssistantActionType(type)) {
        return []
      }

      return [
        {
          type,
          title: typeof action.title === 'string' ? action.title : undefined,
          description:
            typeof action.description === 'string'
              ? action.description
              : undefined,
          requiresConfirmation:
            typeof action.requiresConfirmation === 'boolean'
              ? action.requiresConfirmation
              : undefined
        }
      ]
    })
  )
}

function dedupeActions(actions: ProposedAction[]): ProposedAction[] {
  const seen = new Set<AssistantActionType>()

  return actions.filter((action) => {
    if (seen.has(action.type)) {
      return false
    }

    seen.add(action.type)
    return true
  })
}

function loadRuntimeEnv(): RuntimeEnv {
  const fileEnv = loadDotEnv(join(process.cwd(), '.env'))
  const processEnv = Object.fromEntries(
    Object.entries(process.env).flatMap(([key, value]) =>
      typeof value === 'string' ? [[key, value]] : []
    )
  )

  return {
    ...fileEnv,
    ...processEnv
  }
}

function loadDotEnv(filePath: string): RuntimeEnv {
  if (!existsSync(filePath)) {
    return {}
  }

  return readFileSync(filePath, 'utf8')
    .split(/\r?\n/u)
    .reduce<RuntimeEnv>((env, line) => {
      const trimmed = line.trim()

      if (!trimmed || trimmed.startsWith('#')) {
        return env
      }

      const normalized = trimmed.startsWith('export ')
        ? trimmed.slice('export '.length)
        : trimmed
      const separatorIndex = normalized.indexOf('=')

      if (separatorIndex <= 0) {
        return env
      }

      const key = normalized.slice(0, separatorIndex).trim()
      const rawValue = normalized.slice(separatorIndex + 1).trim()
      env[key] = stripWrappingQuotes(rawValue)
      return env
    }, {})
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }

  return value
}

function stripCodeFence(content: string): string {
  const trimmed = content.trim()

  if (!trimmed.startsWith('```')) {
    return trimmed
  }

  return trimmed.replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, '')
}

function normalizeProviderKind(value: string | undefined): AssistantProviderKind {
  return value === 'openai-compatible' ? 'openai-compatible' : 'mock'
}

function isAssistantActionType(value: unknown): value is AssistantActionType {
  return (
    typeof value === 'string' &&
    (ASSISTANT_ACTION_TYPES as readonly string[]).includes(value)
  )
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
