import type {
  Action,
  ActionResult,
  HandlerCallback,
  Memory,
  Plugin,
  Content
} from '@elizaos/core/node'
import {
  ASSISTANT_ACTION_TYPES,
  type AssistantActionParams,
  type AssistantActionType,
  type ElizaPluginExecutionPolicy
} from '../../shared/contracts'
import {
  normalizeText,
  sanitizeAssistantActionParams
} from '../assistant-action-param-utils'
import type { BonziWorkflowManager } from './workflow-manager'

export interface WorkflowBonziDesktopActionProposal {
  type: AssistantActionType
  requiresConfirmation?: boolean
  params?: AssistantActionParams
}

export interface WorkflowBonziDesktopActionGateway {
  execute: (input: {
    proposal: WorkflowBonziDesktopActionProposal
    approved: boolean
  }) => Promise<string>
}

interface WorkflowActionInstrumentationOptions {
  plugin: Plugin
  pluginId: string
  executionPolicy: ElizaPluginExecutionPolicy
  workflowManager: BonziWorkflowManager
  bonziDesktopActionGateway?: WorkflowBonziDesktopActionGateway
}

export function instrumentPluginActionsForWorkflow(
  options: WorkflowActionInstrumentationOptions
): Plugin {
  const { plugin } = options

  if (!Array.isArray(plugin.actions) || plugin.actions.length === 0) {
    return plugin
  }

  const wrappedActions = plugin.actions.map((action) =>
    wrapActionForWorkflow({
      action,
      pluginId: options.pluginId,
      executionPolicy: options.executionPolicy,
      workflowManager: options.workflowManager,
      bonziDesktopActionGateway: options.bonziDesktopActionGateway
    })
  )

  return {
    ...plugin,
    actions: wrappedActions
  }
}

function wrapActionForWorkflow(options: {
  action: Action
  pluginId: string
  executionPolicy: ElizaPluginExecutionPolicy
  workflowManager: BonziWorkflowManager
  bonziDesktopActionGateway?: WorkflowBonziDesktopActionGateway
}): Action {
  const {
    action,
    pluginId,
    executionPolicy,
    workflowManager,
    bonziDesktopActionGateway
  } = options
  const originalHandler = action.handler

  return {
    ...action,
    handler: async (runtime, message, state, handlerOptions, callback, responses) => {
      const activeRunId = workflowManager.getActiveRunId()

      if (!activeRunId) {
        return originalHandler(
          runtime,
          message,
          state,
          handlerOptions,
          callback,
          responses
        )
      }

      const step = safeStepStart(workflowManager, {
        runId: activeRunId,
        title: actionTitle(action, pluginId),
        detail: action.description,
        pluginId,
        actionName: action.name
      })

      const stepId = step?.id

      const wrappedCallback: HandlerCallback | undefined = callback
        ? async (content: Content): Promise<Memory[]> => {
            safeRecordCallback(workflowManager, activeRunId, content)
            return callback(content)
          }
        : undefined

      try {
        if (!stepId) {
          return await originalHandler(
            runtime,
            message,
            state,
            handlerOptions,
            wrappedCallback,
            responses
          )
        }

        safeRunStep(workflowManager, activeRunId, stepId)

        if (executionPolicy === 'disabled') {
          if (stepId) {
            safeSkipStep(
              workflowManager,
              activeRunId,
              stepId,
              'Action disabled by plugin execution policy.'
            )
          }

          return buildPolicyFailureResult('Action disabled by plugin execution policy.')
        }

        if (executionPolicy === 'confirm_each_action') {
          const approved = stepId
            ? await workflowManager.requestStepApproval({
                runId: activeRunId,
                stepId,
                prompt: `Allow ${pluginId}.${action.name}?`
              })
            : false

          if (!approved) {
            if (stepId) {
              safeSkipStep(workflowManager, activeRunId, stepId, 'User declined action.')
            }

            return buildPolicyFailureResult('User declined action.')
          }

          if (stepId) {
            safeRunStep(workflowManager, activeRunId, stepId)
          }
        }

        const result = await originalHandler(
          runtime,
          message,
          state,
          handlerOptions,
          wrappedCallback,
          responses
        )

        if (!stepId) {
          return result
        }

        const bonziWorkflowResult = await maybeHandleWorkflowBonziProposal({
          result,
          runId: activeRunId,
          stepId,
          executionPolicy,
          workflowManager,
          bonziDesktopActionGateway
        })

        if (bonziWorkflowResult) {
          return bonziWorkflowResult
        }

        if (result?.success === false) {
          safeFailStep(
            workflowManager,
            activeRunId,
            stepId,
            normalizeActionErrorDetail(result)
          )
        } else {
          safeCompleteStep(
            workflowManager,
            activeRunId,
            stepId,
            normalizeText(result?.text)
          )
        }

        return result
      } catch (error) {
        if (stepId) {
          safeFailStep(workflowManager, activeRunId, stepId, normalizeError(error))
        }

        throw error
      }
    }
  }
}

function actionTitle(action: Action, pluginId: string): string {
  const actionName = normalizeText(action.name) || 'unnamed-action'
  return `${pluginId}.${actionName}`
}

function normalizeActionErrorDetail(result: ActionResult): string {
  const errorText =
    typeof result.error === 'string'
      ? result.error
      : result.error instanceof Error
        ? result.error.message
        : ''

  return normalizeText(errorText) || normalizeText(result.text) || 'Action failed.'
}

