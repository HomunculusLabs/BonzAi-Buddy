import { app, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import {
  AgentRuntime,
  ChannelType,
  createMessageMemory,
  LLMMode,
  stringToUuid,
  type Content,
  type Memory,
  type UUID
} from '@elizaos/core/node'
import {
  ASSISTANT_ACTION_TYPES,
  type AssistantActionType,
  type AssistantEvent,
  type AssistantEventEmoteId,
  type AssistantMessage,
  type AssistantProviderInfo,
  type AssistantRuntimeStatus,
  type BonziWorkflowRunSnapshot,
  type ElizaPluginDiscoveryRequest,
  type ElizaPluginInstallRequest,
  type ElizaPluginOperationResult,
  type ElizaPluginSettings,
  type ElizaPluginUninstallRequest,
  type RuntimeApprovalSettings,
  type ShellState,
  type UpdateElizaPluginSettingsRequest,
  type UpdateRuntimeApprovalSettingsRequest
} from '../../shared/contracts'
import {
  normalizeText
} from '../assistant-action-param-utils'
import { executeWorkflowBonziDesktopAction } from '../assistant-action-executor'
import { createBonziDesktopActionProposal } from './bonzi-desktop-actions-plugin'
import {
  loadBonziElizaConfig,
  type BonziElizaResolvedConfig
} from './config'
import { BonziExternalEmbeddingsService } from './external-embeddings-service'
import {
  applyRuntimeSettings,
  buildRuntimePlugins,
  createRuntimeCharacter,
  createRuntimeConfigSignature
} from './runtime-bootstrap'
import { BonziPluginRuntimeResolver } from './plugin-runtime-resolver'
import {
  dedupeProposedActions,
  extractBonziActionsFromActionResults,
  extractBonziActionsFromContent,
  extractFailedBonziActionTypes,
  filterFailedProposedActions,
  type BonziProposedAction
} from './runtime-action-proposals'
import { BonziPluginDiscoveryService } from './plugin-discovery'
import { BonziPluginInstallationService } from './plugin-installer'
import { BonziPluginSettingsStore } from './plugin-settings'
import { BonziWorkflowManager } from './workflow-manager'

export type { BonziProposedAction } from './runtime-action-proposals'

const BONZI_WORLD_ID = stringToUuid('bonzi-world')
const BONZI_USER_ID = stringToUuid('bonzi-user')
const BONZI_ROOM_ID = stringToUuid('bonzi-room')

interface RuntimeBundle {
  runtime: AgentRuntime
  userId: UUID
  roomId: UUID
  worldId: UUID
}

interface BonziRuntimeManagerOptions {
  getShellState: () => ShellState
  getCompanionWindow?: () => BrowserWindow | null
  dataDir?: string
  workflowRunsPath?: string
}

export interface BonziRuntimeTurn {
  reply: string
  actions: BonziProposedAction[]
  warnings: string[]
  emote?: AssistantEventEmoteId
  workflowRun?: BonziWorkflowRunSnapshot
}

export class BonziRuntimeManager {
  private bundle: RuntimeBundle | null = null
  private initializing: Promise<RuntimeBundle> | null = null
  private configSignature: string | null = null
  private providerInfo: AssistantProviderInfo = {
    kind: 'eliza-classic',
    label: 'Eliza Classic'
  }
  private startupWarnings: string[] = []
  private runtimeStartupWarnings: string[] = []
  private runtimeStatus: AssistantRuntimeStatus = {
    backend: 'eliza',
    state: 'starting',
    persistence: 'localdb'
  }
  private readonly listeners = new Set<(event: AssistantEvent) => void>()
  private readonly dataDir: string
  private readonly getShellState: () => ShellState
  private readonly getCompanionWindow: () => BrowserWindow | null
  private readonly embeddingsService = new BonziExternalEmbeddingsService()
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

  private readonly unsubscribeWorkflowEvents: () => void

  constructor(options: BonziRuntimeManagerOptions) {
    this.getShellState = options.getShellState
    this.getCompanionWindow = options.getCompanionWindow ?? (() => null)
    this.dataDir = options.dataDir ?? join(app.getPath('userData'), 'eliza-localdb')
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
        execute: ({ proposal, approved }) =>
          executeWorkflowBonziDesktopAction(
            proposal,
            {
              shellState: this.getShellState(),
              companionWindow: this.getCompanionWindow()
            },
            { approved }
          )
      }
    })
    this.unsubscribeWorkflowEvents = this.workflowManager.subscribe((run) => {
      this.emit({
        type: 'workflow-run-updated',
        run
      })
    })
    this.syncConfigState()
  }

  getProviderInfo(): AssistantProviderInfo {
    this.syncConfigState()
    return { ...this.providerInfo }
  }

  getStartupWarnings(): string[] {
    this.syncConfigState()
    return [...this.startupWarnings]
  }

  getRuntimeStatus(): AssistantRuntimeStatus {
    return { ...this.runtimeStatus }
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
    this.configSignature = null
    return settings
  }

  async discoverPlugins(
    request: ElizaPluginDiscoveryRequest = {}
  ): Promise<ElizaPluginSettings> {
    return this.pluginDiscoveryService.discover(this.getProviderInfo(), request)
  }

  async installPlugin(
    request: ElizaPluginInstallRequest
  ): Promise<ElizaPluginOperationResult> {
    const effectiveRequest = this.getRuntimeApprovalSettings().approvalsEnabled
      ? request
      : { ...request, confirmed: true }
    const result = await this.pluginInstallationService.install(
      this.getProviderInfo(),
      effectiveRequest
    )

    if (result.ok) {
      this.configSignature = null
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
      this.configSignature = null
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

    if (this.initializing) {
      await this.initializing.catch(() => null)
    }

    this.configSignature = null

    return settings
  }

  subscribe(listener: (event: AssistantEvent) => void): () => void {
    this.listeners.add(listener)

    return (): void => {
      this.listeners.delete(listener)
    }
  }

  async getHistory(): Promise<AssistantMessage[]> {
    const bundle = await this.getOrCreateRuntime()
    const memories = await bundle.runtime.getMemories({
      roomId: bundle.roomId,
      tableName: 'messages',
      count: 100
    })

    return memories
      .map((memory) => this.memoryToAssistantMessage(memory, bundle))
      .filter((message): message is AssistantMessage => message !== null)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  async resetConversation(): Promise<void> {
    const bundle = await this.getOrCreateRuntime()
    await bundle.runtime.deleteAllMemories(bundle.roomId, 'messages')
  }

  async reloadRuntime(): Promise<AssistantRuntimeStatus> {
    if (this.initializing) {
      await this.initializing.catch(() => null)
    }

    if (this.bundle) {
      await this.bundle.runtime.stop()
      this.bundle = null
    }

    this.configSignature = null

    try {
      await this.getOrCreateRuntime()
    } catch {
      // runtime status already updated by getOrCreateRuntime failure path
    }

    return this.getRuntimeStatus()
  }

  async recordActionObservation(action: {
    type: AssistantActionType
    title: string
    status: string
    params?: unknown
  }, resultMessage: string): Promise<void> {
    const text = normalizeText(resultMessage)

    if (!text) {
      return
    }

    const bundle = await this.getOrCreateRuntime()
    const paramsText = action.params
      ? `\nParams: ${JSON.stringify(action.params)}`
      : ''

    await bundle.runtime.createMemory(
      createMessageMemory({
        id: crypto.randomUUID() as UUID,
        entityId: bundle.runtime.agentId,
        roomId: bundle.roomId,
        content: {
          text: `[Bonzi action observation: ${action.type} / ${action.status}]\n${action.title}${paramsText}\n\n${text}`,
          source: 'bonzi-action-observation',
          channelType: ChannelType.DM
        }
      }),
      'messages'
    )
  }

  async sendCommand(command: string): Promise<BonziRuntimeTurn> {
    const config = this.syncConfigState()
    const bundle = await this.getOrCreateRuntime()

    if (config.e2eMode) {
      return this.buildE2eTurn(command)
    }

    const messageService = bundle.runtime.messageService

    if (!messageService) {
      throw new Error('Runtime message service not available.')
    }

    const messageMemory = createMessageMemory({
      id: crypto.randomUUID() as UUID,
      entityId: bundle.userId,
      roomId: bundle.roomId,
      content: {
        text: command,
        source: 'bonzi-electron-renderer',
        channelType: ChannelType.DM
      }
    })

    const run = this.workflowManager.createRun({
      commandMessageId: String(messageMemory.id),
      roomId: String(bundle.roomId),
      userCommand: command
    })

    try {
      const callbackTexts: string[] = []
      const callbackActions: BonziProposedAction[] = []

      const result = await this.workflowManager.runWithActiveRun(
        run.id,
        async () =>
          messageService.handleMessage(
            bundle.runtime,
            messageMemory,
            async (content: Content) => {
              const text = normalizeText(content.text)
              const extractedActions = extractBonziActionsFromContent(content)

              if (text) {
                callbackTexts.push(text)
              }

              callbackActions.push(...extractedActions)
              this.workflowManager.recordCallback(run.id, {
                text,
                actionCount: extractedActions.length
              })
              return []
            }
          )
      )

      const responseContent = result.responseContent ?? undefined
      const actionResults = bundle.runtime.getActionResults(messageMemory.id as UUID)
      const responseText = normalizeText(responseContent?.text)
      const failedActionTypes = extractFailedBonziActionTypes(actionResults)
      const actions = dedupeProposedActions([
        ...extractBonziActionsFromActionResults(actionResults),
        ...filterFailedProposedActions(callbackActions, failedActionTypes),
        ...filterFailedProposedActions(
          extractBonziActionsFromContent(responseContent),
          failedActionTypes
        )
      ])
      const reply =
        responseText ||
        callbackTexts.at(-1) ||
        (actions.length > 0
          ? 'I prepared that Bonzi action for you.'
          : 'The runtime returned an empty response.')

      if (!responseText) {
        await bundle.runtime.createMemory(
          createMessageMemory({
            id: crypto.randomUUID() as UUID,
            entityId: bundle.runtime.agentId,
            roomId: bundle.roomId,
            content: {
              text: reply,
              source: 'bonzi-electron-main',
              channelType: ChannelType.DM
            }
          }),
          'messages'
        )
      }

      const completedRun = this.workflowManager.completeRun(run.id, {
        replyText: reply
      })

      return {
        reply,
        actions,
        warnings: [],
        workflowRun: completedRun ?? run
      }
    } catch (error) {
      this.workflowManager.failRun(run.id, {
        error: normalizeError(error)
      })
      throw error
    }
  }

  async dispose(): Promise<void> {
    this.listeners.clear()
    this.unsubscribeWorkflowEvents()
    this.workflowManager.dispose()

    if (this.bundle) {
      await this.bundle.runtime.stop()
    }

    await this.embeddingsService.stop()

    this.bundle = null
    this.initializing = null
    this.configSignature = null
    this.runtimeStartupWarnings = []
  }

  private async getOrCreateRuntime(): Promise<RuntimeBundle> {
    const config = this.syncConfigState()
    const runtimeSettings = this.pluginSettingsStore.getRuntimeSettings()
    const runtimePluginSelection =
      this.pluginRuntimeResolver.getRuntimeSelectionMetadata()
    const signature = createRuntimeConfigSignature({
      config,
      runtimeSettings,
      runtimePluginSelection
    })

    this.providerInfo = config.provider
    this.startupWarnings = dedupeStrings([
      ...config.startupWarnings,
      ...this.runtimeStartupWarnings
    ])

    if (this.bundle && this.configSignature === signature) {
      this.addStartupWarnings(
        await applyRuntimeSettings({
          runtime: this.bundle.runtime,
          config,
          dataDir: this.dataDir,
          embeddingsService: this.embeddingsService
        })
      )
      return this.bundle
    }

    if (this.initializing) {
      return this.initializing
    }

    this.updateRuntimeStatus({
      backend: 'eliza',
      state: 'starting',
      persistence: 'localdb'
    })

    this.initializing = (async () => {
      if (this.bundle) {
        await this.bundle.runtime.stop()
        this.bundle = null
        this.configSignature = null
      }

      try {
        this.runtimeStartupWarnings = []
        this.startupWarnings = [...config.startupWarnings]
        const runtimePlugins = await buildRuntimePlugins({
          config,
          runtimeSettings,
          getShellState: this.getShellState,
          pluginResolver: this.pluginRuntimeResolver
        })
        this.addStartupWarnings(runtimePlugins.warnings)

        const runtime = new AgentRuntime({
          character: createRuntimeCharacter({ config, runtimeSettings }),
          plugins: runtimePlugins.plugins,
          actionPlanning: true,
          llmMode: LLMMode.SMALL
        })

        this.addStartupWarnings(
          await applyRuntimeSettings({
            runtime,
            config,
            dataDir: this.dataDir,
            embeddingsService: this.embeddingsService
          })
        )
        await runtime.initialize()

        await runtime.ensureConnection({
          entityId: BONZI_USER_ID,
          roomId: BONZI_ROOM_ID,
          worldId: BONZI_WORLD_ID,
          userName: 'User',
          source: 'bonzi-electron-main',
          channelId: 'chat',
          type: ChannelType.DM
        })

        const bundle: RuntimeBundle = {
          runtime,
          userId: BONZI_USER_ID,
          roomId: BONZI_ROOM_ID,
          worldId: BONZI_WORLD_ID
        }

        this.bundle = bundle
        this.configSignature = signature
        this.updateRuntimeStatus({
          backend: 'eliza',
          state: 'ready',
          persistence: 'localdb'
        })
        return bundle
      } catch (error) {
        await this.embeddingsService.stop()
        const message = normalizeError(error)
        this.updateRuntimeStatus({
          backend: 'eliza',
          state: 'error',
          persistence: 'localdb',
          lastError: message
        })
        throw new Error(message)
      }
    })()

    try {
      return await this.initializing
    } finally {
      this.initializing = null
    }
  }

  private syncConfigState(): BonziElizaResolvedConfig {
    const config = loadBonziElizaConfig()
    this.providerInfo = config.provider
    this.startupWarnings = dedupeStrings([
      ...config.startupWarnings,
      ...this.runtimeStartupWarnings
    ])
    return config
  }

  private buildE2eTurn(command: string): BonziRuntimeTurn {
    const lowerCommand = command.toLowerCase()

    return {
      reply: `E2E assistant reply for: ${command}`,
      actions: lowerCommand.includes('close')
        ? [createBonziDesktopActionProposal('close-window')]
        : lowerCommand.includes('shell')
          ? [createBonziDesktopActionProposal('report-shell-state')]
          : [],
      warnings: []
    }
  }

  private memoryToAssistantMessage(
    memory: Memory,
    bundle: RuntimeBundle
  ): AssistantMessage | null {
    if (memory.content.source === 'action') {
      return null
    }

    const content = typeof memory.content.text === 'string' ? memory.content.text.trim() : ''

    if (!content) {
      return null
    }

    const createdAt = normalizeTimestamp(memory.createdAt)

    return {
      id: String(memory.id),
      role: memory.entityId === bundle.userId ? 'user' : 'assistant',
      content,
      createdAt
    }
  }

  private addStartupWarnings(warnings: string[]): void {
    const additions = warnings.filter((warning) => !this.runtimeStartupWarnings.includes(warning))

    if (additions.length > 0) {
      this.runtimeStartupWarnings = [...this.runtimeStartupWarnings, ...additions]
      this.startupWarnings = dedupeStrings([...this.startupWarnings, ...additions])
    }
  }

  private updateRuntimeStatus(status: AssistantRuntimeStatus): void {
    this.runtimeStatus = status
    this.emit({
      type: 'runtime-status',
      status
    })
  }

  private emit(event: AssistantEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString()
  }

  if (typeof value === 'string' && value.trim()) {
    const asNumber = Number(value)
    if (Number.isFinite(asNumber)) {
      return new Date(asNumber).toISOString()
    }

    const asDate = new Date(value)
    if (!Number.isNaN(asDate.getTime())) {
      return asDate.toISOString()
    }
  }

  return new Date().toISOString()
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))
  )
}
