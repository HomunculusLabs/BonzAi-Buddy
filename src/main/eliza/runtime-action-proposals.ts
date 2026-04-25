import type {
  ActionResult,
  Content,
  ProviderDataRecord
} from '@elizaos/core/node'
import {
  ASSISTANT_ACTION_TYPES,
  type AssistantActionParams,
  type AssistantActionType
} from '../../shared/contracts'
import {
  normalizeText,
  sanitizeAssistantActionParams
} from '../assistant-action-param-utils'
import {
  bonziActionTypeFromElizaActionName,
  createBonziDesktopActionProposal
} from './bonzi-desktop-actions-plugin'

export interface BonziProposedAction {
  type: AssistantActionType
  title?: string
  description?: string
  requiresConfirmation?: boolean
  params?: AssistantActionParams
}

export function extractBonziActionsFromContent(
  content: Content | null | undefined
): BonziProposedAction[] {
  const actions = Array.isArray(content?.actions) ? content.actions : []

  return actions.flatMap((actionName) => {
    const type = bonziActionTypeFromElizaActionName(actionName)
    return type ? [createBonziDesktopActionProposal(type)] : []
  })
}

export function extractFailedBonziActionTypes(
  results: ActionResult[]
): Set<AssistantActionType> {
  const failedTypes = new Set<AssistantActionType>()

  for (const result of results) {
    if (result.success !== false) {
      continue
    }

    const typeFromData = result.data?.bonziActionType
    const type = isAssistantActionType(typeFromData)
      ? typeFromData
      : bonziActionTypeFromElizaActionName(result.data?.actionName)

    if (type) {
      failedTypes.add(type)
    }
  }

  return failedTypes
}

export function filterFailedProposedActions(
  actions: BonziProposedAction[],
  failedActionTypes: Set<AssistantActionType>
): BonziProposedAction[] {
  if (failedActionTypes.size === 0) {
    return actions
  }

  return actions.filter(
    (action) => action.params || !failedActionTypes.has(action.type)
  )
}

export function extractBonziActionsFromActionResults(
  results: ActionResult[]
): BonziProposedAction[] {
  return results.flatMap((result) => {
    if (result.success === false || result.data?.bonziActionExecuted === true) {
      return []
    }

    const proposal = extractBonziActionProposalFromData(result.data)

    if (proposal) {
      return [proposal]
    }

    const type = bonziActionTypeFromElizaActionName(result.data?.actionName)
    return type ? [createBonziDesktopActionProposal(type)] : []
  })
}

export function dedupeProposedActions(
  actions: BonziProposedAction[]
): BonziProposedAction[] {
  const deduped: BonziProposedAction[] = []
  const seenKeys = new Set<string>()

  for (const action of actions) {
    const key = proposedActionKey(action)

    if (seenKeys.has(key)) {
      continue
    }

    if (!action.params && deduped.some((candidate) => candidate.type === action.type)) {
      continue
    }

    const lessSpecificIndex = deduped.findIndex(
      (candidate) => candidate.type === action.type && !candidate.params && action.params
    )

    if (lessSpecificIndex >= 0) {
      seenKeys.delete(proposedActionKey(deduped[lessSpecificIndex]))
      deduped[lessSpecificIndex] = action
      seenKeys.add(key)
      continue
    }

    seenKeys.add(key)
    deduped.push(action)
  }

  return deduped
}

function extractBonziActionProposalFromData(
  data: ProviderDataRecord | undefined
): BonziProposedAction | null {
  const rawProposal = data?.bonziProposedAction

  if (!isRecord(rawProposal)) {
    return null
  }

  const type = rawProposal.type

  if (!isAssistantActionType(type)) {
    return null
  }

  const params =
    sanitizeAssistantActionParams(rawProposal.params) ??
    sanitizeAssistantActionParams(data?.bonziActionParams)
  const defaults = createBonziDesktopActionProposal(type, params)

  return {
    type,
    title: normalizeText(rawProposal.title) || defaults.title,
    description: normalizeText(rawProposal.description) || defaults.description,
    requiresConfirmation:
      typeof rawProposal.requiresConfirmation === 'boolean'
        ? rawProposal.requiresConfirmation
        : defaults.requiresConfirmation,
    ...(params ? { params } : {})
  }
}

function proposedActionKey(action: BonziProposedAction): string {
  return action.params
    ? `${action.type}:${JSON.stringify(action.params)}`
    : action.type
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
