import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { HermesResolvedConfig } from './hermes-config'

const execFileAsync = promisify(execFile)

export interface HermesMessageInput {
  prompt: string
}

export interface HermesMessageOutput {
  text?: string
  actions?: unknown[]
  toolCalls?: unknown[]
  warnings?: string[]
  rawText?: string
}

export interface HermesAgentClient {
  initialize(config: HermesResolvedConfig): Promise<void>
  sendMessage(input: HermesMessageInput): Promise<HermesMessageOutput>
  reset(): Promise<void>
  dispose(): Promise<void>
}

export class HermesCliAgentClient implements HermesAgentClient {
  private config: HermesResolvedConfig | null = null

  async initialize(config: HermesResolvedConfig): Promise<void> {
    this.config = config

    if (config.e2eMode || config.gateway.enabled) {
      return
    }

    await execFileAsync(config.cliPath, ['--version'], {
      cwd: config.cwd,
      timeout: 5_000,
      maxBuffer: 256 * 1024
    })
  }

  async sendMessage(input: HermesMessageInput): Promise<HermesMessageOutput> {
    const config = this.requireConfig()

    if (config.e2eMode) {
      return { text: input.prompt }
    }

    if (config.gateway.enabled) {
      return runHermesGateway(config, input.prompt)
    }

    const args = buildHermesArgs(config, input.prompt)
    const result = await runHermes(config, args)
    const rawText = String(result.stdout ?? '').trim()
    const parsed = parseHermesOutput(rawText)

    return {
      ...parsed,
      rawText
    }
  }

  async reset(): Promise<void> {
    // One-shot CLI calls are stateless from Bonzi's perspective. OG Bonzi does
    // not persist Hermes-local conversation history; Eliza owns persistent memory.
  }

  async dispose(): Promise<void> {
    this.config = null
  }

  private requireConfig(): HermesResolvedConfig {
    if (!this.config) {
      throw new Error('Hermes client has not been initialized.')
    }

    return this.config
  }
}

function buildHermesArgs(config: HermesResolvedConfig, prompt: string): string[] {
  const args: string[] = []

  if (config.profile) {
    args.push('--profile', config.profile)
  }

  if (config.model) {
    args.push('--model', config.model)
  }

  if (config.providerOverride) {
    args.push('--provider', config.providerOverride)
  }

  // Let Hermes load its normal profile, memory, skills, and rules even in the
  // CLI fallback. Bonzi constrains Hermes' role with the consultation prompt;
  // it should not strip the user-configured Hermes context.
  args.push('-z', prompt)
  return args
}

async function runHermesGateway(
  config: HermesResolvedConfig,
  prompt: string
): Promise<HermesMessageOutput> {
  const endpoint = joinGatewayPath(config.gateway.baseUrl, 'chat/completions')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }
  if (config.gateway.apiKey) {
    headers.Authorization = `Bearer ${config.gateway.apiKey}`
  }

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model || 'hermes-agent',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        stream: false
      }),
      signal: AbortSignal.timeout(config.timeoutMs)
    })
  } catch (error) {
    throw new Error(
      [
        `Hermes API server request failed (${endpoint}): ${error instanceof Error ? error.message : String(error)}`,
        'Bonzi uses Hermes’ OpenAI-compatible API server for non-CLI consultations, not the messaging webhook port.',
        'Enable it with API_SERVER_ENABLED=true and API_SERVER_KEY in ~/.hermes/.env, then restart `hermes gateway`.'
      ].join(' ')
    )
  }

  const rawText = await response.text()
  if (!response.ok) {
    throw new Error(
      `Hermes API server failed (${endpoint}): HTTP ${response.status} ${response.statusText}; body: ${truncateError(rawText)}`
    )
  }

  const parsedJson = parseJsonObject(rawText)
  if (!parsedJson) {
    return {
      ...parseHermesOutput(rawText),
      rawText
    }
  }

  const content = extractGatewayContent(parsedJson)
  const parsedContent = parseHermesOutput(content || rawText)
  return {
    ...parsedContent,
    rawText,
    ...(content ? { text: parsedContent.text ?? content } : {})
  }
}

async function runHermes(
  config: HermesResolvedConfig,
  args: string[]
): Promise<{ stdout: string | Buffer; stderr: string | Buffer }> {
  try {
    return await execFileAsync(config.cliPath, args, {
      cwd: config.cwd,
      timeout: config.timeoutMs,
      maxBuffer: 1024 * 1024
    })
  } catch (error) {
    const err = error as {
      code?: unknown
      signal?: unknown
      killed?: unknown
      stdout?: unknown
      stderr?: unknown
      message?: unknown
    }
    const stdout = String(err.stdout ?? '').trim()
    const stderr = String(err.stderr ?? '').trim()
    const timedOut = err.killed === true && err.signal === 'SIGTERM'
    const details = [
      timedOut ? `timed out after ${config.timeoutMs}ms` : '',
      stderr ? `stderr: ${truncateError(stderr)}` : '',
      stdout ? `stdout: ${truncateError(stdout)}` : '',
      err.code !== undefined ? `exit code: ${String(err.code)}` : '',
      err.signal !== undefined ? `signal: ${String(err.signal)}` : '',
      err.message ? `message: ${truncateError(String(err.message))}` : ''
    ].filter(Boolean)

    throw new Error(
      `Hermes CLI ${timedOut ? 'timed out' : 'failed'} (${config.cliPath} ${args.slice(0, -1).join(' ')} <prompt>): ${details.join('; ') || 'unknown error'}`
    )
  }
}

function truncateError(value: string): string {
  return value.length > 1_000 ? `${value.slice(0, 999)}…` : value
}

function extractGatewayContent(value: Record<string, unknown>): string {
  const direct = normalizeOptionalString(value.reply) || normalizeOptionalString(value.text)
  if (direct) {
    return direct
  }

  const choices = Array.isArray(value.choices) ? value.choices : []
  const firstChoice = choices.find(isRecord)
  if (!firstChoice) {
    return ''
  }

  const message = isRecord(firstChoice.message) ? firstChoice.message : null
  const content = message ? normalizeOptionalString(message.content) : ''
  return content || normalizeOptionalString(firstChoice.text)
}

function joinGatewayPath(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/u, '')}/${path.replace(/^\/+/, '')}`
}

function parseHermesOutput(rawText: string): HermesMessageOutput {
  const parsedJson = parseJsonObject(extractJsonCandidate(rawText))

  if (!parsedJson) {
    return { text: rawText }
  }

  const text = normalizeOptionalString(parsedJson.reply) || normalizeOptionalString(parsedJson.text)
  const actions = arrayFromUnknown(parsedJson.actions)
  const toolCalls = arrayFromUnknown(parsedJson.toolCalls ?? parsedJson.tool_calls)
  const warnings = arrayFromUnknown(parsedJson.warnings).flatMap((warning) => {
    const normalized = normalizeOptionalString(warning)
    return normalized ? [normalized] : []
  })

  return {
    ...(text ? { text } : {}),
    ...(actions.length > 0 ? { actions } : {}),
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
    ...(warnings.length > 0 ? { warnings } : {})
  }
}

function extractJsonCandidate(rawText: string): string {
  const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/iu)?.[1]
  if (fenced) {
    return fenced.trim()
  }

  return rawText.trim()
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function arrayFromUnknown(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function normalizeOptionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
