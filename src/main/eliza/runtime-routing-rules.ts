import type {
  AssistantActionParams,
  RuntimeRoutingRule,
  RuntimeRoutingRuleMatch,
  RuntimeRoutingSettings
} from '../../shared/contracts'
import { createBonziDesktopActionProposal } from './bonzi-desktop-actions-plugin'
import {
  dedupeProposedActions,
  type BonziProposedAction
} from './runtime-action-proposals'

const DEFAULT_HERMES_PROMPT_TEMPLATE = [
  'The user command matched routing rule “{{ruleName}}”.',
  'Provide concise advisory observations for Eliza to use. Eliza remains responsible for the final user-facing answer and any follow-up action.',
  '',
  'User command:',
  '{{command}}'
].join('\n')

export interface RuntimeRoutingMatchedRule {
  rule: RuntimeRoutingRule
  matchedText: string
  keyword?: string
  captures: Record<string, string>
}

export interface RuntimeRoutingEvaluationResult {
  matchedRules: RuntimeRoutingMatchedRule[]
  actions: BonziProposedAction[]
  warnings: string[]
}

interface MatchResult {
  matchedText: string
  keyword?: string
  captures: Record<string, string>
}

export function evaluateRuntimeRoutingRules(input: {
  command: string
  settings: RuntimeRoutingSettings
}): RuntimeRoutingEvaluationResult {
  if (!input.settings.enabled) {
    return { matchedRules: [], actions: [], warnings: [] }
  }

  const warnings: string[] = []
  const matchedRules: RuntimeRoutingMatchedRule[] = []
  const actions: BonziProposedAction[] = []
  const orderedRules = input.settings.rules
    .map((rule, index) => ({ rule, index }))
    .sort((left, right) =>
      right.rule.priority - left.rule.priority || left.index - right.index
    )

  for (const { rule } of orderedRules) {
    if (!rule.enabled) {
      continue
    }

    const match = matchRoutingRule(input.command, rule.match, rule.name, warnings)
    if (!match) {
      continue
    }

    const params = renderRoutingTargetParams({
      command: input.command,
      rule,
      match
    })
    const action = createBonziDesktopActionProposal(rule.target.actionType, params)
    actions.push({
      ...action,
      ...(typeof rule.target.requiresConfirmation === 'boolean'
        ? { requiresConfirmation: rule.target.requiresConfirmation }
        : {}),
      description: [
        `Matched routing rule “${rule.name}”.`,
        action.description
      ].filter(Boolean).join(' ')
    })
    matchedRules.push({
      rule,
      matchedText: match.matchedText,
      ...(match.keyword ? { keyword: match.keyword } : {}),
      captures: match.captures
    })

    if (rule.stopOnMatch) {
      break
    }
  }

  return {
    matchedRules,
    actions: dedupeProposedActions(actions),
    warnings
  }
}

function matchRoutingRule(
  command: string,
  match: RuntimeRoutingRuleMatch,
  ruleName: string,
  warnings: string[]
): MatchResult | null {
  if (match.kind === 'keyword') {
    const haystack = match.caseSensitive ? command : command.toLowerCase()
    const keywords = match.keywords.map((keyword) => ({
      original: keyword,
      comparable: match.caseSensitive ? keyword : keyword.toLowerCase()
    }))
    const matched = keywords.filter(({ comparable }) => haystack.includes(comparable))

    if (match.mode === 'all') {
      if (matched.length !== keywords.length) {
        return null
      }
      return {
        matchedText: matched.map(({ original }) => original).join(', '),
        keyword: matched[0]?.original,
        captures: {}
      }
    }

    const first = matched[0]
    return first
      ? {
          matchedText: first.original,
          keyword: first.original,
          captures: {}
        }
      : null
  }

  try {
    const regex = new RegExp(match.pattern, match.caseSensitive ? 'u' : 'iu')
    const result = regex.exec(command)
    if (!result) {
      return null
    }

    const captures: Record<string, string> = {}
    result.slice(1).forEach((capture, index) => {
      captures[String(index + 1)] = capture ?? ''
    })

    for (const [key, value] of Object.entries(result.groups ?? {})) {
      captures[key] = value ?? ''
    }

    return {
      matchedText: result[0],
      captures
    }
  } catch (error) {
    warnings.push(`Routing rule “${ruleName}” has an invalid regex and was skipped: ${String(error)}`)
    return null
  }
}

function renderRoutingTargetParams(input: {
  command: string
  rule: RuntimeRoutingRule
  match: MatchResult
}): AssistantActionParams {
  const rawParams = input.rule.target.params

  if (input.rule.target.actionType === 'inspect-cron-jobs') {
    return {
      query: renderTemplate(rawParams.query || '{{command}}', input)
    }
  }

  return {
    prompt: renderTemplate(rawParams.prompt || DEFAULT_HERMES_PROMPT_TEMPLATE, input)
  }
}

function renderTemplate(
  template: string,
  input: {
    command: string
    rule: RuntimeRoutingRule
    match: MatchResult
  }
): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/gu, (_token, rawName: string) => {
    switch (rawName) {
      case 'command':
        return input.command
      case 'ruleName':
        return input.rule.name
      case 'match':
        return input.match.matchedText
      case 'keyword':
        return input.match.keyword ?? ''
      default:
        if (rawName.startsWith('capture.')) {
          return input.match.captures[rawName.slice('capture.'.length)] ?? ''
        }
        return ''
    }
  }).trim()
}
