import { BrowserWindow } from 'electron'

export interface DiscordBrowserActionService {
  readContext(input: { url?: string; query?: string }): Promise<string>
  typeDraft(input: { url?: string; text: string }): Promise<string>
  dispose(): Promise<void>
}

interface DiscordBrowserServiceConfig {
  initialUrl: string
  partition: string
  showWindowForLogin: boolean
  navigationTimeoutMs: number
  domReadyTimeoutMs: number
  maxMessages: number
  e2eMode: boolean
}

interface DiscordDomMessage {
  author?: string
  timestamp?: string
  text: string
  attachments: string[]
}

interface DiscordDomContextSnapshot {
  authenticated: boolean
  url: string
  documentTitle?: string
  serverName?: string
  channelName?: string
  topic?: string
  messages: DiscordDomMessage[]
  composerText?: string
  warnings: string[]
}

interface DiscordDomDraftResult {
  ok: boolean
  authenticated: boolean
  reason?: string
  composerText?: string
}

const DEFAULT_DISCORD_URL = 'https://discord.com/channels/@me'
const DEFAULT_PARTITION = 'persist:bonzi-discord-browser'
const DEFAULT_NAVIGATION_TIMEOUT_MS = 30_000
const DEFAULT_DOM_READY_TIMEOUT_MS = 10_000
const DEFAULT_MAX_MESSAGES = 25
const MAX_CONTEXT_CHARS = 8_000
const MAX_MESSAGE_TEXT_CHARS = 800
const MAX_DRAFT_CHARS = 2_000

const READ_CONTEXT_SCRIPT = String.raw`(() => {
  const textOf = (node) => (node?.textContent || '').replace(/\s+/g, ' ').trim();
  const firstText = (selectors, root = document) => {
    for (const selector of selectors) {
      const value = textOf(root.querySelector(selector));
      if (value) return value;
    }
    return '';
  };
  const isLoginPage = /\/login(?:$|[/?#])/.test(location.pathname) || Boolean(document.querySelector('input[name="email"], input[name="password"]'));
  const messageNodes = Array.from(document.querySelectorAll('[role="article"], [id^="chat-messages-"], [data-list-id="chat-messages"] [role="listitem"]'));
  const seen = new Set();
  const messages = [];

  for (const node of messageNodes) {
    const content = firstText(['[id^="message-content-"]', '[class*="markup"]'], node) || textOf(node);
    const author = firstText(['[id^="message-username-"]', 'h3 [class*="username"]', 'h3', '[class*="username"]'], node);
    const time = node.querySelector('time[datetime]');
    const timestamp = time?.getAttribute('datetime') || textOf(time);
    const attachments = Array.from(node.querySelectorAll('a[href], img[alt], [aria-label*="attachment" i]'))
      .map((child) => child.getAttribute('href') || child.getAttribute('alt') || child.getAttribute('aria-label') || '')
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 5);
    const key = [author, timestamp, content].join('\n');

    if (!content || seen.has(key)) continue;
    seen.add(key);
    messages.push({ author, timestamp, text: content, attachments });
  }

  const isSearchLike = (node) => {
    const label = [
      node.getAttribute('aria-label'),
      node.getAttribute('placeholder'),
      node.getAttribute('data-placeholder'),
      node.closest('[aria-label]')?.getAttribute('aria-label')
    ].filter(Boolean).join(' ').toLowerCase();
    return /search|find/.test(label);
  };
  const findComposer = () => {
    const preferred = Array.from(document.querySelectorAll('[role="textbox"][contenteditable="true"][aria-label^="Message"], [role="textbox"][contenteditable="true"][aria-label*="Message @"], [role="textbox"][contenteditable="true"][aria-label*="Message #"]'));
    const slate = Array.from(document.querySelectorAll('[data-slate-editor="true"][contenteditable="true"]'));
    const formTextboxes = Array.from(document.querySelectorAll('form [role="textbox"][contenteditable="true"], [class*="channelTextArea"] [role="textbox"][contenteditable="true"]'));
    const fallback = Array.from(document.querySelectorAll('[role="textbox"][contenteditable="true"], div[contenteditable="true"]'));
    return [...preferred, ...slate, ...formTextboxes, ...fallback].find((node) => !isSearchLike(node)) || null;
  };
  const composer = findComposer();
  const channelName = firstText(['h1', '[aria-label*="Channel" i]', '[data-list-item-id*="channels___" i][aria-selected="true"]']);
  const serverName = firstText(['[aria-label*="server" i] h2', 'nav [aria-current="page"]']);
  const topic = firstText(['[aria-label*="Topic" i]', '[class*="topic"]']);
  const warnings = [];

  if (isLoginPage) warnings.push('Discord Web appears to be on the login screen.');
  if (messages.length === 0) warnings.push('No chat messages were found with DOM selectors.');
  if (!composer) warnings.push('No Discord message composer was found.');

  return {
    authenticated: !isLoginPage && messages.length > 0,
    url: location.href,
    documentTitle: document.title,
    serverName,
    channelName,
    topic,
    messages,
    composerText: composer ? textOf(composer) : '',
    warnings
  };
})()`