async function maybeHandleWorkflowBonziProposal(input: {
  result: ActionResult | undefined
  runId: string
  stepId: string
  executionPolicy: ElizaPluginExecutionPolicy
  workflowManager: BonziWorkflowManager
  bonziDesktopActionGateway?: WorkflowBonziDesktopActionGateway
}): Promise<ActionResult | null> {
  if (
    !input.result ||
    input.result.success === false ||
    !input.bonziDesktopActionGateway
  ) {
    return null
  }

  const proposal = extractWorkflowBonziDesktopActionProposal(input.result)

  if (!proposal) {
    return null
  }

  const rawProposal = isRecord(input.result.data?.bonziProposedAction)
    ? input.result.data.bonziProposedAction
    : null
  const title = normalizeText(rawProposal?.title)
  const shouldRequestApproval =
    proposal.requiresConfirmation === true ||
    proposal.type === 'close-window' ||
    input.executionPolicy === 'confirm_each_action'

  const approved = shouldRequestApproval
    ? await input.workflowManager.requestStepApproval({
        runId: input.runId,
        stepId: input.stepId,
        prompt: `Allow workflow Bonzi action${title ? ` "${title}"` : ''}?`
      })
    : true

  if (!approved) {
    const deniedMessage =
      'Workflow approval denied. Bonzi desktop action was not executed.'

    safeSkipStep(
      input.workflowManager,
      input.runId,
      input.stepId,
      deniedMessage
    )

    return {
      ...input.result,
      success: false,
      text: deniedMessage,
      error: deniedMessage
    }
  }

  try {
    const executionMessage = await input.bonziDesktopActionGateway.execute({
      proposal,
      approved
    })

    safeCompleteStep(
      input.workflowManager,
      input.runId,
      input.stepId,
      normalizeText(executionMessage)
    )

    return {
      ...input.result,
      success: true,
      text: normalizeText(executionMessage) || 'Bonzi desktop action executed.',
      data: {
        ...(isRecord(input.result.data) ? input.result.data : {}),
        bonziActionExecuted: true
      }
    }
  } catch (error) {
    const failureMessage = normalizeError(error)
    safeFailStep(
      input.workflowManager,
      input.runId,
      input.stepId,
      failureMessage
    )

    return {
      ...input.result,
      success: false,
      text: failureMessage,
      error: failureMessage,
      data: {
        ...(isRecord(input.result.data) ? input.result.data : {}),
        bonziActionExecuted: false
      }
    }
  }
}

function extractWorkflowBonziDesktopActionProposal(
  result: ActionResult | undefined
): WorkflowBonziDesktopActionProposal | null {
  if (!result) {
    return null
  }
  const rawProposal = result.data?.bonziProposedAction

  if (!isRecord(rawProposal) || !isAssistantActionType(rawProposal.type)) {
    return null
  }

  const params =
    sanitizeAssistantActionParams(rawProposal.params) ??
    sanitizeAssistantActionParams(result.data?.bonziActionParams)

  return {
    type: rawProposal.type,
    requiresConfirmation:
      typeof rawProposal.requiresConfirmation === 'boolean'
        ? rawProposal.requiresConfirmation
        : undefined,
    ...(params ? { params } : {})
  }
}

function buildPolicyFailureResult(message: string): ActionResult {
  return {
    success: false,
    text: message,
    error: message
  }
}

function safeStepStart(
  workflowManager: BonziWorkflowManager,
  input: {
    runId: string
    title: string
    detail?: string
    pluginId: string
    actionName: string
  }
) {
  try {
    return workflowManager.startStep(input)
  } catch (error) {
    console.error('Workflow action instrumentation failed to start step.', error)
    return null
  }
}

function safeRunStep(
  workflowManager: BonziWorkflowManager,
  runId: string,
  stepId: string
): void {
  try {
    workflowManager.runStep({ runId, stepId })
  } catch (error) {
    console.error('Workflow action instrumentation failed to mark running step.', error)
  }
}

function safeCompleteStep(
  workflowManager: BonziWorkflowManager,
  runId: string,
  stepId: string,
  detail?: string
): void {
  try {
    workflowManager.completeStep({ runId, stepId, detail })
  } catch (error) {
    console.error('Workflow action instrumentation failed to complete step.', error)
  }
}

function safeFailStep(
  workflowManager: BonziWorkflowManager,
  runId: string,
  stepId: string,
  detail?: string
): void {
  try {
    workflowManager.failStep({ runId, stepId, detail })
  } catch (error) {
    console.error('Workflow action instrumentation failed to fail step.', error)
  }
}

function safeSkipStep(
  workflowManager: BonziWorkflowManager,
  runId: string,
  stepId: string,
  detail?: string
): void {
  try {
    workflowManager.skipStep({ runId, stepId, detail })
  } catch (error) {
    console.error('Workflow action instrumentation failed to skip step.', error)
  }
}

function safeRecordCallback(
  workflowManager: BonziWorkflowManager,
  runId: string,
  content: Content
): void {
  try {
    workflowManager.recordCallback(runId, {
      text: normalizeText(content.text),
      actionCount: Array.isArray(content.actions) ? content.actions.length : 0
    })
  } catch (error) {
    console.error('Workflow action instrumentation failed to record callback.', error)
  }
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function isAssistantActionType(value: unknown): value is AssistantActionType {
  return (
    typeof value === 'string' &&
    (ASSISTANT_ACTION_TYPES as readonly string[]).includes(value)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
