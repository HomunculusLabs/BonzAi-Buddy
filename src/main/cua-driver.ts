import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { access } from 'node:fs/promises'
import { delimiter, isAbsolute, join } from 'node:path'
import { tmpdir } from 'node:os'

const CUA_DRIVER_CANDIDATES = [
  '/usr/local/bin/cua-driver',
  '/opt/homebrew/bin/cua-driver'
] as const

const DISCORD_BUNDLE_ID = 'com.hnc.Discord'
const DISCORD_APP_NAME = 'Discord'
const CUA_INSTALL_HELP = [
  'Install Cua Driver manually from the official trycua/cua installer if you want to enable this feature:',
  '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.sh)"',
  'It installs /usr/local/bin/cua-driver and /Applications/CuaDriver.app, requires macOS 14+, and needs Accessibility + Screen Recording permissions.'
].join('\n')

const CUA_ALLOWED_TOOLS = [
  'check_permissions',
  'status',
  'launch_app',
  'list_apps',
  'list_windows',
  'get_window_state',
  'screenshot',
  'scroll',
  'type_text_chars'
] as const

type CuaToolName = (typeof CUA_ALLOWED_TOOLS)[number]
type JsonObject = Record<string, unknown>

interface CuaCommandResult {
  tool: CuaToolName
  args: JsonObject
  stdout: string
  stderr: string
  parsed: unknown
}

export interface CuaDiscordScreenshot {
  imagePath: string
  targetDescription: string
  stateText: string
}

interface CuaDriverPath {
  command: string
  source: 'known-path' | 'path-lookup'
}

interface CuaDiscordTarget {
  windowId?: string | number
  pid?: string | number
  description: string
  windowsOutput: string
}

interface CuaDriverCommandOptions {
  timeoutMs?: number
  imageOutPath?: string
}

class CuaDriverCommandError extends Error {
  readonly tool: CuaToolName
  readonly args: JsonObject
  readonly stdout: string
  readonly stderr: string

  constructor(
    tool: CuaToolName,
    args: JsonObject,
    message: string,
    stdout: string,
    stderr: string
  ) {
    super(message)
    this.name = 'CuaDriverCommandError'
    this.tool = tool
    this.args = args
    this.stdout = stdout
    this.stderr = stderr
  }
}

export async function checkCuaDriverStatus(): Promise<string> {
  if (process.platform !== 'darwin') {
    return 'Cua Driver is macOS-only. This Bonzi build can only inspect Discord through Cua Driver on macOS.'
  }

  const lines: string[] = []
  const driverPath = await resolveCuaDriverPath()

  if (!driverPath) {
    return [
      'Cua Driver executable was not found at /usr/local/bin/cua-driver, /opt/homebrew/bin/cua-driver, or as an absolute executable on PATH.',
      CUA_INSTALL_HELP,
      'If installed but not running, start the daemon manually with: open -n -g -a CuaDriver --args serve'
    ].join('\n\n')
  }

  lines.push(
    driverPath.source === 'known-path'
      ? `Cua Driver executable found at ${driverPath.command}.`
      : `Cua Driver executable found via PATH at ${driverPath.command}.`
  )

  const status = await runStatusTool('status')
  const permissions = await runStatusTool('check_permissions')

  lines.push(formatStatusSection('Daemon status', status))
  lines.push(formatStatusSection('macOS permissions', permissions))

  if (!status.ok || !permissions.ok || driverPath.source === 'path-lookup') {
    lines.push(CUA_INSTALL_HELP)
    lines.push(
      'If installed but not running, start the daemon manually with: open -n -g -a CuaDriver --args serve'
    )
  }

  return truncate(lines.join('\n\n'), 6_000)
}

export async function snapshotDiscordState(query?: string): Promise<string> {
  assertMacOsCuaSupported()

  const normalizedQuery = normalizeOptionalText(query, 200)
  const target = await resolveDiscordTarget()
  const state = await getDiscordWindowState(target, normalizedQuery)
  const targetSummary = target.description ? `Target: ${target.description}\n\n` : ''

  return `${targetSummary}${trimCuaOutput(state, 7_000)}`
}

export async function scrollDiscord(
  direction: 'up' | 'down',
  amount: number | undefined
): Promise<string> {
  assertMacOsCuaSupported()

  const normalizedAmount = normalizeScrollAmount(amount)
  const target = await resolveDiscordTarget()
  const scrollArgs = targetArgs(target, {
    direction,
    amount: normalizedAmount
  })

  const scrollResult = await runFirstSuccessful('scroll', scrollArgs, {
    timeoutMs: 10_000
  })

  let snapshot = ''
  try {
    snapshot = trimCuaOutput(
      await getDiscordWindowState(target, 'current Discord messages after scroll'),
      4_000
    )
  } catch (error) {
    snapshot = `Follow-up snapshot failed: ${normalizeCuaError(error)}`
  }

  return [
    `Scrolled Discord ${direction} by ${normalizedAmount}. No messages were sent.`,
    `Scroll command: ${trimCuaOutput(scrollResult, 1_500)}`,
    `After-scroll snapshot:\n${snapshot}`
  ].join('\n\n')
}

