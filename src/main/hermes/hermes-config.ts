import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import type {
  HermesHealthCheckResult,
  HermesRuntimeSettings,
  HermesRuntimeSettingsResponse,
  UpdateHermesRuntimeSettingsRequest
} from '../../shared/contracts/hermes'
import { isRecord } from '../../shared/value-utils'
import { resolveHermesModelAuthSettings } from './hermes-native-settings'

const execFileAsync = promisify(execFile)
const SETTINGS_FILE_NAME = 'bonzi-settings.json'
const DEFAULT_TIMEOUT_MS = 300_000
const DEFAULT_GATEWAY_PORT = 8642
const MAX_SYSTEM_PROMPT_LENGTH = 32_000
const MAX_STRING_LENGTH = 2_048

type RuntimeEnv = Record<string, string>

export interface HermesResolvedConfig extends HermesRuntimeSettings {
  profile?: string
  startupWarnings: string[]
  e2eMode: boolean
}

interface PersistedHermesSettingsFile {
  hermes?: unknown
  schemaVersion?: unknown
  [key: string]: unknown
}

const ENV_OVERRIDE_KEYS = [
  'BONZI_HERMES_CLI_PATH',
  'BONZI_HERMES_CWD',
  'BONZI_HERMES_MODEL',
  'HERMES_INFERENCE_MODEL',
  'BONZI_HERMES_PROVIDER',
  'HERMES_INFERENCE_PROVIDER',
  'BONZI_HERMES_TIMEOUT_MS',
  'BONZI_HERMES_SYSTEM_PROMPT',
  'BONZI_HERMES_GATEWAY_URL',
  'BONZI_HERMES_GATEWAY_API_KEY',
  'API_SERVER_ENABLED',
  'API_SERVER_HOST',
  'API_SERVER_PORT',
  'API_SERVER_BASE_URL',
  'API_SERVER_KEY'
]

export function loadHermesConfig(env: RuntimeEnv = loadRuntimeEnv()): HermesResolvedConfig {
  const e2eMode = env.BONZI_E2E_MODE?.trim() === '1'
  const requestedProvider = env.BONZI_ASSISTANT_PROVIDER?.trim()
  const warnings: string[] = []

  if (requestedProvider === 'hermes') {
    warnings.push(
      'BONZI_ASSISTANT_PROVIDER=hermes is ignored in OG Bonzi; Eliza remains the primary assistant runtime and Hermes is configured as a secondary runtime.'
    )
  }

  const nativeSettings = resolveHermesModelAuthSettings(env)
  const activeProfile = nativeSettings.activeProfile.name
  const hermesProfileEnv = loadHermesProfileEnv(activeProfile, env)
  const savedSettings = readSavedHermesSettings()
  const settings = applyHermesEnvOverrides(savedSettings, env, hermesProfileEnv)

  return {
    startupWarnings: warnings,
    e2eMode,
    ...(activeProfile !== 'default' ? { profile: activeProfile } : {}),
    ...settings
  }
}

export function getHermesRuntimeSettingsResponse(
  env: RuntimeEnv = loadRuntimeEnv()
): HermesRuntimeSettingsResponse {
  const activeProfile = resolveHermesModelAuthSettings(env).activeProfile.name
  return {
    settings: applyHermesEnvOverrides(
      readSavedHermesSettings(),
      env,
      loadHermesProfileEnv(activeProfile, env)
    ),
    envOverrides: ENV_OVERRIDE_KEYS.filter((key) => Boolean(env[key]?.trim())),
    warnings: loadHermesConfig(env).startupWarnings
  }
}

export function updateHermesRuntimeSettings(
  request: UpdateHermesRuntimeSettingsRequest,
  env: RuntimeEnv = loadRuntimeEnv()
): HermesRuntimeSettingsResponse {
  if (!isRecord(request) || Array.isArray(request)) {
    throw new Error('Hermes settings update must be an object.')
  }

  const current = readSavedHermesSettings()
  const next = normalizeHermesSettings({
    ...current,
    cliPath: request.cliPath === undefined ? current.cliPath : request.cliPath,
    cwd: request.cwd === undefined ? current.cwd : request.cwd,
    model: request.model === undefined ? current.model : request.model,
    providerOverride:
      request.providerOverride === undefined
        ? current.providerOverride
        : request.providerOverride,
    timeoutMs:
      request.timeoutMs === undefined ? current.timeoutMs : request.timeoutMs,
    systemPrompt:
      request.systemPrompt === undefined ? current.systemPrompt : request.systemPrompt,
    gateway: {
      ...current.gateway,
      ...(isRecord(request.gateway) ? request.gateway : {})
    }
  })

  writeSavedHermesSettings(next)
  return getHermesRuntimeSettingsResponse(env)
}

