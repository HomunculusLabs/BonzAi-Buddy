import type { AssistantProviderInfo, AssistantProviderKind } from './assistant'

export type AssistantProviderSettingsSource = 'env' | 'settings'

export interface AssistantOpenAiCompatibleProviderSettings {
  baseUrl: string
  model: string
}

export interface AssistantPiAiProviderSettings {
  agentDir: string
  modelSpec: string
  smallModelSpec: string
  largeModelSpec: string
  priority: string
}


export interface PiAiModelOption {
  id: string
  name: string
  provider: string
  isDefault: boolean
}

export interface ListPiAiModelOptionsRequest {
  agentDir?: string
}

export interface ListPiAiModelOptionsResult {
  ok: boolean
  defaultModelSpec?: string
  models: PiAiModelOption[]
  agentDir?: string
  error?: string
}

export interface PersistedAssistantProviderSettings {
  provider?: AssistantProviderKind
  openaiCompatible?: Partial<AssistantOpenAiCompatibleProviderSettings>
  piAi?: Partial<AssistantPiAiProviderSettings>
}

export interface AssistantProviderSettings {
  provider: AssistantProviderKind
  source: AssistantProviderSettingsSource
  effectiveProvider: AssistantProviderInfo
  envProvider: AssistantProviderInfo
  openaiCompatible: AssistantOpenAiCompatibleProviderSettings
  piAi: AssistantPiAiProviderSettings
}

export interface UpdateAssistantProviderSettingsRequest {
  provider: AssistantProviderKind
  openaiCompatible?: Partial<AssistantOpenAiCompatibleProviderSettings>
  piAi?: Partial<AssistantPiAiProviderSettings>
}
