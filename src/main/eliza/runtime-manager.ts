import { app, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import {
  ASSISTANT_ACTION_TYPES,
  type AssistantAction,
  type AssistantActionType,
  type AssistantEvent,
  type AssistantMessage,
  type AssistantTurnEventPayload,
  type AssistantProviderInfo,
  type AssistantRuntimeStatus,
  type BonziWorkflowRunSnapshot,
  type ElizaCharacterSettings,
  type ElizaPluginDiscoveryRequest,
  type ElizaPluginInstallRequest,
  type ElizaPluginOperationResult,
  type ElizaPluginSettings,
  type ElizaPluginUninstallRequest,
  type ImportKnowledgeDocumentsRequest,
  type KnowledgeImportResult,
  type KnowledgeImportStatus,
  type RuntimeApprovalSettings,
  type ShellState,
  type UpdateElizaCharacterSettingsRequest,
  type UpdateElizaPluginSettingsRequest,
  type UpdateRuntimeApprovalSettingsRequest
} from '../../shared/contracts'
import { executeWorkflowBonziDesktopAction } from '../assistant-action-executor'
import type { DiscordBrowserActionService } from '../discord-browser-service'
import { normalizeError } from '../../shared/value-utils'
import { BonziPluginDiscoveryService } from './plugin-discovery'
import { BonziPluginInstallationService } from './plugin-installer'
import { BonziPluginRuntimeResolver } from './plugin-runtime-resolver'
import { BonziPluginSettingsStore } from './plugin-settings'
import { BonziRuntimeConfigState } from './runtime-config-state'
import { BonziRuntimeEventEmitter } from './runtime-event-emitter'
import { BonziRuntimeLifecycle } from './runtime-lifecycle'
import { BonziRuntimeMemoryService } from './runtime-memory-service'
import {
  BonziRuntimeTurnRunner,
  type BonziRuntimeTurn
} from './runtime-turn-runner'
import {
  BonziWorkflowManager,
  type WorkflowExternalActionState
} from './workflow-manager'
import { isTerminalRunStatus } from './workflow-snapshot-utils'

export type { BonziProposedAction } from './runtime-action-proposals'
export type { BonziRuntimeTurn } from './runtime-turn-runner'

interface BonziRuntimeManagerOptions {
  getShellState: () => ShellState
  getCompanionWindow?: () => BrowserWindow | null
  discordBrowserService: DiscordBrowserActionService
  dataDir?: string
  workflowRunsPath?: string
}

export class BonziRuntimeManager {
  private readonly getShellState: () => ShellState
  private readonly getCompanionWindow: () => BrowserWindow | null
  private readonly configState = new BonziRuntimeConfigState()
  private readonly events = new BonziRuntimeEventEmitter()
  private readonly pluginSettingsStore = new BonziPluginSettingsStore()
  private readonly pluginDiscoveryService = new BonziPluginDiscoveryService({
    settingsStore: this.pluginSettingsStore
  })
  private readonly pluginInstallationService = new BonziPluginInstallationService({
    settingsStore: this.pluginSettingsStore,
    discoveryService: this.pluginDiscoveryService
  })
  private readonly pluginRuntimeResolver: BonziPluginRuntimeResolver
  private readonly workflowManager: BonziWorkflowManager
  private readonly lifecycle: BonziRuntimeLifecycle
  private readonly memoryService: BonziRuntimeMemoryService
  private readonly turnRunner: BonziRuntimeTurnRunner
  private readonly unsubscribeWorkflowEvents: () => void

  constructor(options: BonziRuntimeManagerOptions) {
    this.getShellState = options.getShellState
    this.getCompanionWindow = options.getCompanionWindow ?? (() => null)
    this.workflowManager = new BonziWorkflowManager({
      persistencePath: options.workflowRunsPath
    })
    this.workflowManager.setApprovalsEnabled(
      this.pluginSettingsStore.getRuntimeApprovalSettings().approvalsEnabled
    )
    this.pluginRuntimeResolver = new BonziPluginRuntimeResolver({
      settingsStore: this.pluginSettingsStore,
      userDataDir: app.getPath('userData'),
      workflowManager: this.workflowManager,
      bonziDesktopActionGateway: {
        execute: async ({ proposal, approved }) => {
          try {
            const message = await executeWorkflowBonziDesktopAction(
              proposal,
              {
                shellState: this.getShellState(),
                companionWindow: this.getCompanionWindow(),
                discordBrowserService: options.discordBrowserService
              },
              { approved }
            )

            await this.recordActionObservation(
              {
                type: proposal.type,
                title: `Workflow ${proposal.type}`,
                status: 'completed',
                params: proposal.params
              },
              message
            )
            return message
          } catch (error) {
            const message = normalizeError(error)
            await this.recordActionObservation(
              {
                type: proposal.type,
                title: `Workflow ${proposal.type}`,
                status: 'failed',
                params: proposal.params
              },
              message
            )
            throw error
          }
        }
      }
    })
    this.lifecycle = new BonziRuntimeLifecycle({
      dataDir: options.dataDir ?? join(app.getPath('userData'), 'eliza-localdb'),
      configState: this.configState,
      pluginSettingsStore: this.pluginSettingsStore,
      pluginRuntimeResolver: this.pluginRuntimeResolver,
      getShellState: this.getShellState,
      onRuntimeStatus: (status) => {
        this.events.emit({
          type: 'runtime-status',
          status
        })
      }
    })
    this.memoryService = new BonziRuntimeMemoryService({
      getRuntime: () => this.lifecycle.getOrCreateRuntime(),
      canSkipHistoryRuntimeHydration: () =>
        this.lifecycle.canSkipHistoryRuntimeHydration()
    })
    this.turnRunner = new BonziRuntimeTurnRunner({
      configState: this.configState,
      getRuntime: () => this.lifecycle.getOrCreateRuntime(),
      workflowManager: this.workflowManager
    })
    this.unsubscribeWorkflowEvents = this.workflowManager.subscribe((run) => {
      this.events.emit({
        type: 'workflow-run-updated',
        run
      })
    })
    this.configState.sync()
  }

  getProviderInfo(): AssistantProviderInfo {
    this.configState.sync()
    return this.configState.getProviderInfo()
  }

  getStartupWarnings(): string[] {
    this.configState.sync()
    return this.configState.getStartupWarnings()
  }

  getRuntimeStatus(): AssistantRuntimeStatus {
    return this.lifecycle.getRuntimeStatus()
  }

  getPluginSettings(): ElizaPluginSettings {
    return this.pluginSettingsStore.getSettings(this.getProviderInfo())
  }

  getRuntimeApprovalSettings(): RuntimeApprovalSettings {
    return this.pluginSettingsStore.getRuntimeApprovalSettings()
  }

  updateRuntimeApprovalSettings(
    request: UpdateRuntimeApprovalSettingsRequest
  ): RuntimeApprovalSettings {
    const settings = this.pluginSettingsStore.updateRuntimeApprovalSettings(request)
    this.workflowManager.setApprovalsEnabled(settings.approvalsEnabled)
    this.lifecycle.invalidateConfigSignature()
    return settings
  }

  getCharacterSettings(): ElizaCharacterSettings {
    return this.pluginSettingsStore.getCharacterSettings()
  }

  updateCharacterSettings(
    request: UpdateElizaCharacterSettingsRequest
  ): ElizaCharacterSettings {
    const settings = this.pluginSettingsStore.updateCharacterSettings(request)
    this.lifecycle.invalidateConfigSignature()
    return settings
  }

  importKnowledgeDocuments(
    request: ImportKnowledgeDocumentsRequest
  ): Promise<KnowledgeImportResult> {
    return this.memoryService.importKnowledgeDocuments(request)
  }

  getKnowledgeImportStatus(): KnowledgeImportStatus {
    return this.memoryService.getKnowledgeImportStatus()
  }

  async discoverPlugins(
    request: ElizaPluginDiscoveryRequest = {}
  ): Promise<ElizaPluginSettings> {
    return this.pluginDiscoveryService.discover(this.getProviderInfo(), request)
  }

  async installPlugin(
    request: ElizaPluginInstallRequest
  ): Promise<ElizaPluginOperationResult> {
    const result = await this.pluginInstallationService.install(
      this.getProviderInfo(),
      request
    )

    if (result.ok) {
      this.lifecycle.invalidateConfigSignature()
    }

    return result
  }

  async uninstallPlugin(
    request: ElizaPluginUninstallRequest
  ): Promise<ElizaPluginOperationResult> {
    const effectiveRequest = this.getRuntimeApprovalSettings().approvalsEnabled
      ? request
      : { ...request, confirmed: true }
    const result = await this.pluginInstallationService.uninstall(
      this.getProviderInfo(),
      effectiveRequest
    )

    if (result.ok) {
      this.lifecycle.invalidateConfigSignature()
    }

    return result
  }

  getAvailableActionTypes(): AssistantActionType[] {
    const settings = this.pluginSettingsStore.getRuntimeSettings()
    return settings.desktopActionsEnabled ? [...ASSISTANT_ACTION_TYPES] : []
  }

  getWorkflowRuns(): BonziWorkflowRunSnapshot[] {
    return this.workflowManager.getRuns()
  }

  getWorkflowRun(id: string): BonziWorkflowRunSnapshot | null {
    return this.workflowManager.getRun(id)
  }

  respondToWorkflowApproval(input: {
    runId: string
    stepId: string
    approved: boolean
  }): BonziWorkflowRunSnapshot | null {
    return this.workflowManager.respondToApproval(input)
  }

  cancelWorkflowRun(runId: string): BonziWorkflowRunSnapshot | null {
    return this.workflowManager.cancelRun(runId)
  }

  async updatePluginSettings(
    request: UpdateElizaPluginSettingsRequest
  ): Promise<ElizaPluginSettings> {
    const settings = this.pluginSettingsStore.updateSettings(
      request,
      this.getProviderInfo()
    )

    await this.lifecycle.waitForInitialization()
    this.lifecycle.invalidateConfigSignature()

    return settings
  }

  subscribe(listener: (event: AssistantEvent) => void): () => void {
    return this.events.subscribe(listener)
  }

  async getHistory(): Promise<AssistantMessage[]> {
    return this.memoryService.getHistory()
  }

  async resetConversation(): Promise<void> {
    await this.memoryService.resetConversation()
  }

  async reloadRuntime(): Promise<AssistantRuntimeStatus> {
    return this.lifecycle.reloadRuntime()
  }

  async recordActionObservation(action: {
    type: AssistantActionType
    title: string
    status: string
    params?: unknown
  }, resultMessage: string): Promise<void> {
    return this.memoryService.recordActionObservation(action, resultMessage)
  }

  linkExternalAction(action: AssistantAction): BonziWorkflowRunSnapshot | null {
    if (!action.workflowRunId || !action.workflowStepId) {
      return null
    }

    return this.workflowManager.linkExternalAction({
      runId: action.workflowRunId,
      stepId: action.workflowStepId,
      actionId: action.id
    })
  }

  markExternalActionRunning(action: AssistantAction): BonziWorkflowRunSnapshot | null {
    if (!action.workflowRunId || !action.workflowStepId) {
      return null
    }

    return this.workflowManager.runExternalAction({
      runId: action.workflowRunId,
      stepId: action.workflowStepId,
      detail: `Running ${action.title}.`
    })
  }

  async recordExternalActionObservation(
    action: AssistantAction,
    resultMessage: string
  ): Promise<{
    workflowRun?: BonziWorkflowRunSnapshot
    shouldConsiderContinuation: boolean
  }> {
    await this.memoryService.recordActionObservation(action, resultMessage)

    if (!action.workflowRunId || !action.workflowStepId) {
      return { shouldConsiderContinuation: false }
    }

    const workflowRun =
      action.status === 'failed'
        ? this.workflowManager.failExternalAction({
            runId: action.workflowRunId,
            stepId: action.workflowStepId,
            detail: resultMessage
          })
        : this.workflowManager.completeExternalAction({
            runId: action.workflowRunId,
            stepId: action.workflowStepId,
            detail: resultMessage
          })

    if (!workflowRun) {
      return { shouldConsiderContinuation: false }
    }

    return {
      workflowRun,
      shouldConsiderContinuation:
        !isTerminalRunStatus(workflowRun.status) &&
        workflowRun.status !== 'cancel_requested'
    }
  }

  async continueWorkflowAfterAction(input: {
    action: AssistantAction
    observation: string
    continuationIndex: number
  }): Promise<BonziRuntimeTurn | null> {
    const runId = input.action.workflowRunId

    if (!runId) {
      return null
    }

    const run = this.workflowManager.getRun(runId)

    if (!run || isTerminalRunStatus(run.status) || run.status === 'cancel_requested') {
      return null
    }

    return this.turnRunner.continueWorkflow({
      runId,
      action: input.action,
      observation: input.observation,
      continuationIndex: input.continuationIndex
    })
  }

  getExternalActionState(runId: string): WorkflowExternalActionState {
    return this.workflowManager.getExternalActionState(runId)
  }

  hasOpenExternalActions(runId: string): boolean {
    return this.workflowManager.hasOpenExternalActions(runId)
  }

  hasAwaitingExternalActions(runId: string): boolean {
    return this.hasOpenExternalActions(runId)
  }

  failWorkflowRun(runId: string, error: string): BonziWorkflowRunSnapshot | null {
    return this.workflowManager.failRun(runId, { error })
  }

  emitAssistantActionUpdated(action: AssistantAction): void {
    this.events.emit({
      type: 'assistant-action-updated',
      action
    })
  }

  emitAssistantTurnCreated(turn: AssistantTurnEventPayload): void {
    this.events.emit({
      type: 'assistant-turn-created',
      turn
    })
  }

  async sendCommand(command: string): Promise<BonziRuntimeTurn> {
    return this.turnRunner.sendCommand(command)
  }

  async dispose(): Promise<void> {
    this.events.clear()
    this.unsubscribeWorkflowEvents()
    this.workflowManager.dispose()
    await this.lifecycle.dispose()
  }
}