export async function typeDiscordDraft(text: string): Promise<string> {
  assertMacOsCuaSupported()

  const draft = normalizeRequiredText(text, 2_000, 'Discord draft text')
  assertSafeDraftText(draft)
  const target = await resolveDiscordTarget()

  try {
    await getDiscordWindowState(target, 'Discord message composer or focused text input')
  } catch {
    // Best-effort preflight only. Typing remains explicitly confirmation-gated by Bonzi.
  }

  const typeArgs = targetArgs(target, {
    text: draft,
    delay_ms: 10
  }).filter((args) => args.window_id || args.windowId || args.pid || args.bundle_id || args.app_name)

  await runFirstSuccessful('type_text_chars', typeArgs, {
    timeoutMs: Math.max(10_000, Math.min(30_000, draft.length * 100))
  })

  return [
    `Typed a Discord draft (${draft.length} characters).`,
    'Bonzi did not press Enter and did not send the message.',
    'Please review the Discord composer yourself before sending or deleting the draft.'
  ].join(' ')
}

export async function captureDiscordScreenshot(
  query?: string
): Promise<CuaDiscordScreenshot> {
  assertMacOsCuaSupported()

  const target = await resolveDiscordTarget()
  const normalizedQuery = normalizeOptionalText(query, 200)
  const imagePath = join(tmpdir(), `bonzi-discord-${randomUUID()}.jpg`)
  const state = await getDiscordWindowStateImage(target, normalizedQuery, imagePath)

  return {
    imagePath,
    targetDescription: target.description,
    stateText: trimCuaOutput(state, 4_000)
  }
}

async function runStatusTool(
  tool: 'status' | 'check_permissions'
): Promise<{ ok: boolean; result?: CuaCommandResult; error?: string }> {
  try {
    const result = await runCuaDriverTool(tool, {}, { timeoutMs: 8_000 })
    return { ok: true, result }
  } catch (error) {
    return { ok: false, error: normalizeCuaError(error) }
  }
}

function formatStatusSection(
  title: string,
  status: { ok: boolean; result?: CuaCommandResult; error?: string }
): string {
  if (!status.ok) {
    return `${title}: unavailable\n${status.error ?? 'Unknown Cua Driver error.'}`
  }

  return `${title}: OK\n${trimCuaOutput(status.result, 2_000)}`
}

async function resolveDiscordTarget(): Promise<CuaDiscordTarget> {
  const launchErrors: string[] = []

  for (const args of [
    { bundle_id: DISCORD_BUNDLE_ID, app_name: DISCORD_APP_NAME },
    { bundleId: DISCORD_BUNDLE_ID, appName: DISCORD_APP_NAME },
    { name: DISCORD_APP_NAME }
  ]) {
    try {
      await runCuaDriverTool('launch_app', args, { timeoutMs: 15_000 })
      break
    } catch (error) {
      launchErrors.push(normalizeCuaError(error))
    }
  }

  const windows = await listDiscordWindows()
  const target = extractDiscordTarget(windows)

  if (target?.pid === undefined || target.windowId === undefined) {
    const rawWindows = await listAllWindowsRaw().catch(() => null)
    const rawTarget = rawWindows ? extractDiscordTarget(rawWindows) : null

    if (rawTarget?.pid !== undefined && rawTarget.windowId !== undefined) {
      return rawTarget
    }
  }

  if (target) {
    return target
  }

  const windowsOutput = trimCuaOutput(windows, 3_000)
  return {
    description: `Discord app (${DISCORD_BUNDLE_ID}); no specific window id was found`,
    windowsOutput: [windowsOutput, ...launchErrors.map((error) => `Launch warning: ${error}`)].join('\n')
  }
}

async function listDiscordWindows(): Promise<CuaCommandResult> {
  return listAllWindowsRaw()
}

async function listAllWindowsRaw(): Promise<CuaCommandResult> {
  return runCuaDriverTool('list_windows', {}, { timeoutMs: 10_000 })
}

async function getDiscordWindowState(
  target: CuaDiscordTarget,
  query: string | undefined
): Promise<CuaCommandResult> {
  const variants = targetArgs(target, query ? { query } : {})
  return runFirstSuccessful('get_window_state', variants, { timeoutMs: 15_000 })
}

