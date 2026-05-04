import type { AssistantRuntimeLifecycleState } from './assistant'

export interface HermesGatewaySettings {
  enabled: boolean
  baseUrl: string
  apiKey?: string
  host: string
  port: number
}

export interface HermesRuntimeSettings {
  cliPath: string
  cwd: string
  model?: string
  providerOverride?: string
  timeoutMs: number
  systemPrompt?: string
  gateway: HermesGatewaySettings
}

export interface UpdateHermesRuntimeSettingsRequest {
  cliPath?: string
  cwd?: string
  model?: string
  providerOverride?: string
  timeoutMs?: number
  systemPrompt?: string
  gateway?: Partial<HermesGatewaySettings>
}

export interface HermesRuntimeSettingsResponse {
  settings: HermesRuntimeSettings
  envOverrides: string[]
  warnings: string[]
}

export type HermesConfigSource =
  | 'default'
  | 'hermes-config'
  | 'hermes-env'
  | 'auth-json'
  | 'process-env'
  | 'bonzi-env'
  | 'bonzi-overlay'
  | 'profile'
  | 'missing'

export type HermesSettingsOptionSource =
  | HermesConfigSource
  | 'catalog'
  | 'current'
  | 'local-default'
  | 'profile-config'
  | 'canonical'
  | 'user-config'

export interface HermesProviderOption {
  id: string
  label: string
  configured: boolean
  current: boolean
  local: boolean
  sources: HermesSettingsOptionSource[]
  detail: string
  modelCount: number
}

export interface HermesModelOption {
  id: string
  label: string
  provider: string
  current: boolean
  source: HermesSettingsOptionSource
  detail?: string
}

export interface HermesConfigFileStatus {
  path: string
  exists: boolean
  readable: boolean
  error?: string
}

export interface HermesProfileSummary {
  name: string
  path: string
  active: boolean
  source: HermesConfigSource
}

export interface HermesMaskedCredential {
  key: string
  source: HermesConfigSource
  maskedValue: string
}

export interface HermesAuthCredentialStatus {
  configured: boolean
  status: 'configured' | 'missing' | 'unknown'
  source: HermesConfigSource
  requiredEnvKeys: string[]
  configuredEnvKeys: HermesMaskedCredential[]
  oauthCredentials: string[]
  diagnostics: string[]
}

export interface HermesModelAuthSettings {
  provider: string
  model: string
  baseUrl?: string
  activeProfile: HermesProfileSummary
  profiles: HermesProfileSummary[]
  hermesHome: string
  paths: {
    configPath: string
    envPath: string
    authJsonPath: string
  }
  sources: {
    provider: HermesConfigSource
    model: HermesConfigSource
    baseUrl: HermesConfigSource
  }
  auth: HermesAuthCredentialStatus
  providerOptions: HermesProviderOption[]
  modelOptions: HermesModelOption[]
  modelCatalog: Record<string, HermesModelOption[]>
  files: {
    config: HermesConfigFileStatus
    env: HermesConfigFileStatus
    authJson: HermesConfigFileStatus
  }
  diagnostics: string[]
}

export interface HermesModelAuthSettingsResponse {
  settings: HermesModelAuthSettings
}

export interface UpdateHermesModelAuthSettingsRequest {
  provider?: string
  model?: string
  baseUrl?: string
  activeProfile?: string
}

export interface HermesModelAuthCheckResult {
  ok: boolean
  message: string
  settings: HermesModelAuthSettings
}

export type HermesHealthCheckKind = 'status' | 'cron' | 'gateway'

export interface HermesHealthCheckRequest {
  kind: HermesHealthCheckKind
}

export interface HermesHealthCheckResult {
  ok: boolean
  kind: HermesHealthCheckKind
  message: string
  details?: string
}

export interface HermesSecondaryRuntimeStatus {
  backend: 'hermes'
  role: 'secondary'
  state: AssistantRuntimeLifecycleState
  invocation: 'cli' | 'gateway'
  persistence: 'none'
  lastError?: string
}

export interface HermesSecondaryRuntimeSummary {
  enabled: boolean
  status: HermesSecondaryRuntimeStatus
  warnings: string[]
}

export interface HermesConsultationRequest {
  prompt: string
  workflowRunId?: string
  actionId?: string
}

export interface HermesConsultationResult {
  ok: boolean
  text: string
  warnings: string[]
  rawText?: string
  ignoredActionCount?: number
}
