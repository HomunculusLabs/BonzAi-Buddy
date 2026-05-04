import type { AssistantActionType } from './assistant'

export type RuntimeRoutingRuleMatchKind = 'keyword' | 'regex'
export type RuntimeRoutingRuleKeywordMode = 'any' | 'all'

export type RuntimeRoutingTargetActionType = Extract<
  AssistantActionType,
  'hermes-run' | 'inspect-cron-jobs'
>

export interface RuntimeRoutingKeywordMatch {
  kind: 'keyword'
  keywords: string[]
  mode: RuntimeRoutingRuleKeywordMode
  caseSensitive: boolean
}

export interface RuntimeRoutingRegexMatch {
  kind: 'regex'
  pattern: string
  caseSensitive: boolean
}

export type RuntimeRoutingRuleMatch =
  | RuntimeRoutingKeywordMatch
  | RuntimeRoutingRegexMatch

export interface RuntimeRoutingRuleTarget {
  actionType: RuntimeRoutingTargetActionType
  params: {
    prompt?: string
    query?: string
  }
  requiresConfirmation?: boolean
}

export interface RuntimeRoutingRule {
  id: string
  enabled: boolean
  name: string
  priority: number
  match: RuntimeRoutingRuleMatch
  target: RuntimeRoutingRuleTarget
  stopOnMatch: boolean
}

export interface RuntimeRoutingSettings {
  enabled: boolean
  rules: RuntimeRoutingRule[]
}

export interface RuntimeRoutingSettingsResponse {
  settings: RuntimeRoutingSettings
  warnings: string[]
}

export interface UpdateRuntimeRoutingSettingsRequest {
  enabled?: boolean
  rules?: RuntimeRoutingRule[]
}