async function getDiscordWindowStateImage(
  target: CuaDiscordTarget,
  query: string | undefined,
  imagePath: string
): Promise<CuaCommandResult> {
  const variants = targetArgs(target, query ? { query } : {})
  return runFirstSuccessful('get_window_state', variants, {
    timeoutMs: 15_000,
    imageOutPath: imagePath
  })
}

function targetArgs(target: CuaDiscordTarget, extra: JsonObject): JsonObject[] {
  const variants: JsonObject[] = []

  if (target.pid !== undefined && target.windowId !== undefined) {
    variants.push({ pid: target.pid, window_id: target.windowId, ...extra })
    variants.push({ pid: target.pid, windowId: target.windowId, ...extra })
  }

  if (target.pid !== undefined) {
    variants.push({ pid: target.pid, ...extra })
  }

  if (target.windowId !== undefined) {
    variants.push({ window_id: target.windowId, ...extra })
    variants.push({ windowId: target.windowId, ...extra })
  }

  variants.push({ bundle_id: DISCORD_BUNDLE_ID, app_name: DISCORD_APP_NAME, ...extra })
  variants.push({ app_name: DISCORD_APP_NAME, ...extra })
  variants.push({ name: DISCORD_APP_NAME, ...extra })

  return variants
}

async function runFirstSuccessful(
  tool: CuaToolName,
  variants: JsonObject[],
  options: CuaDriverCommandOptions
): Promise<CuaCommandResult> {
  const errors: string[] = []

  for (const args of variants) {
    try {
      return await runCuaDriverTool(tool, args, options)
    } catch (error) {
      errors.push(normalizeCuaError(error))
    }
  }

  throw new Error(
    `Cua Driver ${tool} failed for all safe Discord target variants.\n${errors.join('\n---\n')}`
  )
}

async function runCuaDriverTool(
  tool: CuaToolName,
  args: JsonObject = {},
  options: CuaDriverCommandOptions = {}
): Promise<CuaCommandResult> {
  if (!CUA_ALLOWED_TOOLS.includes(tool)) {
    throw new Error(`Cua Driver tool is not allowlisted: ${tool}`)
  }

  assertMacOsCuaSupported()

  const driverPath = await resolveCuaDriverPath()

  if (!driverPath) {
    throw new Error(`Cua Driver executable was not found.\n${CUA_INSTALL_HELP}`)
  }

  const serializedArgs = JSON.stringify(args)
  const commandArgs = options.imageOutPath
    ? ['call', tool, serializedArgs, '--image-out', options.imageOutPath]
    : [tool, serializedArgs]

  return new Promise((resolve, reject) => {
    execFile(
      driverPath.command,
      commandArgs,
      {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        timeout: options.timeoutMs ?? 12_000,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        const normalizedStdout = String(stdout ?? '')
        const normalizedStderr = String(stderr ?? '')

        if (error) {
          const message =
            isMissingExecutableError(error) && driverPath.source === 'path-lookup'
              ? `Cua Driver executable was not found.\n${CUA_INSTALL_HELP}`
              : `${error.message}${normalizedStderr ? `\n${normalizedStderr}` : ''}`

          reject(
            new CuaDriverCommandError(
              tool,
              args,
              message,
              normalizedStdout,
              normalizedStderr
            )
          )
          return
        }

        resolve({
          tool,
          args,
          stdout: normalizedStdout,
          stderr: normalizedStderr,
          parsed: parseJsonMaybe(normalizedStdout)
        })
      }
    )
  })
}

async function resolveCuaDriverPath(): Promise<CuaDriverPath | null> {
  for (const candidate of CUA_DRIVER_CANDIDATES) {
    try {
      await access(candidate, fsConstants.X_OK)
      return { command: candidate, source: 'known-path' }
    } catch {
      // Try the next known install path.
    }
  }

  for (const pathEntry of (process.env.PATH ?? '').split(delimiter)) {
    if (!pathEntry || !isAbsolute(pathEntry)) {
      continue
    }

    const candidate = join(pathEntry, 'cua-driver')

    try {
      await access(candidate, fsConstants.X_OK)
      return { command: candidate, source: 'path-lookup' }
    } catch {
      // Keep searching PATH entries.
    }
  }

  return null
}

