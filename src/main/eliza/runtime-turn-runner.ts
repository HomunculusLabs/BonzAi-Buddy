import type { Content, UUID } from '@elizaos/core/node'
import type {
  AssistantAction,
  AssistantEventEmoteId,
  BonziWorkflowRunSnapshot
} from '../../shared/contracts'
import { normalizeError } from '../../shared/value-utils'
import { normalizeText } from '../assistant-action-param-utils'
import { createBonziDesktopActionProposal } from './bonzi-desktop-actions-plugin'
import type { BonziRuntimeConfigState } from './runtime-config-state'
import type { RuntimeBundle } from './runtime-lifecycle'
import {
  dedupeProposedActions,
  extractBonziActionsFromActionResults,
  extractBonziActionsFromContent,
  extractFailedBonziActionTypes,
  filterFailedProposedActions,
  type BonziProposedAction
} from './runtime-action-proposals'
import type { BonziWorkflowManager } from './workflow-manager'

interface RuntimeTurnRunnerOptions {
  configState: BonziRuntimeConfigState
  getRuntime: () => Promise<RuntimeBundle>
  workflowManager: BonziWorkflowManager
}

interface RuntimePassInput {
  run: BonziWorkflowRunSnapshot
  text: string
  source: string
  continuationIndex: number
}

export interface BonziRuntimeTurn {
  reply: string
  actions: BonziProposedAction[]
  warnings: string[]
  emote?: AssistantEventEmoteId
  workflowRun?: BonziWorkflowRunSnapshot
  commandMessageId?: string
  continuationIndex?: number
}

export class BonziRuntimeTurnRunner {
  private readonly configState: BonziRuntimeConfigState
  private readonly getRuntime: () => Promise<RuntimeBundle>
  private readonly workflowManager: BonziWorkflowManager

  constructor(options: RuntimeTurnRunnerOptions) {
    this.configState = options.configState
    this.getRuntime = options.getRuntime
    this.workflowManager = options.workflowManager
  }

  async sendCommand(command: string): Promise<BonziRuntimeTurn> {
    const config = this.configState.sync()

    if (config.e2eMode) {
      return this.buildE2eInitialTurn(command)
    }

    const bundle = await this.getRuntime()
    const run = this.workflowManager.createRun({
      commandMessageId: crypto.randomUUID(),
      roomId: String(bundle.roomId),
      userCommand: command
    })

    return this.runRuntimePass({
      run,
      text: command,
      source: 'bonzi-electron-renderer',
      continuationIndex: 0
    })
  }

  async continueWorkflow(input: {
    runId: string
    action: AssistantAction
    observation: string
    continuationIndex: number
  }): Promise<BonziRuntimeTurn> {
    const run = this.workflowManager.getRun(input.runId)

    if (!run) {
      throw new Error('Workflow run could not be found for continuation.')
    }

    const text = buildContinuationPrompt({
      run,
      action: input.action,
      observation: input.observation
    })
    const config = this.configState.sync()

    if (config.e2eMode) {
      return this.buildE2eContinuationTurn({
        run,
        action: input.action,
        observation: input.observation,
        continuationIndex: input.continuationIndex
      })
    }

    return this.runRuntimePass({
      run,
      text,
      source: 'bonzi-action-observation-continuation',
      continuationIndex: input.continuationIndex
    })
  }

