import { app } from 'electron'
import { accessSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import {
  ELIZA_REQUIRED_PLUGIN_IDS,
  type AssistantProviderInfo,
  type ElizaPluginInstallRequest,
  type ElizaPluginOperationResult,
  type ElizaPluginOperationSnapshot,
  type ElizaPluginOperationStatus,
  type ElizaPluginSettings,
  type ElizaPluginUninstallRequest
} from '../../shared/contracts'
import { BonziPluginDiscoveryService } from './plugin-discovery'
import { BonziPluginSettingsStore } from './plugin-settings'

const DEFAULT_WORKSPACE_DIR_NAME = 'eliza-plugin-workspace'
const DEFAULT_INSTALL_TIMEOUT_MS = 120_000
const DEFAULT_OUTPUT_LIMIT_CHARS = 16_000
const OPERATION_HISTORY_LIMIT = 24
const INSTALL_CONFIRMATION_TTL_MS = 5 * 60 * 1000

interface BonziPluginInstallationServiceOptions {
  settingsStore?: BonziPluginSettingsStore
  discoveryService?: BonziPluginDiscoveryService
  workspaceDir?: string
  userDataDir?: string
  env?: NodeJS.ProcessEnv
  runCommand?: (options: {
    command: string
    args: string[]
    cwd: string
    timeoutMs: number
    outputLimitChars: number
  }) => Promise<CommandRunResult>
}

interface CommandRunResult {
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
}

interface NormalizedInstallRequest {
  pluginId: string
  packageName: string
  versionRange?: string
  registryRef?: string
  confirmed: boolean
  confirmationOperationId?: string
  ignoreScripts: boolean
}

interface NormalizedUninstallRequest {
  pluginId?: string
  packageName?: string
  confirmed: boolean
}

export class BonziPluginInstallationService {
  private readonly settingsStore: BonziPluginSettingsStore
  private readonly discoveryService: BonziPluginDiscoveryService
  private readonly workspaceDir: string
  private readonly env: NodeJS.ProcessEnv
  private readonly runCommand: NonNullable<BonziPluginInstallationServiceOptions['runCommand']>
  private readonly installTimeoutMs: number
  private readonly outputLimitChars: number
  private lock: Promise<void> = Promise.resolve()
  private readonly operationHistory: ElizaPluginOperationSnapshot[] = []
  private readonly pendingInstallConfirmations = new Map<
    string,
    { request: NormalizedInstallRequest; expiresAt: number }
  >()

  constructor(options: BonziPluginInstallationServiceOptions = {}) {
    this.settingsStore = options.settingsStore ?? new BonziPluginSettingsStore()
    this.discoveryService =
      options.discoveryService ??
      new BonziPluginDiscoveryService({ settingsStore: this.settingsStore })
    this.env = options.env ?? process.env
    const userDataDir = options.userDataDir ?? app.getPath('userData')
    this.workspaceDir = resolvePluginWorkspaceDir({
      env: this.env,
      explicit: options.workspaceDir,
      userDataDir
    })
    this.installTimeoutMs = parsePositiveInteger(
      this.env.BONZI_PLUGIN_INSTALL_TIMEOUT_MS,
      DEFAULT_INSTALL_TIMEOUT_MS
    )
    this.outputLimitChars = parsePositiveInteger(
      this.env.BONZI_PLUGIN_INSTALL_OUTPUT_LIMIT,
      DEFAULT_OUTPUT_LIMIT_CHARS
    )
    this.runCommand = options.runCommand ?? runCommandWithBoundedOutput
  }

  async install(
    provider: AssistantProviderInfo,
    request: ElizaPluginInstallRequest
  ): Promise<ElizaPluginOperationResult> {
    const normalized = normalizeInstallRequest(request)
    const operationId = crypto.randomUUID()
    const startTime = new Date().toISOString()
    const commandPreview = buildAddCommandPreview(normalized)

    const queuedSnapshot: ElizaPluginOperationSnapshot = {
      operationId,
      type: 'install',
      pluginId: normalized.pluginId,
      status: 'queued',
      startedAt: startTime,
      workspaceDir: this.workspaceDir,
      command: commandPreview,
      timeoutMs: this.installTimeoutMs
    }
    this.recordOperationSnapshot(queuedSnapshot)

    if (!normalized.confirmed) {
      this.pendingInstallConfirmations.set(operationId, {
        request: normalized,
        expiresAt: Date.now() + INSTALL_CONFIRMATION_TTL_MS
      })

      return this.buildOperationResult({
        provider,
        ok: false,
        confirmationRequired: true,
        message:
          'Installing third-party plugins requires confirmation. Re-run with confirmed=true and confirmationOperationId set to this operation id to continue. Install scripts are disabled by default.',
        snapshot: queuedSnapshot
      })
    }

    const confirmationError = this.validateInstallConfirmation(normalized)
    if (confirmationError) {
      const failedSnapshot: ElizaPluginOperationSnapshot = {
        ...queuedSnapshot,
        status: 'failed',
        finishedAt: new Date().toISOString(),
        error: confirmationError
      }
      this.recordOperationSnapshot(failedSnapshot)
      return this.buildOperationResult({
        provider,
        ok: false,
        confirmationRequired: true,
        message: confirmationError,
        snapshot: failedSnapshot
      })
    }

    return this.withLock(async () => {
      let runningSnapshot: ElizaPluginOperationSnapshot = {
        ...queuedSnapshot,
        status: 'running'
      }
      this.recordOperationSnapshot(runningSnapshot)

      try {
        const bunPath = resolveBunPath(this.env)
        ensureWorkspacePackageJson(this.workspaceDir)
        const installSpec = normalized.versionRange
          ? `${normalized.packageName}@${normalized.versionRange}`
          : normalized.packageName
        const args = ['add', installSpec]

        if (normalized.ignoreScripts) {
          args.push('--ignore-scripts')
        }

        const commandResult = await this.runCommand({
          command: bunPath,
          args,
          cwd: this.workspaceDir,
          timeoutMs: this.installTimeoutMs,
          outputLimitChars: this.outputLimitChars
        })

        runningSnapshot = {
          ...runningSnapshot,
          stdout: commandResult.stdout,
          stderr: commandResult.stderr
        }

        if (commandResult.timedOut) {
          throw new Error(
            `Plugin installation timed out after ${this.installTimeoutMs}ms.`
          )
        }

        if (commandResult.exitCode !== 0) {
          throw new Error(
            `bun add failed${commandResult.exitCode === null ? '' : ` (exit code ${commandResult.exitCode})`}.`
          )
        }

        this.settingsStore.upsertInstalledPluginRecord({
          pluginId: normalized.pluginId,
          packageName: normalized.packageName,
          versionRange: normalized.versionRange,
          registryRef: normalized.registryRef,
          source: normalized.registryRef ? 'registry' : 'installed-package',
          executionPolicy: 'confirm_each_action',
          lifecycleStatus: 'installed',
          enabled: false
        })

        const succeededSnapshot: ElizaPluginOperationSnapshot = {
          ...runningSnapshot,
          status: 'succeeded',
          finishedAt: new Date().toISOString()
        }
        this.recordOperationSnapshot(succeededSnapshot)

        return this.buildOperationResult({
          provider,
          ok: true,
          confirmationRequired: false,
          message: `Installed ${normalized.packageName}. Plugin is saved disabled by default.`,
          snapshot: succeededSnapshot
        })
      } catch (error) {
        const failedSnapshot: ElizaPluginOperationSnapshot = {
          ...runningSnapshot,
          status: 'failed',
          finishedAt: new Date().toISOString(),
          error: normalizeError(error)
        }
        this.recordOperationSnapshot(failedSnapshot)

        return this.buildOperationResult({
          provider,
          ok: false,
          confirmationRequired: false,
          message: failedSnapshot.error ?? 'Plugin install failed.',
          snapshot: failedSnapshot
        })
      }
    })
  }

  async uninstall(
    provider: AssistantProviderInfo,
    request: ElizaPluginUninstallRequest
  ): Promise<ElizaPluginOperationResult> {
    const normalized = normalizeUninstallRequest(request)
    const operationId = crypto.randomUUID()
    const startTime = new Date().toISOString()
    const queuedSnapshot: ElizaPluginOperationSnapshot = {
      operationId,
      type: 'uninstall',
      pluginId: normalized.pluginId,
      status: 'queued',
      startedAt: startTime,
      workspaceDir: this.workspaceDir,
      timeoutMs: this.installTimeoutMs
    }
    this.recordOperationSnapshot(queuedSnapshot)

    if (!normalized.confirmed) {
      return this.buildOperationResult({
        provider,
        ok: false,
        confirmationRequired: true,
        message:
          'Uninstalling third-party plugins requires confirmation. Re-run with confirmed=true to continue.',
        snapshot: queuedSnapshot
      })
    }

    return this.withLock(async () => {
      let runningSnapshot: ElizaPluginOperationSnapshot = {
        ...queuedSnapshot,
        status: 'running'
      }
      this.recordOperationSnapshot(runningSnapshot)

      try {
        const persisted = this.settingsStore.getPersistedPluginInventorySnapshot()
        const pluginId =
          normalizePluginId(normalized.pluginId) ??
          (normalized.packageName
            ? this.settingsStore.findPluginIdByPackageName(normalized.packageName)
            : null)

        if (!pluginId) {
          throw new Error('Could not resolve a plugin id for uninstall request.')
        }

        if ((ELIZA_REQUIRED_PLUGIN_IDS as readonly string[]).includes(pluginId)) {
          throw new Error(`Cannot uninstall required Bonzi plugin "${pluginId}".`)
        }

        const record = persisted[pluginId]

        if (!record?.installed) {
          throw new Error(`Plugin "${pluginId}" is not installed.`)
        }

        if (record.source === 'required' || record.source === 'bonzi-builtin') {
          throw new Error(
            `Plugin "${pluginId}" is managed by Bonzi and cannot be uninstalled here.`
          )
        }

        const packageName =
          normalizeOptionalString(normalized.packageName) ?? record.packageName

        if (!packageName) {
          throw new Error(
            `Plugin "${pluginId}" does not have a package name available for uninstall.`
          )
        }

        const bunPath = resolveBunPath(this.env)
        ensureWorkspacePackageJson(this.workspaceDir)

        const commandResult = await this.runCommand({
          command: bunPath,
          args: ['remove', packageName],
          cwd: this.workspaceDir,
          timeoutMs: this.installTimeoutMs,
          outputLimitChars: this.outputLimitChars
        })

        runningSnapshot = {
          ...runningSnapshot,
          pluginId,
          command: `${bunPath} remove ${packageName}`,
          stdout: commandResult.stdout,
          stderr: commandResult.stderr
        }

        if (commandResult.timedOut) {
          throw new Error(
            `Plugin uninstall timed out after ${this.installTimeoutMs}ms.`
          )
        }

        if (commandResult.exitCode !== 0) {
          throw new Error(
            `bun remove failed${commandResult.exitCode === null ? '' : ` (exit code ${commandResult.exitCode})`}.`
          )
        }

        this.settingsStore.removePluginRecord(pluginId)

        const succeededSnapshot: ElizaPluginOperationSnapshot = {
          ...runningSnapshot,
          status: 'succeeded',
          finishedAt: new Date().toISOString()
        }
        this.recordOperationSnapshot(succeededSnapshot)

        return this.buildOperationResult({
          provider,
          ok: true,
          confirmationRequired: false,
          message: `Uninstalled ${packageName}.`,
          snapshot: succeededSnapshot
        })
      } catch (error) {
        const failedSnapshot: ElizaPluginOperationSnapshot = {
          ...runningSnapshot,
          status: 'failed',
          finishedAt: new Date().toISOString(),
          error: normalizeError(error)
        }
        this.recordOperationSnapshot(failedSnapshot)

        return this.buildOperationResult({
          provider,
          ok: false,
          confirmationRequired: false,
          message: failedSnapshot.error ?? 'Plugin uninstall failed.',
          snapshot: failedSnapshot
        })
      }
    })
  }

  private async withLock<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.lock
    let release: () => void = () => undefined
    this.lock = new Promise<void>((resolve) => {
      release = resolve
    })

    await previous

    try {
      return await task()
    } finally {
      release()
    }
  }

  private validateInstallConfirmation(request: NormalizedInstallRequest): string | null {
    const confirmationId = normalizeOptionalString(request.confirmationOperationId)

    if (!confirmationId) {
      return 'Install confirmation requires confirmationOperationId from a prior preview operation.'
    }

    const pending = this.pendingInstallConfirmations.get(confirmationId)

    if (!pending) {
      return 'Install confirmation was not found or has already been used.'
    }

    this.pendingInstallConfirmations.delete(confirmationId)

    if (pending.expiresAt < Date.now()) {
      return 'Install confirmation expired. Preview the install again.'
    }

    if (
      pending.request.pluginId !== request.pluginId ||
      pending.request.packageName !== request.packageName ||
      pending.request.versionRange !== request.versionRange ||
      pending.request.registryRef !== request.registryRef
    ) {
      return 'Install confirmation does not match the previewed package request.'
    }

    return null
  }

  private recordOperationSnapshot(snapshot: ElizaPluginOperationSnapshot): void {
    const index = this.operationHistory.findIndex(
      (operation) => operation.operationId === snapshot.operationId
    )

    if (index >= 0) {
      this.operationHistory[index] = snapshot
      return
    }

    this.operationHistory.unshift(snapshot)

    if (this.operationHistory.length > OPERATION_HISTORY_LIMIT) {
      this.operationHistory.length = OPERATION_HISTORY_LIMIT
    }
  }

  private async buildOperationResult(options: {
    provider: AssistantProviderInfo
    ok: boolean
    confirmationRequired: boolean
    message: string
    snapshot: ElizaPluginOperationSnapshot
  }): Promise<ElizaPluginOperationResult> {
    const discovered = await this.discoveryService.discover(options.provider)

    return {
      ok: options.ok,
      confirmationRequired: options.confirmationRequired,
      message: options.message,
      operation: options.snapshot,
      settings: {
        ...discovered,
        operations: [...this.operationHistory]
      }
    }
  }
}