function extractDiscordTarget(result: CuaCommandResult): CuaDiscordTarget | null {
  const records = collectRecords(
    result.parsed ?? parseJsonMaybe(result.stdout) ?? parseJsonMaybe(result.stderr)
  )

  for (const record of records) {
    if (!recordLooksLikeDiscord(record)) {
      continue
    }

    const windowId = firstRecordValue(record, [
      'window_id',
      'windowId',
      'windowID',
      'id'
    ])
    const pid = firstRecordValue(record, ['pid', 'process_id', 'processId'])

    if (pid !== undefined && windowId !== undefined) {
      return {
        windowId,
        pid,
        description: describeRecord(record),
        windowsOutput: trimCuaOutput(result, 3_000)
      }
    }
  }

  const discordLine = result.stdout
    .split(/\r?\n/)
    .find((line) => /discord|com\.hnc\.discord/i.test(line))

  if (discordLine) {
    return {
      ...extractIdsFromText(discordLine),
      description: discordLine.trim(),
      windowsOutput: trimCuaOutput(result, 3_000)
    }
  }

  return null
}

function collectRecords(value: unknown): JsonObject[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectRecords)
  }

  if (!isRecord(value)) {
    return []
  }

  return [
    value,
    ...Object.values(value).flatMap((child) =>
      typeof child === 'object' && child !== null ? collectRecords(child) : []
    )
  ]
}

function recordLooksLikeDiscord(record: JsonObject): boolean {
  return Object.values(record).some(
    (value) => typeof value === 'string' && /discord|com\.hnc\.discord/i.test(value)
  )
}

function firstRecordValue(
  record: JsonObject,
  keys: string[]
): string | number | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' || typeof value === 'number') {
      return value
    }
  }

  return undefined
}

function describeRecord(record: JsonObject): string {
  const title = firstRecordValue(record, ['title', 'name', 'app_name', 'appName'])
  const windowId = firstRecordValue(record, ['window_id', 'windowId', 'id'])
  const pid = firstRecordValue(record, ['pid', 'process_id', 'processId'])

  return [
    title ? String(title) : DISCORD_APP_NAME,
    windowId !== undefined ? `window=${String(windowId)}` : '',
    pid !== undefined ? `pid=${String(pid)}` : ''
  ]
    .filter(Boolean)
    .join(' ')
}

function extractIdsFromText(text: string): Pick<CuaDiscordTarget, 'windowId' | 'pid'> {
  const windowId = text.match(/(?:window[_\s-]?id|window)\D+(\d+)/i)?.[1]
  const pid = text.match(/(?:pid|process[_\s-]?id|process)\D+(\d+)/i)?.[1]

  return {
    ...(windowId ? { windowId } : {}),
    ...(pid ? { pid } : {})
  }
}

function parseJsonMaybe(text: string): unknown {
  const trimmed = text.trim()

  if (!trimmed) {
    return undefined
  }

  try {
    return JSON.parse(trimmed)
  } catch {
    const firstObject = trimmed.search(/[\[{]/)
    const lastObject = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'))

    if (firstObject >= 0 && lastObject > firstObject) {
      try {
        return JSON.parse(trimmed.slice(firstObject, lastObject + 1))
      } catch {
        return undefined
      }
    }

    return undefined
  }
}

function trimCuaOutput(result: CuaCommandResult | undefined, maxLength: number): string {
  if (!result) {
    return ''
  }

  const output =
    result.parsed !== undefined
      ? JSON.stringify(result.parsed, null, 2)
      : [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n')

  return truncate(output || '(Cua Driver returned no output.)', maxLength)
}

function normalizeScrollAmount(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 5
  }

  return Math.max(1, Math.min(10, Math.round(value as number)))
}

function normalizeOptionalText(value: unknown, maxLength: number): string | undefined {
  const text = typeof value === 'string' ? value.trim() : ''
  return text ? truncate(text, maxLength) : undefined
}

function normalizeRequiredText(value: unknown, maxLength: number, label: string): string {
  const text = normalizeOptionalText(value, maxLength)

  if (!text) {
    throw new Error(`${label} is required.`)
  }

  return text
}

function assertSafeDraftText(text: string): void {
  if (/[\r\n\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u.test(text)) {
    throw new Error(
      'Discord draft text cannot include line breaks or control characters because Bonzi will not press Enter or send messages. Use a single-line draft.'
    )
  }
}

function normalizeCuaError(error: unknown): string {
  if (error instanceof CuaDriverCommandError) {
    return truncate(
      [error.message, error.stdout.trim(), error.stderr.trim()].filter(Boolean).join('\n'),
      2_500
    )
  }

  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function assertMacOsCuaSupported(): void {
  if (process.platform !== 'darwin') {
    throw new Error('Cua Driver Discord integration is macOS-only and is unsupported on this platform.')
  }
}

function isMissingExecutableError(error: Error & { code?: unknown }): boolean {
  return error.code === 'ENOENT'
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength - 1)}…`
}