export async function checkHermesStatus(): Promise<HermesHealthCheckResult> {
  const config = loadHermesConfig()

  if (config.e2eMode) {
    return {
      ok: true,
      kind: 'status',
      message: 'Hermes status check skipped in e2e mode.',
      details: `CLI: ${config.cliPath}\nCWD: ${config.cwd}`
    }
  }

  try {
    const result = await execFileAsync(config.cliPath, ['--version'], {
      cwd: config.cwd,
      timeout: 5_000,
      maxBuffer: 256 * 1024
    })
    return {
      ok: true,
      kind: 'status',
      message: 'Hermes CLI is reachable.',
      details:
        [String(result.stdout ?? '').trim(), String(result.stderr ?? '').trim()]
          .filter(Boolean)
          .join('\n') || `${config.cliPath} --version completed.`
    }
  } catch (error) {
    return {
      ok: false,
      kind: 'status',
      message: 'Hermes CLI check failed.',
      details: normalizeCheckError(error)
    }
  }
}

export async function checkHermesCron(): Promise<HermesHealthCheckResult> {
  const config = loadHermesConfig()

  if (config.e2eMode) {
    return {
      ok: true,
      kind: 'cron',
      message: 'Hermes cron check skipped in e2e mode.',
      details: 'Cron list execution is disabled for deterministic e2e runs.'
    }
  }

  try {
    const result = await execFileAsync(config.cliPath, ['cron', 'list'], {
      cwd: config.cwd,
      timeout: Math.min(config.timeoutMs, 10_000),
      maxBuffer: 512 * 1024
    })
    const output = [String(result.stdout ?? '').trim(), String(result.stderr ?? '').trim()]
      .filter(Boolean)
      .join('\n')
    return {
      ok: true,
      kind: 'cron',
      message: output ? 'Hermes cron list returned output.' : 'Hermes cron has no listed jobs.',
      details: output || 'No scheduled jobs were reported.'
    }
  } catch (error) {
    return {
      ok: false,
      kind: 'cron',
      message: 'Hermes cron check failed.',
      details: normalizeCheckError(error)
    }
  }
}

export async function checkHermesGateway(): Promise<HermesHealthCheckResult> {
  const config = loadHermesConfig()

  if (!config.gateway.enabled) {
    return {
      ok: true,
      kind: 'gateway',
      message: 'Hermes API server is disabled in Bonzi settings.',
      details: `${config.gateway.host}:${config.gateway.port}`
    }
  }

  if (config.e2eMode) {
    return {
      ok: true,
      kind: 'gateway',
      message: 'Hermes API server check skipped in e2e mode.',
      details: config.gateway.baseUrl
    }
  }

  try {
    const endpoint = joinGatewayPath(config.gateway.baseUrl, 'models')
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: config.gateway.apiKey
        ? { Authorization: `Bearer ${config.gateway.apiKey}` }
        : {},
      signal: AbortSignal.timeout(5_000)
    })
    const body = await response.text()

    return {
      ok: response.ok,
      kind: 'gateway',
      message: `Hermes API server responded with ${response.status} ${response.statusText}.`,
      details: [endpoint, response.ok ? '' : truncateCheckBody(body)].filter(Boolean).join('\n')
    }
  } catch (error) {
    return {
      ok: false,
      kind: 'gateway',
      message: 'Hermes API server check failed.',
      details: [
        normalizeCheckError(error),
        'Expected Hermes API server endpoint: /v1/models. If only the messaging webhook is running, add API_SERVER_ENABLED=true and API_SERVER_KEY to ~/.hermes/.env, then restart `hermes gateway`.'
      ].join('\n')
    }
  }
}