function normalizeInstallRequest(request: ElizaPluginInstallRequest): NormalizedInstallRequest {
  const packageName = normalizeOptionalString(request.packageName)

  if (!packageName) {
    throw new Error('Install request must include a packageName.')
  }

  return {
    pluginId:
      normalizePluginId(request.pluginId ?? request.id) ??
      derivePluginIdFromPackageName(packageName),
    packageName,
    versionRange: normalizeOptionalString(request.versionRange),
    registryRef: normalizeOptionalString(request.registryRef),
    confirmed: request.confirmed === true,
    confirmationOperationId: normalizeOptionalString(request.confirmationOperationId),
    ignoreScripts: request.ignoreScripts !== false
  }
}

function normalizeUninstallRequest(
  request: ElizaPluginUninstallRequest
): NormalizedUninstallRequest {
  return {
    pluginId: normalizePluginId(request.pluginId ?? request.id),
    packageName: normalizeOptionalString(request.packageName),
    confirmed: request.confirmed === true
  }
}

function derivePluginIdFromPackageName(packageName: string): string {
  const lastSegment = packageName.split('/').at(-1) ?? packageName
  const stripped = lastSegment.replace(/^plugin-/, '').trim()

  if (!stripped) {
    throw new Error(`Could not derive plugin id from package name "${packageName}".`)
  }

  return stripped
}

