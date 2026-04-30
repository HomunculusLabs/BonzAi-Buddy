import { BrowserWindow } from 'electron'
import {
  formatDiscordContext,
  formatDiscordContextUnavailable,
  formatDiscordDraftTyped,
  formatDiscordDraftUnavailable,
  normalizeContextSnapshot,
  normalizeDraftResult,
  normalizeDraftText
} from './discord-browser-formatting'
import {
  FOCUS_DRAFT_COMPOSER_SCRIPT,
  READ_CONTEXT_SCRIPT,
  type DiscordDomContextSnapshot,
  type DiscordDomDraftResult,
  type DiscordDomDraftFailureCode,
  type DiscordDomReadinessState
} from './discord-browser-scripts'
import {
  isAllowedDiscordBrowserRawUrl,
  parseDiscordBrowserConfig,
  resolveDiscordBrowserTargetUrl,
  type DiscordBrowserServiceConfig
} from './discord-browser-url-policy'

export interface DiscordBrowserActionService {
  open(input: { url?: string }): Promise<string>
  readContext(input: { url?: string; query?: string }): Promise<string>
  typeDraft(input: { url?: string; text: string }): Promise<string>
  dispose(): Promise<void>
}

export function createDiscordBrowserServiceFromEnv(
  env: NodeJS.ProcessEnv = process.env
): DiscordBrowserActionService {
  return new BonziDiscordBrowserService(parseDiscordBrowserConfig(env))
}

export class BonziDiscordBrowserService implements DiscordBrowserActionService {
  private browserWindow: BrowserWindow | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private disposed = false

  constructor(private readonly config: DiscordBrowserServiceConfig) {}

  open(input: { url?: string }): Promise<string> {
    return this.enqueue(async () => {
      const window = await this.ensureWindow()
      const targetUrl = this.resolveTargetUrl(input.url, window.webContents.getURL())
      await this.ensureLoaded(window, targetUrl)
      this.revealWindowIfConfigured(window)
      return `Opened ${targetUrl} in Bonzi's dedicated Discord Web window.`
    })
  }

  readContext(input: { url?: string; query?: string }): Promise<string> {
    return this.enqueue(async () => {
      const window = await this.ensureWindow()
      const targetUrl = this.resolveTargetUrl(input.url, window.webContents.getURL())
      await this.ensureLoaded(window, targetUrl)
      const snapshot = await this.pollDomSnapshot(window)

      if (shouldRevealWindowForContext(snapshot.readinessState)) {
        this.revealWindowIfConfigured(window)
      }

      if (!snapshot.readable) {
        return formatDiscordContextUnavailable(snapshot, {
          showWindowForLogin: this.config.showWindowForLogin
        })
      }

      return formatDiscordContext(snapshot, input.query)
    })
  }

