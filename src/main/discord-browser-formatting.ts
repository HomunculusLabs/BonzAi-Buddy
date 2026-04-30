import type {
  DiscordDomContextSnapshot,
  DiscordDomDiagnostics,
  DiscordDomDraftDiagnostics,
  DiscordDomDraftFailureCode,
  DiscordDomDraftResult,
  DiscordDomMessage,
  DiscordDomPageState,
  DiscordDomReadinessState
} from './discord-browser-scripts'

const MAX_CONTEXT_CHARS = 8_000
const MAX_MESSAGE_TEXT_CHARS = 800
const MAX_DRAFT_CHARS = 2_000

const PAGE_STATES = new Set<DiscordDomPageState>([
  'login',
  'specific_channel',
  'channel_home',
  'discord_page',
  'unknown_page'
])
const READINESS_STATES = new Set<DiscordDomReadinessState>([
  'ready',
  'login_required',
  'wrong_page',
  'empty_messages',
  'selector_drift',
  'not_ready'
])
const DRAFT_FAILURE_CODES = new Set<DiscordDomDraftFailureCode>([
  'login_required',
  'wrong_page',
  'composer_missing',
  'composer_not_empty',
  'not_ready'
])

export function formatDiscordLoginRequired(
  snapshot: DiscordDomContextSnapshot,
  options: { showWindowForLogin: boolean }
): string {
  return formatDiscordContextUnavailable(snapshot, options)
}