  private async runRuntimePass(input: RuntimePassInput): Promise<BonziRuntimeTurn> {
    const bundle = await this.getRuntime()
    const { ChannelType, createMessageMemory } = await import('@elizaos/core/node')
    const messageService = bundle.runtime.messageService

    if (!messageService) {
      throw new Error('Runtime message service not available.')
    }

    const messageMemory = createMessageMemory({
      id: crypto.randomUUID() as UUID,
      entityId: bundle.userId,
      roomId: bundle.roomId,
      content: {
        text: input.text,
        source: input.source,
        channelType: ChannelType.DM
      }
    })

    try {
      const callbackTexts: string[] = []
      const callbackActions: BonziProposedAction[] = []

      const result = await this.workflowManager.runWithActiveRun(
        input.run.id,
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
              this.workflowManager.recordCallback(input.run.id, {
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
      const proposedActions = dedupeProposedActions([
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
        (proposedActions.length > 0
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

      return this.finalizePass({
        runId: input.run.id,
        reply,
        actions: proposedActions,
        continuationIndex: input.continuationIndex
      })
    } catch (error) {
      this.workflowManager.failRun(input.run.id, {
        error: normalizeError(error)
      })
      throw error
    }
  }

  private finalizePass(input: {
    runId: string
    reply: string
    actions: BonziProposedAction[]
    continuationIndex: number
  }): BonziRuntimeTurn {
    const run = this.workflowManager.getRun(input.runId)

    if (!run) {
      return {
        reply: input.reply,
        actions: input.actions,
        warnings: [],
        continuationIndex: input.continuationIndex
      }
    }

    if (input.actions.length === 0) {
      const completedRun = this.workflowManager.completeRun(run.id, {
        replyText: input.reply
      })

      return {
        reply: input.reply,
        actions: [],
        warnings: [],
        workflowRun: completedRun ?? run,
        commandMessageId: run.commandMessageId,
        continuationIndex: input.continuationIndex
      }
    }

    const correlatedActions = input.actions.map((action, index) => {
      const continuationId = crypto.randomUUID()
      const step = this.workflowManager.startExternalActionStep({
        runId: run.id,
        title: action.title ?? `Bonzi ${action.type}`,
        detail: action.description,
        actionType: action.type,
        continuationId,
        continuationIndex: input.continuationIndex
      })

      return {
        ...action,
        workflowRunId: run.id,
        workflowStepId: step?.id,
        commandMessageId: run.commandMessageId,
        continuationId,
        continuationIndex: input.continuationIndex,
        title: action.title,
        description: action.description ?? `Bonzi action ${index + 1}`
      }
    })
    const latestRun = this.workflowManager.getRun(run.id) ?? run

    return {
      reply: input.reply,
      actions: correlatedActions,
      warnings: [],
      workflowRun: latestRun,
      commandMessageId: run.commandMessageId,
      continuationIndex: input.continuationIndex
    }
  }

  private buildE2eInitialTurn(command: string): BonziRuntimeTurn {
    const run = this.workflowManager.createRun({
      commandMessageId: crypto.randomUUID(),
      roomId: 'bonzi-e2e-room',
      userCommand: command
    })
    const lowerCommand = command.toLowerCase()
    const actions = lowerCommand.includes('multi step e2e')
      ? [createBonziDesktopActionProposal('report-shell-state')]
      : buildLegacyE2eActions(command)
    const reply = lowerCommand.includes('multi step e2e')
      ? 'Starting multi-step e2e workflow.'
      : `E2E assistant reply for: ${command}`

    return this.finalizePass({
      runId: run.id,
      reply,
      actions,
      continuationIndex: 0
    })
  }

  private buildE2eContinuationTurn(input: {
    run: BonziWorkflowRunSnapshot
    action: AssistantAction
    observation: string
    continuationIndex: number
  }): BonziRuntimeTurn {
    const nextAction =
      input.run.userCommand.toLowerCase().includes('multi step e2e') &&
      input.action.type === 'report-shell-state'
        ? [createBonziDesktopActionProposal('copy-vrm-asset-path')]
        : []
    const reply = nextAction.length > 0
      ? 'Observed shell state; next step is copying the asset path.'
      : 'Multi-step e2e complete.'

    return this.finalizePass({
      runId: input.run.id,
      reply,
      actions: nextAction,
      continuationIndex: input.continuationIndex
    })
  }
}

function buildContinuationPrompt(input: {
  run: BonziWorkflowRunSnapshot
  action: AssistantAction
  observation: string
}): string {
  return `Continue the current Bonzi workflow.

Original user task:
${input.run.userCommand}

External Bonzi action completed:
${input.action.type} / ${input.action.status}
${input.action.title}

Observation:
${input.observation}

If the task is complete, provide the final answer. If another Bonzi desktop action is required, propose exactly the next action.`
}

function buildLegacyE2eActions(command: string): BonziProposedAction[] {
  const lowerCommand = command.toLowerCase()

  if (lowerCommand.includes('discord context e2e')) {
    return [
      createBonziDesktopActionProposal('discord-read-context', {
        url: process.env.BONZI_E2E_DISCORD_URL,
        query: 'visible channel messages'
      })
    ]
  }

  if (lowerCommand.includes('discord draft e2e')) {
    return [
      createBonziDesktopActionProposal('discord-type-draft', {
        url: process.env.BONZI_E2E_DISCORD_URL,
        text: 'Thanks, I will take a look.'
      })
    ]
  }

  if (lowerCommand.includes('close')) {
    return [createBonziDesktopActionProposal('close-window')]
  }

  if (lowerCommand.includes('shell')) {
    return [createBonziDesktopActionProposal('report-shell-state')]
  }

  return []
}
