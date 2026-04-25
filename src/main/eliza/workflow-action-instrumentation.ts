import type {
  Action,
  ActionResult,
  HandlerCallback,
  Memory,
  Plugin,
  Content
} from '@elizaos/core/node'
import type { ElizaPluginExecutionPolicy } from '../../shared/contracts'
import { normalizeText } from '../assistant-action-param-utils'
import type { BonziWorkflowManager } from './workflow-manager'

interface WorkflowActionInstrumentationOptions {
  plugin: Plugin
  pluginId: string
  executionPolicy: ElizaPluginExecutionPolicy
  workflowManager: BonziWorkflowManager
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
      workflowManager: options.workflowManager
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
}): Action {
  const { action, pluginId, executionPolicy, workflowManager } = options
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