export function formatDiscordContextUnavailable(
  snapshot: DiscordDomContextSnapshot,
  options: { showWindowForLogin: boolean }
): string {
  const headline = contextUnavailableHeadline(snapshot.readinessState)
  const nextStep = snapshot.readinessState === 'login_required'
    ? options.showWindowForLogin
      ? 'A Discord browser window has been opened. Log in there, navigate to the target chat, then run this action again.'
      : 'Log into Discord Web in Bonzi\'s internal browser session, navigate to the target chat, then run this action again.'
    : contextUnavailableNextStep(snapshot.readinessState, options.showWindowForLogin)

  return [
    headline,
    `Source: ${snapshot.url}`,
    snapshot.documentTitle ? `Title: ${snapshot.documentTitle}` : '',
    `Page state: ${snapshot.pageState}`,
    `Readiness: ${snapshot.readinessState}`,
    nextStep,
    'No messages were read or sent.',
    formatContextDiagnostics(snapshot),
    snapshot.warnings.length > 0 ? `Warnings: ${snapshot.warnings.join(' | ')}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

export function formatDiscordContext(
  snapshot: DiscordDomContextSnapshot,
  query: string | undefined
): string {
  if (!snapshot.readable) {
    return formatDiscordContextUnavailable(snapshot, { showWindowForLogin: false })
  }

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
    'Login required in Bonzi\'s Discord Web browser session.',
    'A Discord browser window has been opened. Log in there, navigate to the target chat, then run this action again.',
    'No messages were read or sent.'
  ].join(' ')
}

export function formatDiscordDraftUnavailable(
  result: DiscordDomDraftResult,
  options: { showWindowForLogin: boolean }
): string {
  const failureCode = result.failureCode || (result.authenticated ? 'composer_missing' : 'login_required')
  const nextStep = failureCode === 'login_required'
    ? options.showWindowForLogin
      ? 'A Discord browser window has been opened. Log in there, navigate to the target chat, then run this action again.'
      : 'Log into Discord Web in Bonzi\'s internal browser session, navigate to the target chat, then run this action again.'
    : draftUnavailableNextStep(failureCode, options.showWindowForLogin)

  return [
    draftUnavailableHeadline(failureCode),
    `Source: ${result.url}`,
    result.documentTitle ? `Title: ${result.documentTitle}` : '',
    result.reason ? `Reason: ${result.reason}` : '',
    `Page state: ${result.pageState}`,
    nextStep,
    'No Discord message was sent.',
    result.composerText ? `Existing composer text: ${truncate(result.composerText, 300)}` : '',
    formatDraftDiagnostics(result.diagnostics)
  ]
    .filter(Boolean)
    .join('\n')
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
  const diagnostics = normalizeContextDiagnostics(record.diagnostics)
  const loginDetected = diagnostics.loginPageDetected
  const authenticated = typeof record.authenticated === 'boolean'
    ? record.authenticated
    : !loginDetected
  const pageState = normalizePageState(record.pageState, loginDetected ? 'login' : 'unknown_page')
  const readinessState = normalizeReadinessState(
    record.readinessState,
    loginDetected
      ? 'login_required'
      : messages.length > 0
        ? 'ready'
        : 'not_ready'
  )
  const readable = typeof record.readable === 'boolean'
    ? record.readable
    : authenticated && readinessState === 'ready' && messages.length > 0

  return {
    authenticated,
    readable,
    pageState,
    readinessState,
    url: normalizeText(record.url, 2_048) || 'unknown',
    documentTitle: normalizeText(record.documentTitle, 300) || undefined,
    serverName: normalizeText(record.serverName, 200) || undefined,
    channelName: normalizeText(record.channelName, 200) || undefined,
    topic: normalizeText(record.topic, 500) || undefined,
    messages,
    composerText: normalizeText(record.composerText, 500) || undefined,
    composerFound: typeof record.composerFound === 'boolean'
      ? record.composerFound
      : diagnostics.composerFound,
    diagnostics: {
      ...diagnostics,
      extractedMessageCount: messages.length || diagnostics.extractedMessageCount
    },
    warnings
  }
}

export function normalizeDraftResult(value: unknown): DiscordDomDraftResult {
  const record = isRecord(value) ? value : {}
  const diagnostics = normalizeDraftDiagnostics(record.diagnostics)
  const loginDetected = diagnostics.loginPageDetected
  const authenticated = typeof record.authenticated === 'boolean'
    ? record.authenticated
    : !loginDetected

  return {
    ok: record.ok === true,
    authenticated,
    pageState: normalizePageState(record.pageState, loginDetected ? 'login' : 'unknown_page'),
    url: normalizeText(record.url, 2_048) || 'unknown',
    documentTitle: normalizeText(record.documentTitle, 300) || undefined,
    failureCode: normalizeDraftFailureCode(record.failureCode),
    reason: normalizeText(record.reason, 500) || undefined,
    composerText: normalizeText(record.composerText, 500) || undefined,
    diagnostics
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

function normalizeContextDiagnostics(value: unknown): DiscordDomDiagnostics {
  const record = isRecord(value) ? value : {}

  return {
    loginPageDetected: record.loginPageDetected === true,
    specificChannelPath: record.specificChannelPath === true,
    messageContainerFound: record.messageContainerFound === true,
    messageNodeCount: normalizeCount(record.messageNodeCount),
    extractedMessageCount: normalizeCount(record.extractedMessageCount),
    composerFound: record.composerFound === true,
    matchedMessageSelectors: Array.isArray(record.matchedMessageSelectors)
      ? record.matchedMessageSelectors.map((selector) => normalizeText(selector, 200)).filter(Boolean).slice(0, 12)
      : [],
    matchedComposerSelector: normalizeText(record.matchedComposerSelector, 200) || undefined
  }
}

function normalizeDraftDiagnostics(value: unknown): DiscordDomDraftDiagnostics {
  const record = isRecord(value) ? value : {}

  return {
    loginPageDetected: record.loginPageDetected === true,
    specificChannelPath: record.specificChannelPath === true,
    composerFound: record.composerFound === true,
    matchedComposerSelector: normalizeText(record.matchedComposerSelector, 200) || undefined
  }
}

function normalizePageState(value: unknown, fallback: DiscordDomPageState): DiscordDomPageState {
  return typeof value === 'string' && PAGE_STATES.has(value as DiscordDomPageState)
    ? value as DiscordDomPageState
    : fallback
}

function normalizeReadinessState(value: unknown, fallback: DiscordDomReadinessState): DiscordDomReadinessState {
  return typeof value === 'string' && READINESS_STATES.has(value as DiscordDomReadinessState)
    ? value as DiscordDomReadinessState
    : fallback
}

function normalizeDraftFailureCode(value: unknown): DiscordDomDraftFailureCode | undefined {
  return typeof value === 'string' && DRAFT_FAILURE_CODES.has(value as DiscordDomDraftFailureCode)
    ? value as DiscordDomDraftFailureCode
    : undefined
}

function normalizeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0
}

function contextUnavailableHeadline(state: DiscordDomReadinessState): string {
  switch (state) {
    case 'login_required':
      return 'Login required in Bonzi\'s Discord Web browser session.'
    case 'wrong_page':
      return 'Discord Web is open, but not on a specific channel or DM.'
    case 'empty_messages':
      return 'No visible chat messages were found in this channel.'
    case 'selector_drift':
      return 'Discord channel loaded, but Bonzi\'s DOM selectors did not find the message list.'
    case 'not_ready':
      return 'Discord Web did not finish loading readable channel DOM before timeout.'
    case 'ready':
      return 'Discord Web DOM context was not readable.'
  }
}

function contextUnavailableNextStep(state: DiscordDomReadinessState, windowRevealed: boolean): string {
  switch (state) {
    case 'wrong_page':
      return windowRevealed
        ? 'A Discord browser window has been opened. Navigate it to a server channel or DM, or pass a specific Discord channel/DM URL.'
        : 'Open a Discord server channel or DM in Bonzi\'s internal Discord Web browser session, or pass a specific Discord channel/DM URL.'
    case 'empty_messages':
      return 'Navigate to a channel with visible messages, or wait for Discord to render messages before trying again.'
    case 'selector_drift':
      return windowRevealed
        ? 'A Discord browser window has been opened. Discord may have changed its Web DOM; the diagnostics below show which selectors matched.'
        : 'Discord may have changed its Web DOM. The diagnostics below show which selectors matched.'
    case 'not_ready':
      return windowRevealed
        ? 'A Discord browser window has been opened. Wait for Discord Web to finish loading the target channel, then run this action again.'
        : 'Wait for Discord Web to finish loading the target channel, then run this action again.'
    case 'login_required':
    case 'ready':
      return ''
  }
}

function draftUnavailableHeadline(code: DiscordDomDraftFailureCode): string {
  switch (code) {
    case 'login_required':
      return 'Login required in Bonzi\'s Discord Web browser session.'
    case 'wrong_page':
      return 'Discord Web is open, but not on a specific channel or DM.'
    case 'composer_missing':
      return 'Discord channel loaded, but Bonzi could not find the message composer.'
    case 'composer_not_empty':
      return 'Discord composer already contains text, so Bonzi did not overwrite it.'
    case 'not_ready':
      return 'Discord Web did not finish loading the message composer before timeout.'
  }
}

function draftUnavailableNextStep(code: DiscordDomDraftFailureCode, windowRevealed: boolean): string {
  switch (code) {
    case 'wrong_page':
      return windowRevealed
        ? 'A Discord browser window has been opened. Navigate it to a server channel or DM, or pass a specific Discord channel/DM URL.'
        : 'Open a Discord server channel or DM in Bonzi\'s internal Discord Web browser session, or pass a specific Discord channel/DM URL.'
    case 'composer_missing':
      return windowRevealed
        ? 'A Discord browser window has been opened. Navigate to a channel where the Discord Web message composer is visible, then run this action again.'
        : 'Navigate to a channel where the Discord Web message composer is visible, then run this action again.'
    case 'composer_not_empty':
      return 'Review, send, or clear the existing composer text yourself before asking Bonzi to type a new draft.'
    case 'not_ready':
      return windowRevealed
        ? 'A Discord browser window has been opened. Wait for Discord Web to finish loading the target channel composer, then run this action again.'
        : 'Wait for Discord Web to finish loading the target channel composer, then run this action again.'
    case 'login_required':
      return ''
  }
}

function formatContextDiagnostics(snapshot: DiscordDomContextSnapshot): string {
  const diagnostics = snapshot.diagnostics
  return [
    'Diagnostics:',
    `login=${diagnostics.loginPageDetected}`,
    `specificChannel=${diagnostics.specificChannelPath}`,
    `messageContainer=${diagnostics.messageContainerFound}`,
    `messageNodes=${diagnostics.messageNodeCount}`,
    `extractedMessages=${diagnostics.extractedMessageCount}`,
    `composer=${diagnostics.composerFound}`,
    diagnostics.matchedMessageSelectors.length > 0
      ? `messageSelectors=${diagnostics.matchedMessageSelectors.join(', ')}`
      : 'messageSelectors=none',
    diagnostics.matchedComposerSelector
      ? `composerSelector=${diagnostics.matchedComposerSelector}`
      : 'composerSelector=none'
  ].join(' ')
}

function formatDraftDiagnostics(diagnostics: DiscordDomDraftDiagnostics): string {
  return [
    'Diagnostics:',
    `login=${diagnostics.loginPageDetected}`,
    `specificChannel=${diagnostics.specificChannelPath}`,
    `composer=${diagnostics.composerFound}`,
    diagnostics.matchedComposerSelector
      ? `composerSelector=${diagnostics.matchedComposerSelector}`
      : 'composerSelector=none'
  ].join(' ')
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