  typeDraft(input: { url?: string; text: string }): Promise<string> {
    return this.enqueue(async () => {
      const draft = normalizeDraftText(input.text)
      const window = await this.ensureWindow()
      const targetUrl = this.resolveTargetUrl(input.url, window.webContents.getURL())
      await this.ensureLoaded(window, targetUrl)
      const draftResult = await this.pollDraftComposer(window)

      if (shouldRevealWindowForDraft(draftResult.failureCode)) {
        this.revealWindowIfConfigured(window)
      }

      if (!draftResult.ok) {
        return formatDiscordDraftUnavailable(draftResult, {
          showWindowForLogin: this.config.showWindowForLogin
        })
      }

      window.webContents.focus()
      await window.webContents.insertText(draft)

      return formatDiscordDraftTyped(draft)
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

  private async pollDomSnapshot(window: BrowserWindow): Promise<DiscordDomContextSnapshot> {
    const startedAt = Date.now()
    let lastSnapshot: DiscordDomContextSnapshot | null = null

    while (Date.now() - startedAt < this.config.domReadyTimeoutMs) {
      this.assertUsableWindow(window)
      const snapshot = await this.readDomSnapshot(window)
      lastSnapshot = snapshot

      if (isTerminalReadinessState(snapshot.readinessState)) {
        return snapshot
      }

      await delay(150)
    }

    if (lastSnapshot) {
      return classifyTimedOutSnapshot(lastSnapshot)
    }

    throw new Error('Timed out waiting for Discord Web DOM snapshot.')
  }

  private async readDomSnapshot(window: BrowserWindow): Promise<DiscordDomContextSnapshot> {
    this.assertUsableWindow(window)
    const rawSnapshot = await window.webContents.executeJavaScript(
      READ_CONTEXT_SCRIPT,
      true
    ) as unknown

    return normalizeContextSnapshot(rawSnapshot, this.config.maxMessages)
  }

  private async pollDraftComposer(window: BrowserWindow): Promise<DiscordDomDraftResult> {
    const startedAt = Date.now()
    let lastResult: DiscordDomDraftResult | null = null

    while (Date.now() - startedAt < this.config.domReadyTimeoutMs) {
      this.assertUsableWindow(window)
      const result = await this.focusDraftComposer(window)
      lastResult = result

      if (result.ok || isTerminalDraftFailure(result.failureCode)) {
        return result
      }

      await delay(150)
    }

    if (lastResult) {
      return {
        ...lastResult,
        ok: false,
        failureCode: 'not_ready',
        reason: 'Discord Web did not finish loading the message composer before timeout.'
      }
    }

    throw new Error('Timed out waiting for Discord Web draft composer.')
  }

  private async focusDraftComposer(window: BrowserWindow): Promise<DiscordDomDraftResult> {
    this.assertUsableWindow(window)
    const rawResult = await window.webContents.executeJavaScript(
      FOCUS_DRAFT_COMPOSER_SCRIPT,
      true
    ) as unknown

    return normalizeDraftResult(rawResult)
  }

  private assertUsableWindow(window: BrowserWindow): void {
    if (this.disposed) {
      throw new Error('Discord browser service has been disposed.')
    }

    if (window.isDestroyed()) {
      throw new Error('Discord browser window was closed before the action completed.')
    }
  }

  private resolveTargetUrl(rawUrl: string | undefined, currentUrl: string): string {
    return resolveDiscordBrowserTargetUrl({
      rawUrl,
      currentUrl,
      initialUrl: this.config.initialUrl,
      e2eMode: this.config.e2eMode
    })
  }

  private isAllowedUrl(rawUrl: string): boolean {
    return isAllowedDiscordBrowserRawUrl(rawUrl, this.config.e2eMode)
  }

  private revealWindowIfConfigured(window: BrowserWindow): void {
    if (!this.config.showWindowForLogin) {
      return
    }

    if (!window.isVisible()) {
      window.show()
    }

    window.focus()
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isTerminalReadinessState(state: DiscordDomReadinessState): boolean {
  return state === 'ready'
    || state === 'login_required'
    || state === 'wrong_page'
    || state === 'empty_messages'
    || state === 'selector_drift'
}

function isTerminalDraftFailure(code: DiscordDomDraftFailureCode | undefined): boolean {
  return code === 'login_required'
    || code === 'wrong_page'
    || code === 'composer_missing'
    || code === 'composer_not_empty'
}

function shouldRevealWindowForContext(state: DiscordDomReadinessState): boolean {
  return state === 'login_required'
    || state === 'wrong_page'
    || state === 'selector_drift'
    || state === 'not_ready'
}

function shouldRevealWindowForDraft(code: DiscordDomDraftFailureCode | undefined): boolean {
  return code === 'login_required'
    || code === 'wrong_page'
    || code === 'composer_missing'
    || code === 'not_ready'
}

function classifyTimedOutSnapshot(snapshot: DiscordDomContextSnapshot): DiscordDomContextSnapshot {
  if (snapshot.readinessState !== 'not_ready') {
    return snapshot
  }

  if (snapshot.diagnostics.specificChannelPath && snapshot.diagnostics.messageContainerFound) {
    return {
      ...snapshot,
      readable: false,
      readinessState: 'empty_messages',
      warnings: addUniqueWarning(
        snapshot.warnings,
        'No visible chat messages were found in this channel before timeout.'
      )
    }
  }

  if (snapshot.diagnostics.specificChannelPath && snapshot.diagnostics.composerFound) {
    return {
      ...snapshot,
      readable: false,
      readinessState: 'empty_messages',
      warnings: addUniqueWarning(
        snapshot.warnings,
        'Discord composer loaded, but no visible chat messages were found before timeout.'
      )
    }
  }

  if (snapshot.diagnostics.specificChannelPath) {
    return {
      ...snapshot,
      readable: false,
      readinessState: 'selector_drift',
      warnings: addUniqueWarning(
        snapshot.warnings,
        'Discord channel URL loaded, but supported message/composer selectors did not match before timeout.'
      )
    }
  }

  return {
    ...snapshot,
    readable: false,
    readinessState: 'not_ready',
    warnings: addUniqueWarning(
      snapshot.warnings,
      'Discord Web did not finish loading readable channel DOM before timeout.'
    )
  }
}

function addUniqueWarning(warnings: string[], warning: string): string[] {
  return warnings.includes(warning) ? warnings : [...warnings, warning]
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
