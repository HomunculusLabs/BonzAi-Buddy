import { app, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import {
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
  type CancelKnowledgeImportRequest,
  type CancelKnowledgeImportResult,
  type ImportKnowledgeDocumentsRequest,
  type ImportKnowledgeFoldersRequest,
  type KnowledgeImportResult,
  type KnowledgeImportStatus,
  type RuntimeApprovalSettings,
  type StartKnowledgeImportResult,
  type ShellState,
  type UpdateElizaCharacterSettingsRequest,
  type UpdateElizaPluginSettingsRequest,
  type UpdateRuntimeApprovalSettingsRequest
} from '../../shared/contracts'
import { executeWorkflowBonziDesktopAction } from '../assistant-action-executor'
import type { BonziWorkspaceFileService } from '../bonzi-workspace-file-service'
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
import { BonziRuntimePluginOperations } from './runtime-plugin-operations'
import {
  BonziRuntimeTurnRunner,
  type BonziRuntimeTurn
} from './runtime-turn-runner'
import { BonziRuntimeWorkflowBridge } from './runtime-workflow-bridge'
import {
  BonziWorkflowManager,
  type WorkflowExternalActionState
} from './workflow-manager'

export type { BonziProposedAction } from './runtime-action-proposals'
export type { BonziRuntimeTurn } from './runtime-turn-runner'

interface BonziRuntimeManagerOptions {
  getShellState: () => ShellState
  getCompanionWindow?: () => BrowserWindow | null
  discordBrowserService: DiscordBrowserActionService
  workspaceFileService: BonziWorkspaceFileService
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
  private readonly pluginOperations: BonziRuntimePluginOperations
  private readonly workflowManager: BonziWorkflowManager
  private readonly lifecycle: BonziRuntimeLifecycle
  private readonly memoryService: BonziRuntimeMemoryService
  private readonly turnRunner: BonziRuntimeTurnRunner
  private readonly workflowBridge: BonziRuntimeWorkflowBridge
  private readonly unsubscribeWorkflowEvents: () => void

  constructor(options: BonziRuntimeManagerOptions) {
    this.getShellState = options.getShellState
    this.getCompanionWindow = options.getCompanionWindow ?? (() => null)
    const runtimeDataDir = options.dataDir ?? join(app.getPath('userData'), 'eliza-localdb')
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
                discordBrowserService: options.discordBrowserService,
                workspaceFileService: options.workspaceFileService
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
      dataDir: runtimeDataDir,
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
    this.pluginOperations = new BonziRuntimePluginOperations({
      settingsStore: this.pluginSettingsStore,
      discoveryService: this.pluginDiscoveryService,
      installationService: this.pluginInstallationService,
      getProviderInfo: () => this.getProviderInfo(),
      waitForRuntimeInitialization: () => this.lifecycle.waitForInitialization(),
      invalidateRuntimeConfig: () => {
        this.lifecycle.invalidateConfigSignature()
      },
      setWorkflowApprovalsEnabled: (enabled) => {
        this.workflowManager.setApprovalsEnabled(enabled)
      }
    })
    this.memoryService = new BonziRuntimeMemoryService({
      getRuntime: () => this.lifecycle.getOrCreateRuntime(),
      knowledgeImportManifestPath: join(runtimeDataDir, 'knowledge-import-manifest.json'),
      canSkipHistoryRuntimeHydration: () =>
        this.lifecycle.canSkipHistoryRuntimeHydration()
    })
    this.turnRunner = new BonziRuntimeTurnRunner({
      configState: this.configState,
      getRuntime: () => this.lifecycle.getOrCreateRuntime(),
      workflowManager: this.workflowManager
    })
    this.workflowBridge = new BonziRuntimeWorkflowBridge({
      workflowManager: this.workflowManager,
      memoryService: this.memoryService,
      turnRunner: this.turnRunner
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
    return this.pluginOperations.getPluginSettings()
  }

  getRuntimeApprovalSettings(): RuntimeApprovalSettings {
    return this.pluginOperations.getRuntimeApprovalSettings()
  }

  updateRuntimeApprovalSettings(
    request: UpdateRuntimeApprovalSettingsRequest
  ): RuntimeApprovalSettings {
    return this.pluginOperations.updateRuntimeApprovalSettings(request)
  }

  getCharacterSettings(): ElizaCharacterSettings {
    return this.pluginOperations.getCharacterSettings()
  }

  updateCharacterSettings(
    request: UpdateElizaCharacterSettingsRequest
  ): ElizaCharacterSettings {
    return this.pluginOperations.updateCharacterSettings(request)
  }

  importKnowledgeDocuments(
    request: ImportKnowledgeDocumentsRequest
  ): Promise<KnowledgeImportResult> {
    return this.memoryService.importKnowledgeDocuments(request)
  }

  startKnowledgeFolderImport(
    request: ImportKnowledgeFoldersRequest
  ): Promise<StartKnowledgeImportResult> {
    return this.memoryService.startKnowledgeFolderImport(request)
  }

  cancelKnowledgeImport(
    request: CancelKnowledgeImportRequest
  ): Promise<CancelKnowledgeImportResult> {
    return this.memoryService.cancelKnowledgeImport(request)
  }

  getKnowledgeImportStatus(): Promise<KnowledgeImportStatus> {
    return this.memoryService.getKnowledgeImportStatus()
  }

  async discoverPlugins(
    request: ElizaPluginDiscoveryRequest = {}
  ): Promise<ElizaPluginSettings> {
    return this.pluginOperations.discoverPlugins(request)
  }

  async installPlugin(
    request: ElizaPluginInstallRequest
  ): Promise<ElizaPluginOperationResult> {
    return this.pluginOperations.installPlugin(request)
  }

  async uninstallPlugin(
    request: ElizaPluginUninstallRequest
  ): Promise<ElizaPluginOperationResult> {
    return this.pluginOperations.uninstallPlugin(request)
  }

  getAvailableActionTypes(): AssistantActionType[] {
    return this.pluginOperations.getAvailableActionTypes()
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
    return this.pluginOperations.updatePluginSettings(request)
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

  async recordActionObservation(
    action: {
      type: AssistantActionType
      title: string
      status: string
      params?: unknown
    },
    resultMessage: string
  ): Promise<void> {
    return this.workflowBridge.recordActionObservation(action, resultMessage)
  }

  linkExternalAction(action: AssistantAction): BonziWorkflowRunSnapshot | null {
    return this.workflowBridge.linkExternalAction(action)
  }

  markExternalActionRunning(action: AssistantAction): BonziWorkflowRunSnapshot | null {
    return this.workflowBridge.markExternalActionRunning(action)
  }

  async recordExternalActionObservation(
    action: AssistantAction,
    resultMessage: string
  ): Promise<{
    workflowRun?: BonziWorkflowRunSnapshot
    shouldConsiderContinuation: boolean
  }> {
    return this.workflowBridge.recordExternalActionObservation(action, resultMessage)
  }

  async continueWorkflowAfterAction(input: {
    action: AssistantAction
    observation: string
    continuationIndex: number
  }): Promise<BonziRuntimeTurn | null> {
    return this.workflowBridge.continueWorkflowAfterAction(input)
  }

  getExternalActionState(runId: string): WorkflowExternalActionState {
    return this.workflowBridge.getExternalActionState(runId)
  }

  hasOpenExternalActions(runId: string): boolean {
    return this.workflowBridge.hasOpenExternalActions(runId)
  }

  hasAwaitingExternalActions(runId: string): boolean {
    return this.workflowBridge.hasAwaitingExternalActions(runId)
  }

  failWorkflowRun(runId: string, error: string): BonziWorkflowRunSnapshot | null {
    return this.workflowBridge.failWorkflowRun(runId, error)
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