function buildAddCommandPreview(request: NormalizedInstallRequest): string {
  const spec = request.versionRange
    ? `${request.packageName}@${request.versionRange}`
    : request.packageName
  const suffix = request.ignoreScripts ? ' --ignore-scripts' : ' --allow-scripts'
  return `bun add ${spec}${suffix}`
}

function ensureWorkspacePackageJson(workspaceDir: string): void {
  mkdirSync(workspaceDir, { recursive: true })
  const packageJsonPath = join(workspaceDir, 'package.json')

  if (!existsSync(packageJsonPath)) {
    writeFileSync(
      packageJsonPath,
      JSON.stringify(
        {
          private: true,
          type: 'module',
          dependencies: {}
        },
        null,
        2
      )
    )
    return
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  } catch {
    throw new Error('Plugin workspace package.json exists but is not valid JSON.')
  }

  if (!isRecord(parsed)) {
    throw new Error('Plugin workspace package.json must contain a JSON object.')
  }

  const dependencies = isRecord(parsed.dependencies) ? parsed.dependencies : {}
  const normalized = {
    ...parsed,
    private: true,
    type: 'module',
    dependencies
  }

  writeFileSync(packageJsonPath, JSON.stringify(normalized, null, 2))
}

export function resolvePluginWorkspaceDir(options: {
  env: NodeJS.ProcessEnv
  explicit?: string
  userDataDir: string
}): string {
  const fallback = join(options.userDataDir, DEFAULT_WORKSPACE_DIR_NAME)
  const explicit = normalizeOptionalString(options.explicit)

  if (explicit) {
    return explicit
  }

  const envWorkspaceDir = normalizeOptionalString(options.env.BONZI_PLUGIN_WORKSPACE_DIR)

  if (!envWorkspaceDir) {
    return fallback
  }

  if (isAbsolute(envWorkspaceDir)) {
    return envWorkspaceDir
  }

  return fallback
}

