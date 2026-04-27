import { app } from 'electron'
import {
  ELIZA_REQUIRED_PLUGIN_IDS,
  type AssistantProviderInfo,
  type ElizaPluginInstallRequest,
  type ElizaPluginOperationResult,
  type ElizaPluginOperationSnapshot,
  type ElizaPluginSettings,
  type ElizaPluginUninstallRequest
} from '../../shared/contracts'
import { normalizeError, normalizeOptionalString } from '../../shared/value-utils'
import { BonziPluginDiscoveryService } from './plugin-discovery'
import { PluginInstallConfirmationStore } from './plugin-install-confirmations'
import { PluginOperationHistory } from './plugin-operation-history'
import { runCommandWithBoundedOutput } from './plugin-command-runner'
import {
  buildAddCommandPreview,
  normalizeInstallRequest,
  normalizeUninstallRequest
} from './plugin-installer-normalization'
import type {
  CommandRunResult,
  PluginInstallerCommandRunner
} from './plugin-installer-types'
import {
  ensureWorkspacePackageJson,
  parsePositiveInteger,
  resolveBunPath,
  resolvePluginWorkspaceDir
} from './plugin-installer-workspace'
import { BonziPluginSettingsStore } from './plugin-settings'

const DEFAULT_INSTALL_TIMEOUT_MS = 120_000
const DEFAULT_OUTPUT_LIMIT_CHARS = 16_000

interface BonziPluginInstallationServiceOptions {
  settingsStore?: BonziPluginSettingsStore
  discoveryService?: BonziPluginDiscoveryService
  workspaceDir?: string
  userDataDir?: string
  env?: NodeJS.ProcessEnv
  runCommand?: PluginInstallerCommandRunner
}

export class BonziPluginInstallationService {
  private readonly settingsStore: BonziPluginSettingsStore
  private readonly discoveryService: BonziPluginDiscoveryService
  private readonly workspaceDir: string
  private readonly env: NodeJS.ProcessEnv
  private readonly runCommand: PluginInstallerCommandRunner
  private readonly installTimeoutMs: number
  private readonly outputLimitChars: number
  private lock: Promise<void> = Promise.resolve()
  private readonly operationHistory = new PluginOperationHistory()
  private readonly installConfirmations = new PluginInstallConfirmationStore()

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
      this.installConfirmations.preview(operationId, normalized)

      return this.buildOperationResult({
        provider,
        ok: false,
        confirmationRequired: true,
        message:
          'Installing third-party plugins requires confirmation. Re-run with confirmed=true and confirmationOperationId set to this operation id to continue. Install scripts are disabled by default.',
        snapshot: queuedSnapshot
      })
    }

    const confirmationError = this.installConfirmations.validateAndConsume(normalized)
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
          normalized.pluginId ??
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

        const commandResult: CommandRunResult = await this.runCommand({
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

  private recordOperationSnapshot(snapshot: ElizaPluginOperationSnapshot): void {
    this.operationHistory.record(snapshot)
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
        operations: this.operationHistory.list()
      }
    }
  }
}

export { resolvePluginWorkspaceDir }