function applyHermesEnvOverrides(
  settings: HermesRuntimeSettings,
  env: RuntimeEnv,
  hermesProfileEnv: RuntimeEnv = {}
): HermesRuntimeSettings {
  const apiServerEnabled = env.API_SERVER_ENABLED ?? hermesProfileEnv.API_SERVER_ENABLED
  const host =
    normalizeOptionalString(env.API_SERVER_HOST, MAX_STRING_LENGTH) ||
    normalizeOptionalString(hermesProfileEnv.API_SERVER_HOST, MAX_STRING_LENGTH) ||
    settings.gateway.host
  const port = parsePositiveInteger(
    env.API_SERVER_PORT ?? hermesProfileEnv.API_SERVER_PORT,
    settings.gateway.port
  )
  const explicitBaseUrl =
    normalizeOptionalString(env.BONZI_HERMES_GATEWAY_URL, MAX_STRING_LENGTH) ||
    normalizeOptionalString(env.API_SERVER_BASE_URL, MAX_STRING_LENGTH) ||
    normalizeOptionalString(hermesProfileEnv.API_SERVER_BASE_URL, MAX_STRING_LENGTH)
  const hasEndpointOverride = Boolean(
    env.API_SERVER_HOST ||
    hermesProfileEnv.API_SERVER_HOST ||
    env.API_SERVER_PORT ||
    hermesProfileEnv.API_SERVER_PORT
  )
  const gatewayBaseUrl = explicitBaseUrl ||
    (hasEndpointOverride ? `http://${host}:${port}/v1` : settings.gateway.baseUrl)

  return normalizeHermesSettings({
    ...settings,
    cliPath:
      normalizeOptionalString(env.BONZI_HERMES_CLI_PATH, MAX_STRING_LENGTH) ||
      settings.cliPath,
    cwd:
      normalizeOptionalString(env.BONZI_HERMES_CWD, MAX_STRING_LENGTH) ||
      settings.cwd,
    model:
      normalizeOptionalString(env.BONZI_HERMES_MODEL, MAX_STRING_LENGTH) ||
      normalizeOptionalString(env.HERMES_INFERENCE_MODEL, MAX_STRING_LENGTH) ||
      settings.model,
    providerOverride:
      normalizeOptionalString(env.BONZI_HERMES_PROVIDER, MAX_STRING_LENGTH) ||
      normalizeOptionalString(env.HERMES_INFERENCE_PROVIDER, MAX_STRING_LENGTH) ||
      settings.providerOverride,
    timeoutMs: parsePositiveInteger(
      env.BONZI_HERMES_TIMEOUT_MS,
      settings.timeoutMs
    ),
    systemPrompt:
      normalizeOptionalString(env.BONZI_HERMES_SYSTEM_PROMPT, MAX_SYSTEM_PROMPT_LENGTH) ||
      settings.systemPrompt,
    gateway: {
      ...settings.gateway,
      enabled:
        apiServerEnabled?.trim() === undefined
          ? settings.gateway.enabled
          : parseEnabledFlag(apiServerEnabled, settings.gateway.enabled),
      host,
      port,
      baseUrl: gatewayBaseUrl,
      apiKey:
        normalizeOptionalString(env.API_SERVER_KEY, MAX_STRING_LENGTH) ||
        normalizeOptionalString(env.BONZI_HERMES_GATEWAY_API_KEY, MAX_STRING_LENGTH) ||
        normalizeOptionalString(hermesProfileEnv.API_SERVER_KEY, MAX_STRING_LENGTH) ||
        settings.gateway.apiKey
    }
  })
}

function readSavedHermesSettings(): HermesRuntimeSettings {
  const file = readSettingsFile()
  return normalizeHermesSettings(isRecord(file.hermes) ? file.hermes : {})
}

function writeSavedHermesSettings(settings: HermesRuntimeSettings): void {
  const settingsPath = getSettingsPath()
  const file = readSettingsFile()
  mkdirSync(dirname(settingsPath), { recursive: true })
  writeFileSync(
    settingsPath,
    JSON.stringify(
      {
        ...file,
        schemaVersion: 2,
        hermes: settings
      },
      null,
      2
    )
  )
}

function readSettingsFile(): PersistedHermesSettingsFile {
  const settingsPath = getSettingsPath()

  if (!existsSync(settingsPath)) {
    return { schemaVersion: 2 }
  }

  try {
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8'))
    return isRecord(parsed) ? parsed : { schemaVersion: 2 }
  } catch {
    return { schemaVersion: 2 }
  }
}