function resolveBunPath(env: NodeJS.ProcessEnv): string {
  const explicitPath = normalizeOptionalString(env.BONZI_BUN_PATH)

  if (explicitPath) {
    assertExecutable(explicitPath, 'BONZI_BUN_PATH')
    return explicitPath
  }

  const pathValue = normalizeOptionalString(env.PATH)

  if (!pathValue) {
    throw new Error(
      'Could not locate Bun. Set BONZI_BUN_PATH or ensure bun is available on PATH.'
    )
  }

  for (const segment of pathValue.split(delimiter)) {
    const normalizedSegment = normalizeOptionalString(segment)
    if (!normalizedSegment) {
      continue
    }

    const candidate = join(normalizedSegment, 'bun')

    if (!isExecutable(candidate)) {
      continue
    }

    return candidate
  }

  throw new Error(
    'Could not locate Bun. Set BONZI_BUN_PATH or ensure bun is available on PATH.'
  )
}

function assertExecutable(path: string, envVarName: string): void {
  if (!isExecutable(path)) {
    throw new Error(`${envVarName} points to a non-executable path: ${path}`)
  }
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)

  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed
  }

  return fallback
}

function normalizePluginId(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

async function runCommandWithBoundedOutput(options: {
  command: string
  args: string[]
  cwd: string
  timeoutMs: number
  outputLimitChars: number
}): Promise<CommandRunResult> {
  return new Promise<CommandRunResult>((resolve, reject) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false

    const timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref()
    }, options.timeoutMs)

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout = appendBounded(stdout, chunk.toString(), options.outputLimitChars)
    })

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr = appendBounded(stderr, chunk.toString(), options.outputLimitChars)
    })

    child.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })

    child.on('close', (code) => {
      clearTimeout(timeout)
      resolve({
        stdout,
        stderr,
        exitCode: code,
        timedOut
      })
    })
  })
}

function appendBounded(current: string, addition: string, limit: number): string {
  const combined = `${current}${addition}`

  if (combined.length <= limit) {
    return combined
  }

  return combined.slice(combined.length - limit)
}