const FOCUS_DRAFT_COMPOSER_SCRIPT = String.raw`(() => {
  const textOf = (node) => (node?.textContent || '').replace(/\s+/g, ' ').trim();
  const isLoginPage = /\/login(?:$|[/?#])/.test(location.pathname) || Boolean(document.querySelector('input[name="email"], input[name="password"]'));
  const isSearchLike = (node) => {
    const label = [
      node.getAttribute('aria-label'),
      node.getAttribute('placeholder'),
      node.getAttribute('data-placeholder'),
      node.closest('[aria-label]')?.getAttribute('aria-label')
    ].filter(Boolean).join(' ').toLowerCase();
    return /search|find/.test(label);
  };
  const findComposer = () => {
    const preferred = Array.from(document.querySelectorAll('[role="textbox"][contenteditable="true"][aria-label^="Message"], [role="textbox"][contenteditable="true"][aria-label*="Message @"], [role="textbox"][contenteditable="true"][aria-label*="Message #"]'));
    const slate = Array.from(document.querySelectorAll('[data-slate-editor="true"][contenteditable="true"]'));
    const formTextboxes = Array.from(document.querySelectorAll('form [role="textbox"][contenteditable="true"], [class*="channelTextArea"] [role="textbox"][contenteditable="true"]'));
    const fallback = Array.from(document.querySelectorAll('[role="textbox"][contenteditable="true"], div[contenteditable="true"]'));
    return [...preferred, ...slate, ...formTextboxes, ...fallback].find((node) => !isSearchLike(node)) || null;
  };
  const composer = findComposer();

  if (isLoginPage) {
    return { ok: false, authenticated: false, reason: 'Discord Web appears to be on the login screen.' };
  }

  if (!composer) {
    return { ok: false, authenticated: true, reason: 'No Discord message composer was found.' };
  }

  const existingText = textOf(composer);
  if (existingText) {
    return {
      ok: false,
      authenticated: true,
      reason: 'Discord composer already contains text. Bonzi did not overwrite it and did not send anything.',
      composerText: existingText
    };
  }

  composer.focus({ preventScroll: true });
  return { ok: true, authenticated: true, composerText: '' };
})()`

export function createDiscordBrowserServiceFromEnv(
  env: NodeJS.ProcessEnv = process.env
): DiscordBrowserActionService {
  return new BonziDiscordBrowserService(parseConfig(env))
}

export class BonziDiscordBrowserService implements DiscordBrowserActionService {
  private browserWindow: BrowserWindow | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private disposed = false

  constructor(private readonly config: DiscordBrowserServiceConfig) {}

  readContext(input: { url?: string; query?: string }): Promise<string> {
    return this.enqueue(async () => {
      const window = await this.ensureWindow()
      const targetUrl = this.resolveTargetUrl(input.url, window.webContents.getURL())
      await this.ensureLoaded(window, targetUrl)
      const snapshot = await this.readDomSnapshot(window)

      if (!snapshot.authenticated) {
        this.showForLoginIfConfigured(window)
        return this.formatLoginRequired(snapshot)
      }

      return this.formatContext(snapshot, input.query)
    })
  }

