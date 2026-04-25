import type { AssistantActionParams } from '../shared/contracts'

export function sanitizeAssistantActionParams(
  value: unknown
): AssistantActionParams | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const url = normalizeText(value.url)
  const query = normalizeText(value.query)
  const direction = normalizeScrollDirection(value.direction)
  const amount = normalizeScrollAmount(value.amount)
  const text = normalizeDiscordDraftText(value.text)
  const params: AssistantActionParams = {}

  if (url) {
    params.url = truncate(url, 2_048)
  }

  if (query) {
    params.query = truncate(query, 500)
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

  return hasAssistantActionParams(params) ? params : undefined
}

export function hasAssistantActionParams(
  params: AssistantActionParams | undefined
): params is AssistantActionParams {
  return Boolean(
    params?.url ||
      params?.query ||
      params?.direction ||
      params?.amount !== undefined ||
      params?.text
  )
}

export function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
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
  const amount = typeof value === 'number' ? value : Number(normalizeText(value))

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

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength - 1)}…`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
