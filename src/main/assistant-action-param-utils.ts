import type { AssistantActionParams } from '../shared/contracts'

export function sanitizeAssistantActionParams(
  value: unknown
): AssistantActionParams | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const url = normalizeText(value.url)
  const query = normalizeText(value.query)
  const prompt = normalizePromptText(value.prompt)
  const surfCommand = normalizeSurfCommand(value.surfCommand)
  const surfArgs = normalizeSurfArgs(value.surfArgs)
  const direction = normalizeScrollDirection(value.direction)
  const amount = normalizeScrollAmount(value.amount)
  const text = normalizeDiscordDraftText(value.text)
  const filePath = normalizeWorkspaceFilePath(value.filePath)
  const hasContent = typeof value.content === 'string'
  const content = hasContent ? normalizeWorkspaceFileContent(value.content) : undefined
  const params: AssistantActionParams = {}

  if (url) {
    params.url = truncate(url, 2_048)
  }

  if (query) {
    params.query = truncate(query, 500)
  }

  if (prompt) {
    params.prompt = truncate(prompt, 24_000)
  }

  if (surfCommand) {
    params.surfCommand = truncate(surfCommand, 80)
  }

  if (surfArgs.length > 0) {
    params.surfArgs = surfArgs.map((arg) => truncate(arg, 2_000))
  }

  if (direction) {
    params.direction = direction
  }

  if (amount !== undefined) {
    params.amount = amount
  }

  if (text) {
    params.text = truncate(text, 2_000)
  }

  if (filePath) {
    params.filePath = truncate(filePath, 500)
  }

  if (hasContent) {
    params.content = truncate(content ?? '', 20_000)
  }

  return hasAssistantActionParams(params) ? params : undefined
}

export function hasAssistantActionParams(
  params: AssistantActionParams | undefined
): params is AssistantActionParams {
  return Boolean(
    params?.url ||
      params?.query ||
      params?.prompt ||
      params?.surfCommand ||
      (params?.surfArgs !== undefined && params.surfArgs.length > 0) ||
      params?.direction ||
      params?.amount !== undefined ||
      params?.text ||
      params?.filePath ||
      params?.content !== undefined
  )
}

export function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizePromptText(value: unknown): string {
  const text = normalizeText(value)

  if (!text) {
    return ''
  }

  return text.replace(/\u0000/gu, '')
}

export function normalizeSurfCommand(value: unknown): string {
  const command = normalizeText(value).toLowerCase()

  if (!command || /[^a-z0-9.-]/u.test(command)) {
    return ''
  }

  return command
}

export function normalizeSurfArgs(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((arg) => normalizeText(arg))
    .filter((arg) => Boolean(arg) && !/[\u0000\r\n]/u.test(arg))
    .slice(0, 12)
}

export function normalizeScrollDirection(
  value: unknown
): 'up' | 'down' | undefined {
  const direction = normalizeText(value).toLowerCase()

  if (direction === 'up' || direction === 'down') {
    return direction
  }

  return undefined
}

export function normalizeScrollAmount(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  const normalizedText = normalizeText(value)

  if (typeof value !== 'number' && !normalizedText) {
    return undefined
  }

  const amount = typeof value === 'number' ? value : Number(normalizedText)

  if (!Number.isFinite(amount)) {
    return undefined
  }

  return Math.max(1, Math.min(10, Math.round(amount)))
}

export function normalizeDiscordDraftText(value: unknown): string {
  const text = normalizeText(value)

  if (/[\r\n\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u.test(text)) {
    return ''
  }

  return text
}

export function normalizeWorkspaceFilePath(value: unknown): string {
  const text = normalizeText(value).replace(/\\/gu, '/')

  if (!text || /[\x00-\x1F\x7F]/u.test(text)) {
    return ''
  }

  return text
}

export function normalizeWorkspaceFileContent(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }

  return value.replace(/\r\n?/gu, '\n').replace(/\u0000/gu, '')
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength - 1)}…`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