function normalizeHermesSettings(value: unknown): HermesRuntimeSettings {
  const record = isRecord(value) ? value : {}
  const gatewayRecord = isRecord(record.gateway) ? record.gateway : {}
  const port = parsePositiveInteger(gatewayRecord.port, DEFAULT_GATEWAY_PORT)
  const host = normalizeOptionalString(gatewayRecord.host, MAX_STRING_LENGTH) || '127.0.0.1'
  const model = normalizeOptionalString(record.model, MAX_STRING_LENGTH)
  const providerOverride = normalizeOptionalString(record.providerOverride, MAX_STRING_LENGTH)
  const systemPrompt = normalizeOptionalString(record.systemPrompt, MAX_SYSTEM_PROMPT_LENGTH)
  const apiKey = normalizeOptionalString(gatewayRecord.apiKey, MAX_STRING_LENGTH)

  return {
    cliPath: normalizeOptionalString(record.cliPath, MAX_STRING_LENGTH) || 'hermes',
    cwd: normalizeOptionalString(record.cwd, MAX_STRING_LENGTH) || process.cwd(),
    ...(model ? { model } : {}),
    ...(providerOverride ? { providerOverride } : {}),
    timeoutMs: parsePositiveInteger(record.timeoutMs, DEFAULT_TIMEOUT_MS),
    ...(systemPrompt ? { systemPrompt } : {}),
    gateway: {
      enabled: typeof gatewayRecord.enabled === 'boolean' ? gatewayRecord.enabled : false,
      baseUrl:
        normalizeOptionalString(gatewayRecord.baseUrl, MAX_STRING_LENGTH) ||
        `http://127.0.0.1:${port}/v1`,
      ...(apiKey ? { apiKey } : {}),
      host,
      port
    }
  }
}

function getSettingsPath(): string {
  return join(getUserDataDir(), SETTINGS_FILE_NAME)
}

function getUserDataDir(): string {
  if (process.env.BONZI_USER_DATA_DIR?.trim()) {
    return process.env.BONZI_USER_DATA_DIR.trim()
  }

  try {
    return app.getPath('userData')
  } catch {
    return process.cwd()
  }
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

function loadDotEnv(filePath: string): RuntimeEnv {
  if (!existsSync(filePath)) {
    return {}
  }

  return readFileSync(filePath, 'utf8')
    .split(/\r?\n/u)
    .reduce<RuntimeEnv>((env, line) => {
      const trimmed = line.trim()

      if (!trimmed || trimmed.startsWith('#')) {
        return env
      }

      const normalized = trimmed.startsWith('export ')
        ? trimmed.slice('export '.length)
        : trimmed
      const separatorIndex = normalized.indexOf('=')

      if (separatorIndex <= 0) {
        return env
      }

      const key = normalized.slice(0, separatorIndex).trim()
      const rawValue = normalized.slice(separatorIndex + 1).trim()
      env[key] = rawValue.replace(/^(['"])(.*)\1$/u, '$2')
      return env
    }, {})
}

function loadHermesProfileEnv(profileName: string, env: RuntimeEnv): RuntimeEnv {
  const normalizedProfile = profileName.trim() || 'default'
  const baseHome =
    normalizeOptionalString(env.BONZI_HERMES_HOME, MAX_STRING_LENGTH) ||
    normalizeOptionalString(env.HERMES_HOME, MAX_STRING_LENGTH) ||
    join(homedir(), '.hermes')
  const envPath = normalizedProfile === 'default'
    ? join(baseHome, '.env')
    : join(baseHome, 'profiles', normalizedProfile, '.env')

  return loadDotEnv(envPath)
}

function parsePositiveInteger(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parseEnabledFlag(value: unknown, fallback: boolean): boolean {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!normalized) {
    return fallback
  }

  if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) {
    return false
  }

  if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) {
    return true
  }

  return fallback
}

function normalizeOptionalString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  if (!normalized) {
    return undefined
  }

  return normalized.slice(0, maxLength)
}

function normalizeCheckError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function joinGatewayPath(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/u, '')}/${path.replace(/^\/+/, '')}`
}

function truncateCheckBody(value: string): string {
  const normalized = value.trim()
  if (!normalized) {
    return ''
  }

  return normalized.length > 500 ? `${normalized.slice(0, 499)}…` : normalized
}
