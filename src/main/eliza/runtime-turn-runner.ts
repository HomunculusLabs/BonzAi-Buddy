import {
  ChannelType,
  createMessageMemory,
  type Content,
  type UUID
} from '@elizaos/core/node'
import type {
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

export interface BonziRuntimeTurn {
  reply: string
  actions: BonziProposedAction[]
  warnings: string[]
  emote?: AssistantEventEmoteId
  workflowRun?: BonziWorkflowRunSnapshot
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
    const bundle = await this.getRuntime()

    if (config.e2eMode) {
      return buildE2eTurn(command)
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
}

function buildE2eTurn(command: string): BonziRuntimeTurn {
  const lowerCommand = command.toLowerCase()

  return {
    reply: `E2E assistant reply for: ${command}`,
    actions: lowerCommand.includes('discord context e2e')
      ? [
          createBonziDesktopActionProposal('discord-read-context', {
            url: process.env.BONZI_E2E_DISCORD_URL,
            query: 'visible channel messages'
          })
        ]
      : lowerCommand.includes('discord draft e2e')
        ? [
            createBonziDesktopActionProposal('discord-type-draft', {
              url: process.env.BONZI_E2E_DISCORD_URL,
              text: 'Thanks, I will take a look.'
            })
          ]
        : lowerCommand.includes('close')
          ? [createBonziDesktopActionProposal('close-window')]
          : lowerCommand.includes('shell')
            ? [createBonziDesktopActionProposal('report-shell-state')]
            : [],
    warnings: []
  }
}
