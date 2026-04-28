export interface DiscordBrowserServiceConfig {
  initialUrl: string
  partition: string
  showWindowForLogin: boolean
  navigationTimeoutMs: number
  domReadyTimeoutMs: number
  maxMessages: number
  e2eMode: boolean
}

const DEFAULT_DISCORD_URL = 'https://discord.com/channels/@me'
const DEFAULT_PARTITION = 'persist:bonzi-discord-browser'
const DEFAULT_NAVIGATION_TIMEOUT_MS = 30_000
const DEFAULT_DOM_READY_TIMEOUT_MS = 10_000
const DEFAULT_MAX_MESSAGES = 25

export function parseDiscordBrowserConfig(
  env: NodeJS.ProcessEnv
): DiscordBrowserServiceConfig {
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

export function resolveDiscordBrowserTargetUrl(input: {
  rawUrl?: string
  currentUrl: string
  initialUrl: string
  e2eMode: boolean
}): string {
  const explicitInput = input.rawUrl?.trim()
  const rawTarget = explicitInput || currentDiscordChannelUrl(input.currentUrl, input.e2eMode) || input.initialUrl
  const withScheme = rawTarget.includes('://') ? rawTarget : `https://${rawTarget}`
  const url = new URL(withScheme)

  if (!isAllowedDiscordBrowserUrl(url, input.e2eMode)) {
    throw new Error('Discord browser actions can only open Discord channel URLs. Loopback test URLs are allowed in E2E mode only.')
  }

  return url.toString()
}

export function isAllowedDiscordBrowserRawUrl(
  rawUrl: string,
  e2eMode: boolean
): boolean {
  try {
    return isAllowedDiscordBrowserUrl(new URL(rawUrl), e2eMode)
  } catch {
    return false
  }
}

export function isAllowedDiscordBrowserUrl(url: URL, e2eMode: boolean): boolean {
  if (url.username || url.password) {
    return false
  }

  if (e2eMode && url.protocol === 'http:' && isLoopbackHost(url.hostname)) {
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

function currentDiscordChannelUrl(rawUrl: string, e2eMode: boolean): string {
  if (!rawUrl || rawUrl === 'about:blank') {
    return ''
  }

  try {
    const url = new URL(rawUrl)

    if (!isAllowedDiscordBrowserUrl(url, e2eMode) || !isSpecificChannelPath(url.pathname)) {
      return ''
    }

    return url.toString()
  } catch {
    return ''
  }
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback
}

function isSpecificChannelPath(pathname: string): boolean {
  const segments = pathname.split('/').filter(Boolean)
  return segments[0] === 'channels' && segments.length >= 3
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'
}