  typeDraft(input: { url?: string; text: string }): Promise<string> {
    return this.enqueue(async () => {
      const draft = normalizeDraftText(input.text)
      const window = await this.ensureWindow()
      const targetUrl = this.resolveTargetUrl(input.url, window.webContents.getURL())
      await this.ensureLoaded(window, targetUrl)
      const result = await window.webContents.executeJavaScript(
        FOCUS_DRAFT_COMPOSER_SCRIPT,
        true
      ) as unknown
      const draftResult = normalizeDraftResult(result)

      if (!draftResult.authenticated) {
        this.showForLoginIfConfigured(window)
        return [
          'Discord Web is not authenticated in Bonzi\'s browser session yet.',
          'A Discord browser window has been opened. Log in there, navigate to the target chat, then run this action again.',
          'No messages were read or sent.'
        ].join(' ')
      }

      if (!draftResult.ok) {
        return draftResult.reason || 'Bonzi could not type a Discord draft, and no message was sent.'
      }

      window.webContents.focus()
      await window.webContents.insertText(draft)

      return [
        `Typed a Discord Web draft (${draft.length} characters).`,
        'Bonzi did not press Enter and did not send the message.',
        'Please review the Discord composer yourself before sending or deleting the draft.'
      ].join(' ')
    })
  }

  async dispose(): Promise<void> {
    this.disposed = true
    const window = this.browserWindow
    this.browserWindow = null

    if (window && !window.isDestroyed()) {
      window.close()
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation, operation)
    this.queue = run.catch(() => undefined)
    return run
  }

  private async ensureWindow(): Promise<BrowserWindow> {
    if (this.disposed) {
      throw new Error('Discord browser service has been disposed.')
    }

    if (this.browserWindow && !this.browserWindow.isDestroyed()) {
      return this.browserWindow
    }

    const window = new BrowserWindow({
      width: 1200,
      height: 900,
      show: false,
      frame: true,
      alwaysOnTop: false,
      title: 'Bonzi Discord Web',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        partition: this.config.partition
      }
    })

    window.webContents.setWindowOpenHandler(({ url }) => {
      return this.isAllowedUrl(url) ? { action: 'allow' } : { action: 'deny' }
    })
    window.webContents.on('will-navigate', (event, url) => {
      if (!this.isAllowedUrl(url)) {
        event.preventDefault()
      }
    })
    window.on('closed', () => {
      if (this.browserWindow === window) {
        this.browserWindow = null
      }
    })

    this.browserWindow = window
    return window
  }

  private async ensureLoaded(window: BrowserWindow, url: string): Promise<void> {
    const currentUrl = window.webContents.getURL()
    const shouldLoad = !currentUrl || currentUrl === 'about:blank' || url !== currentUrl

    if (shouldLoad) {
      await withTimeout(
        window.loadURL(url),
        this.config.navigationTimeoutMs,
        'Timed out loading Discord Web.'
      )
    }

    await this.waitForDomReady(window)
  }

  private async waitForDomReady(window: BrowserWindow): Promise<void> {
    const startedAt = Date.now()

    while (Date.now() - startedAt < this.config.domReadyTimeoutMs) {
      const readyState = await window.webContents.executeJavaScript(
        'document.readyState',
        true
      ).catch(() => 'loading')

      if (readyState === 'interactive' || readyState === 'complete') {
        return
      }

      await delay(100)
    }

    throw new Error('Timed out waiting for Discord Web DOM readiness.')
  }

  private async readDomSnapshot(window: BrowserWindow): Promise<DiscordDomContextSnapshot> {
    const rawSnapshot = await window.webContents.executeJavaScript(
      READ_CONTEXT_SCRIPT,
      true
    ) as unknown

    return normalizeContextSnapshot(rawSnapshot, this.config.maxMessages)
  }

  private resolveTargetUrl(rawUrl: string | undefined, currentUrl: string): string {
    const explicitInput = rawUrl?.trim()
    const input = explicitInput || this.currentDiscordChannelUrl(currentUrl) || this.config.initialUrl
    const withScheme = input.includes('://') ? input : `https://${input}`
    const url = new URL(withScheme)

    if (!this.isAllowedParsedUrl(url)) {
      throw new Error('Discord browser actions can only open Discord channel URLs. Loopback test URLs are allowed in E2E mode only.')
    }

    return url.toString()
  }

  private currentDiscordChannelUrl(rawUrl: string): string {
    if (!rawUrl || rawUrl === 'about:blank') {
      return ''
    }

    try {
      const url = new URL(rawUrl)

      if (!this.isAllowedParsedUrl(url) || !isSpecificChannelPath(url.pathname)) {
        return ''
      }

      return url.toString()
    } catch {
      return ''
    }
  }

  private isAllowedUrl(rawUrl: string): boolean {
    try {
      return this.isAllowedParsedUrl(new URL(rawUrl))
    } catch {
      return false
    }
  }

  private isAllowedParsedUrl(url: URL): boolean {
    if (url.username || url.password) {
      return false
    }

    if (this.config.e2eMode && url.protocol === 'http:' && isLoopbackHost(url.hostname)) {
      return true
    }

    if (url.protocol !== 'https:') {
      return false
    }

    if (url.hostname !== 'discord.com' && url.hostname !== 'discordapp.com') {
      return false
    }

    return url.pathname === '/' || url.pathname.startsWith('/channels/') || url.pathname.startsWith('/login')
  }

  private showForLoginIfConfigured(window: BrowserWindow): void {
    if (this.config.showWindowForLogin && !window.isVisible()) {
      window.show()
    }
  }

  private formatLoginRequired(snapshot: DiscordDomContextSnapshot): string {
    return [
      'Discord Web is not authenticated in Bonzi\'s browser session yet, or no readable chat DOM was found.',
      `Source: ${snapshot.url}`,
      this.config.showWindowForLogin
        ? 'A Discord browser window has been opened. Log in there, navigate to the target chat, then run this action again.'
        : 'Log into Discord Web in Bonzi\'s browser session, navigate to the target chat, then run this action again.',
      'No messages were read or sent.',
      snapshot.warnings.length > 0 ? `Warnings: ${snapshot.warnings.join(' | ')}` : ''
    ]
      .filter(Boolean)
      .join('\n')
  }

  private formatContext(snapshot: DiscordDomContextSnapshot, query: string | undefined): string {
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
}

