import { BrowserWindow } from 'electron'
import {
  formatDiscordContext,
  formatDiscordDraftLoginRequired,
  formatDiscordDraftTyped,
  formatDiscordLoginRequired,
  normalizeContextSnapshot,
  normalizeDraftResult,
  normalizeDraftText
} from './discord-browser-formatting'
import {
  FOCUS_DRAFT_COMPOSER_SCRIPT,
  READ_CONTEXT_SCRIPT,
  type DiscordDomContextSnapshot
} from './discord-browser-scripts'
import {
  isAllowedDiscordBrowserRawUrl,
  parseDiscordBrowserConfig,
  resolveDiscordBrowserTargetUrl,
  type DiscordBrowserServiceConfig
} from './discord-browser-url-policy'

export interface DiscordBrowserActionService {
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

  readContext(input: { url?: string; query?: string }): Promise<string> {
    return this.enqueue(async () => {
      const window = await this.ensureWindow()
      const targetUrl = this.resolveTargetUrl(input.url, window.webContents.getURL())
      await this.ensureLoaded(window, targetUrl)
      const snapshot = await this.readDomSnapshot(window)

      if (!snapshot.authenticated) {
        this.showForLoginIfConfigured(window)
        return formatDiscordLoginRequired(snapshot, {
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
      const result = await window.webContents.executeJavaScript(
        FOCUS_DRAFT_COMPOSER_SCRIPT,
        true
      ) as unknown
      const draftResult = normalizeDraftResult(result)

      if (!draftResult.authenticated) {
        this.showForLoginIfConfigured(window)
        return formatDiscordDraftLoginRequired()
      }

      if (!draftResult.ok) {
        return draftResult.reason || 'Bonzi could not type a Discord draft, and no message was sent.'
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

  private async readDomSnapshot(window: BrowserWindow): Promise<DiscordDomContextSnapshot> {
    const rawSnapshot = await window.webContents.executeJavaScript(
      READ_CONTEXT_SCRIPT,
      true
    ) as unknown

    return normalizeContextSnapshot(rawSnapshot, this.config.maxMessages)
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

  private showForLoginIfConfigured(window: BrowserWindow): void {
    if (this.config.showWindowForLogin && !window.isVisible()) {
      window.show()
    }
  }
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
