import type {
  AssistantActionParams,
  AssistantActionType
} from '../../shared/contracts'
import {
  hasAssistantActionParams,
  truncate
} from '../assistant-action-param-utils'
import {
  ACTION_SPEC_BY_TYPE,
  ACTION_TYPE_BY_ELIZA_NAME,
  type BonziDesktopActionSpec
} from './bonzi-desktop-action-catalog'

export interface BonziDesktopActionProposal {
  type: AssistantActionType
  title: string
  description: string
  requiresConfirmation: boolean
  params?: AssistantActionParams
}

export function bonziActionTypeFromElizaActionName(
  actionName: unknown
): AssistantActionType | null {
  if (typeof actionName !== 'string') {
    return null
  }

  return ACTION_TYPE_BY_ELIZA_NAME.get(actionName.trim().toUpperCase()) ?? null
}

export function createBonziDesktopActionProposal(
  type: AssistantActionType,
  params?: AssistantActionParams
): BonziDesktopActionProposal {
  const spec = ACTION_SPEC_BY_TYPE.get(type)

  if (!spec) {
    throw new Error(`Unsupported Bonzi desktop action: ${type}`)
  }

  return {
    type: spec.type,
    title: actionTitle(spec, params),
    description: actionDescription(spec, params),
    requiresConfirmation: spec.requiresConfirmation,
    ...(hasAssistantActionParams(params) ? { params } : {})
  }
}

function actionTitle(
  spec: BonziDesktopActionSpec,
  params: AssistantActionParams | undefined
): string {
  if (spec.type === 'search-web' && params?.query) {
    return 'Search the web'
  }

  if (spec.type === 'discord-scroll' && params?.direction) {
    return `Scroll Discord ${params.direction}`
  }

  if (spec.type === 'discord-type-draft' && params?.text) {
    return 'Type Discord draft'
  }

  if (spec.type === 'workspace-write-file' && params?.filePath) {
    return `Write ${params.filePath}`
  }

  if (spec.type === 'workspace-read-file' && params?.filePath) {
    return `Read ${params.filePath}`
  }

  return spec.title
}

function actionDescription(
  spec: BonziDesktopActionSpec,
  params: AssistantActionParams | undefined
): string {
  if (spec.type === 'open-url' && params?.url) {
    return `Open ${params.url} in your default browser.`
  }

  if (spec.type === 'search-web' && params?.query) {
    return `Search the web for “${params.query}” in your default browser.`
  }

  if (spec.type === 'discord-snapshot' && params?.query) {
    return `Inspect the native Discord app with Cua Driver query: “${params.query}”. This does not send messages.`
  }

  if (spec.type === 'discord-read-context') {
    const target = params?.url ? ` at ${params.url}` : ''
    const query = params?.query ? ` with query: “${params.query}”` : ''
    return `Read Discord Web DOM context${target}${query} in Bonzi's internal browser session. This uses no screenshots or OCR and does not send messages.`
  }

  if (spec.type === 'discord-read-screenshot' && params?.query) {
    return `Read the Discord screenshot with vision query: “${params.query}”. This does not send messages.`
  }

  if (spec.type === 'discord-scroll' && params?.direction) {
    return `Scroll Discord ${params.direction} by ${params.amount ?? 5}, then return a short snapshot. This does not send messages.`
  }

  if (spec.type === 'discord-type-draft' && params?.text) {
    const target = params.url ? ` in ${params.url}` : ''
    return `Type this Discord Web draft${target} in Bonzi's internal browser session without pressing Enter or sending it: “${truncate(params.text, 160)}”`
  }

  if (spec.type === 'workspace-list-files') {
    return params?.filePath
      ? `List files in workspace directory “${params.filePath}”. Bonzi cannot list arbitrary folders.`
      : "List files in Bonzi's dedicated writable workspace folder."
  }

  if (spec.type === 'workspace-read-file' && params?.filePath) {
    return `Read “${params.filePath}” from Bonzi's dedicated writable workspace folder.`
  }

  if (spec.type === 'workspace-write-file' && params?.filePath) {
    return `Write ${params.content?.length ?? 0} character${params.content?.length === 1 ? '' : 's'} to “${params.filePath}” inside Bonzi's dedicated writable workspace folder.`
  }

  return spec.description
}