function parseConfig(env: NodeJS.ProcessEnv): DiscordBrowserServiceConfig {
  const e2eMode = env.BONZI_E2E_MODE === '1'
  const initialUrl = env.BONZI_DISCORD_BROWSER_URL || env.BONZI_E2E_DISCORD_URL || DEFAULT_DISCORD_URL

  return {
    initialUrl,
    partition: env.BONZI_DISCORD_BROWSER_PARTITION || DEFAULT_PARTITION,
    showWindowForLogin: env.BONZI_DISCORD_BROWSER_SHOW_FOR_LOGIN !== '0',
    navigationTimeoutMs: parsePositiveInt(env.BONZI_DISCORD_BROWSER_NAVIGATION_TIMEOUT_MS, DEFAULT_NAVIGATION_TIMEOUT_MS),
    domReadyTimeoutMs: parsePositiveInt(env.BONZI_DISCORD_BROWSER_DOM_READY_TIMEOUT_MS, DEFAULT_DOM_READY_TIMEOUT_MS),
    maxMessages: parsePositiveInt(env.BONZI_DISCORD_BROWSER_MAX_MESSAGES, DEFAULT_MAX_MESSAGES),
    e2eMode
  }
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback
}

function normalizeContextSnapshot(value: unknown, maxMessages: number): DiscordDomContextSnapshot {
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

function normalizeDraftResult(value: unknown): DiscordDomDraftResult {
  const record = isRecord(value) ? value : {}

  return {
    ok: record.ok === true,
    authenticated: record.authenticated === true,
    reason: normalizeText(record.reason, 500) || undefined,
    composerText: normalizeText(record.composerText, 500) || undefined
  }
}

function normalizeDraftText(value: unknown): string {
  const text = normalizeText(value, MAX_DRAFT_CHARS)

  if (!text) {
    throw new Error('Discord draft text is required.')
  }

  if (/[\r\n\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u.test(text)) {
    throw new Error('Discord draft text cannot include line breaks or control characters because Bonzi will not press Enter or send messages. Use a single-line draft.')
  }

  return text
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

function isSpecificChannelPath(pathname: string): boolean {
  const segments = pathname.split('/').filter(Boolean)
  return segments[0] === 'channels' && segments.length >= 3
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      })
    ])
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength - 1)}…`
}
