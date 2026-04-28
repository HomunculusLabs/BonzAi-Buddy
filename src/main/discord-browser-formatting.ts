import type {
  DiscordDomContextSnapshot,
  DiscordDomDraftResult,
  DiscordDomMessage
} from './discord-browser-scripts'

const MAX_CONTEXT_CHARS = 8_000
const MAX_MESSAGE_TEXT_CHARS = 800
const MAX_DRAFT_CHARS = 2_000

export function formatDiscordLoginRequired(
  snapshot: DiscordDomContextSnapshot,
  options: { showWindowForLogin: boolean }
): string {
  return [
    'Discord Web is not authenticated in Bonzi\'s browser session yet, or no readable chat DOM was found.',
    `Source: ${snapshot.url}`,
    options.showWindowForLogin
      ? 'A Discord browser window has been opened. Log in there, navigate to the target chat, then run this action again.'
      : 'Log into Discord Web in Bonzi\'s browser session, navigate to the target chat, then run this action again.',
    'No messages were read or sent.',
    snapshot.warnings.length > 0 ? `Warnings: ${snapshot.warnings.join(' | ')}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

export function formatDiscordContext(
  snapshot: DiscordDomContextSnapshot,
  query: string | undefined
): string {
  const lines = [
    'Discord Web DOM context',
    `Source: ${snapshot.url}`,
    'Method: browser DOM extraction; no screenshots or OCR were used.',
    snapshot.documentTitle ? `Title: ${snapshot.documentTitle}` : '',
    snapshot.serverName ? `Server: ${snapshot.serverName}` : '',
    snapshot.channelName ? `Channel: ${snapshot.channelName}` : '',
    snapshot.topic ? `Topic: ${snapshot.topic}` : '',
    query?.trim() ? `Query: ${query.trim()}` : '',
    '',
    'Visible messages, oldest to newest:',
    ...snapshot.messages.map((message) => formatMessage(message)),
    '',
    `Composer: ${snapshot.composerText ? truncate(snapshot.composerText, 300) : 'empty'}`,
    snapshot.warnings.length > 0 ? `Warnings: ${snapshot.warnings.join(' | ')}` : ''
  ].filter((line) => line !== '')

  return truncate(lines.join('\n'), MAX_CONTEXT_CHARS)
}

export function formatDiscordDraftLoginRequired(): string {
  return [
    'Discord Web is not authenticated in Bonzi\'s browser session yet.',
    'A Discord browser window has been opened. Log in there, navigate to the target chat, then run this action again.',
    'No messages were read or sent.'
  ].join(' ')
}

export function formatDiscordDraftTyped(draft: string): string {
  return [
    `Typed a Discord Web draft (${draft.length} characters).`,
    'Bonzi did not press Enter and did not send the message.',
    'Please review the Discord composer yourself before sending or deleting the draft.'
  ].join(' ')
}

export function normalizeContextSnapshot(
  value: unknown,
  maxMessages: number
): DiscordDomContextSnapshot {
  const record = isRecord(value) ? value : {}
  const messages = Array.isArray(record.messages)
    ? record.messages
        .map(normalizeMessage)
        .filter((message): message is DiscordDomMessage => message !== null)
        .slice(-maxMessages)
    : []
  const warnings = Array.isArray(record.warnings)
    ? record.warnings.map((warning) => normalizeText(warning, 300)).filter(Boolean)
    : []

  return {
    authenticated: record.authenticated === true,
    url: normalizeText(record.url, 2_048) || 'unknown',
    documentTitle: normalizeText(record.documentTitle, 300) || undefined,
    serverName: normalizeText(record.serverName, 200) || undefined,
    channelName: normalizeText(record.channelName, 200) || undefined,
    topic: normalizeText(record.topic, 500) || undefined,
    messages,
    composerText: normalizeText(record.composerText, 500) || undefined,
    warnings
  }
}

export function normalizeDraftResult(value: unknown): DiscordDomDraftResult {
  const record = isRecord(value) ? value : {}

  return {
    ok: record.ok === true,
    authenticated: record.authenticated === true,
    reason: normalizeText(record.reason, 500) || undefined,
    composerText: normalizeText(record.composerText, 500) || undefined
  }
}

export function normalizeDraftText(value: unknown): string {
  const text = normalizeText(value, MAX_DRAFT_CHARS)

  if (!text) {
    throw new Error('Discord draft text is required.')
  }

  if (/[\r\n\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u.test(text)) {
    throw new Error('Discord draft text cannot include line breaks or control characters because Bonzi will not press Enter or send messages. Use a single-line draft.')
  }

  return text
}

function normalizeMessage(value: unknown): DiscordDomMessage | null {
  if (!isRecord(value)) {
    return null
  }

  const text = normalizeText(value.text, MAX_MESSAGE_TEXT_CHARS)

  if (!text) {
    return null
  }

  return {
    author: normalizeText(value.author, 200) || undefined,
    timestamp: normalizeText(value.timestamp, 100) || undefined,
    text,
    attachments: Array.isArray(value.attachments)
      ? value.attachments.map((attachment) => normalizeText(attachment, 300)).filter(Boolean).slice(0, 5)
      : []
  }
}

function normalizeText(value: unknown, maxLength: number): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  return truncate(text, maxLength)
}

function formatMessage(message: DiscordDomMessage): string {
  const prefix = [message.timestamp ? `[${message.timestamp}]` : '', message.author ? `${message.author}:` : ''].filter(Boolean).join(' ')
  const attachments = message.attachments.length > 0 ? ` Attachments: ${message.attachments.join(', ')}` : ''
  return `- ${prefix ? `${prefix} ` : ''}${message.text}${attachments}`
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
