import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { access } from 'node:fs/promises'
import { delimiter, extname, isAbsolute, join } from 'node:path'

interface VisionConfig {
  apiKey: string
  baseUrl: string
  model: string
  timeoutMs: number
}

interface ResponsesApiResponse {
  output_text?: string
  output?: Array<{
    type?: string
    content?: Array<{
      type?: string
      text?: string
    }>
  }>
  error?: {
    message?: string
    code?: string
  }
}

type RuntimeEnv = Record<string, string>

const DEFAULT_VISION_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_VISION_MODEL = 'openai-codex/gpt-5.5'
const DEFAULT_VISION_TIMEOUT_MS = 120_000

export async function describeImageWithVision(options: {
  imagePath: string
  prompt: string
}): Promise<string> {
  if (shouldUsePiVision()) {
    return describeImageWithPi(options)
  }

  return describeImageWithOpenAiResponses(options)
}

async function describeImageWithPi(options: {
  imagePath: string
  prompt: string
}): Promise<string> {
  const piCommand = await resolvePiCommand()

  if (!piCommand) {
    throw new Error('Pi CLI was not found on PATH. Set BONZI_VISION_USE_PI=0 to use direct OpenAI Responses API instead.')
  }

  const model = normalizePiModel(
    process.env.BONZI_VISION_PI_MODEL || process.env.PI_OPENAI_MODEL || DEFAULT_VISION_MODEL
  )

  try {
    return await runPiVisionCommand(piCommand, options, model)
  } catch (error) {
    if (String(error).toLowerCase().includes('model')) {
      return runPiVisionCommand(piCommand, options)
    }

    throw error
  }
}

function runPiVisionCommand(
  piCommand: string,
  options: {
    imagePath: string
    prompt: string
  },
  model?: string
): Promise<string> {
  const args = [
    '--print',
    '--no-tools',
    '--no-session',
    ...(model ? ['--model', model] : []),
    `@${options.imagePath}`,
    options.prompt
  ]

  return new Promise((resolve, reject) => {
    execFile(
      piCommand,
      args,
      {
        cwd: process.cwd(),
        env: process.env,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        timeout: parsePositiveInt(process.env.BONZI_VISION_TIMEOUT_MS, DEFAULT_VISION_TIMEOUT_MS)
      },
      (error, stdout, stderr) => {
        const text = String(stdout ?? '').trim()
        const err = String(stderr ?? '').trim()

        if (text) {
          resolve(text)
          return
        }

        if (error) {
          reject(
            new Error(
              [
                `Pi vision command failed: ${error.message}`,
                err ? `stderr:\n${truncate(err, 2_000)}` : '',
                `command: ${piCommand} ${args.map(shellQuote).join(' ')}`
              ]
                .filter(Boolean)
                .join('\n')
            )
          )
          return
        }

        reject(new Error(`Pi vision command returned no text.${err ? `\nstderr:\n${truncate(err, 2_000)}` : ''}`))
      }
    )
  })
}

async function describeImageWithOpenAiResponses(options: {
  imagePath: string
  prompt: string
}): Promise<string> {
  const config = loadVisionConfig()
  const dataUrl = imagePathToDataUrl(options.imagePath)
  const endpoint = `${config.baseUrl.replace(/\/+$/u, '')}/responses`

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.model,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: options.prompt
            },
            {
              type: 'input_image',
              image_url: dataUrl,
              detail: 'high'
            }
          ]
        }
      ]
    }),
    signal: AbortSignal.timeout(config.timeoutMs)
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(
      `Vision request failed: ${response.status} ${response.statusText}${
        errorText ? `\n${truncate(errorText, 1_500)}` : ''
      }`
    )
  }

  const data = (await response.json()) as ResponsesApiResponse

  if (data.error) {
    throw new Error(
      `Vision request failed: ${data.error.message ?? data.error.code ?? 'Unknown API error'}`
    )
  }

  const text = extractResponseText(data).trim()

  if (!text) {
    throw new Error('Vision request returned no text.')
  }

  return text
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/u.test(value)) {
    return value
  }

  return `'${value.replaceAll("'", "'\''")}'`
}

function normalizePiModel(model: string): string {
  return model === 'chatgpt-5.5' ? 'openai-codex/gpt-5.5' : model
}

function shouldUsePiVision(): boolean {
  const value = process.env.BONZI_VISION_USE_PI?.trim().toLowerCase()
  return value !== '0' && value !== 'false' && value !== 'no'
}

async function resolvePiCommand(): Promise<string | null> {
  const explicit = process.env.BONZI_VISION_PI_COMMAND?.trim()

  if (explicit) {
    return explicit
  }

  for (const pathEntry of (process.env.PATH ?? '').split(delimiter)) {
    if (!pathEntry || !isAbsolute(pathEntry)) {
      continue
    }

    const candidate = join(pathEntry, 'pi')

    try {
      await access(candidate)
      return candidate
    } catch {
      // keep looking
    }
  }

  return null
}

function loadVisionConfig(): VisionConfig {
  const env = loadRuntimeEnv()
  const apiKey =
    env.BONZI_VISION_API_KEY?.trim() ||
    env.PI_OPENAI_API_KEY?.trim() ||
    env.OPENAI_API_KEY?.trim() ||
    env.BONZI_OPENAI_API_KEY?.trim()

  if (!apiKey) {
    throw new Error(
      'Vision is not configured. Set BONZI_VISION_API_KEY, PI_OPENAI_API_KEY, OPENAI_API_KEY, or BONZI_OPENAI_API_KEY.'
    )
  }

  return {
    apiKey,
    baseUrl:
      env.BONZI_VISION_BASE_URL?.trim() ||
      env.PI_OPENAI_BASE_URL?.trim() ||
      env.OPENAI_BASE_URL?.trim() ||
      DEFAULT_VISION_BASE_URL,
    model:
      env.BONZI_VISION_MODEL?.trim() ||
      env.PI_OPENAI_MODEL?.trim() ||
      DEFAULT_VISION_MODEL,
    timeoutMs: parsePositiveInt(env.BONZI_VISION_TIMEOUT_MS, DEFAULT_VISION_TIMEOUT_MS)
  }
}

function imagePathToDataUrl(path: string): string {
  const bytes = readFileSync(path)
  const mimeType = mimeTypeForPath(path)

  return `data:${mimeType};base64,${bytes.toString('base64')}`
}

function mimeTypeForPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    case '.png':
    default:
      return 'image/png'
  }
}

function extractResponseText(data: ResponsesApiResponse): string {
  if (typeof data.output_text === 'string') {
    return data.output_text
  }

  return (data.output ?? [])
    .flatMap((item) => item.content ?? [])
    .flatMap((content) =>
      typeof content.text === 'string' ? [content.text] : []
    )
    .join('\n')
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

function loadDotEnv(path: string): RuntimeEnv {
  if (!existsSync(path)) {
    return {}
  }

  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split(/\r?\n/u)
      .flatMap((line) => parseDotEnvLine(line))
  )
}

function parseDotEnvLine(line: string): [string, string][] {
  const trimmed = line.trim()

  if (!trimmed || trimmed.startsWith('#')) {
    return []
  }

  const separatorIndex = trimmed.indexOf('=')

  if (separatorIndex <= 0) {
    return []
  }

  const key = trimmed.slice(0, separatorIndex).trim()
  let value = trimmed.slice(separatorIndex + 1).trim()

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1)
  }

  return [[key, value]]
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value)

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }

  return Math.round(parsed)
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength - 1)}…`
}
