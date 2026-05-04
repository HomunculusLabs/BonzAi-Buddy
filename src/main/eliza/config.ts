import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AssistantProviderInfo, PersistedAssistantProviderSettings } from '../../shared/contracts'
import {
  parseElizaCompatibleEmbeddingDimension,
  type ElizaCompatibleEmbeddingDimension
} from './embedding-dimensions'
import type {
  BonziEmbeddingsUpstreamDimensionStrategy,
  BonziExternalEmbeddingsServiceConfig
} from './external-embeddings-service'

export const DEFAULT_OPENAI_BASE_URL = 'https://api.z.ai/api/coding/paas/v4'
export const DEFAULT_OPENAI_MODEL = 'GLM-5.1'
export const DEFAULT_EMBEDDINGS_SERVICE_TIMEOUT_MS = 30_000

export type BonziElizaProviderMode = 'eliza-classic' | 'openai-compatible' | 'pi-ai'
export type BonziElizaRequestedProvider =
  | BonziElizaProviderMode
  | 'mock'

type RuntimeEnv = Record<string, string>

export interface BonziOpenAiEmbeddingConfig {
  mode: 'direct' | 'local-service'
  dimensions?: ElizaCompatibleEmbeddingDimension
  model?: string
  baseUrl?: string
  apiKey?: string
  service?: BonziExternalEmbeddingsServiceConfig
}

export interface BonziElizaResolvedConfig {
  requestedProvider: BonziElizaRequestedProvider
  effectiveProvider: BonziElizaProviderMode
  provider: AssistantProviderInfo
  startupWarnings: string[]
  e2eMode: boolean
  systemPromptOverride?: string
  openai?: {
    apiKey: string
    baseUrl: string
    model: string
    embedding?: BonziOpenAiEmbeddingConfig
  }
  piAi?: {
    agentDir?: string
    modelSpec?: string
    smallModelSpec?: string
    largeModelSpec?: string
    priority?: string
  }
}

export function loadBonziElizaConfig(
  env: RuntimeEnv = loadRuntimeEnv(),
  providerSettings: PersistedAssistantProviderSettings = {}
): BonziElizaResolvedConfig {
  const e2eMode = env.BONZI_E2E_MODE?.trim() === '1'
  const { requestedProvider, invalidProviderValue } = normalizeRequestedProvider(
    providerSettings.provider ?? env.BONZI_ASSISTANT_PROVIDER
  )
  const systemPromptOverride = env.BONZI_OPENAI_SYSTEM_PROMPT?.trim() || undefined
  const startupWarningsForInvalidProvider =
    invalidProviderValue === undefined
      ? []
      : [
          `BONZI_ASSISTANT_PROVIDER=${invalidProviderValue} is not recognized. Falling back to Eliza Classic.`
        ]

  if (requestedProvider === 'pi-ai') {
    const modelSpec = firstNonEmpty(
      providerSettings.piAi?.modelSpec,
      env.BONZI_PI_AI_MODEL_SPEC,
      env.PI_AI_MODEL_SPEC
    )
    const smallModelSpec = firstNonEmpty(
      providerSettings.piAi?.smallModelSpec,
      env.BONZI_PI_AI_SMALL_MODEL_SPEC,
      env.PI_AI_SMALL_MODEL_SPEC
    )
    const largeModelSpec = firstNonEmpty(
      providerSettings.piAi?.largeModelSpec,
      env.BONZI_PI_AI_LARGE_MODEL_SPEC,
      env.PI_AI_LARGE_MODEL_SPEC
    )
    const agentDir = firstNonEmpty(
      providerSettings.piAi?.agentDir,
      env.BONZI_PI_CODING_AGENT_DIR,
      env.PI_CODING_AGENT_DIR
    )
    const priority = firstNonEmpty(
      providerSettings.piAi?.priority,
      env.BONZI_PI_AI_PRIORITY,
      env.PI_AI_PRIORITY
    )
    const labelModel = largeModelSpec ?? modelSpec ?? smallModelSpec
    const startupWarnings = [...startupWarningsForInvalidProvider]
    const embedding = buildEmbeddingConfigFromEnv(env, startupWarnings)
    const apiKey = env.BONZI_OPENAI_API_KEY?.trim() ?? ''
    const openAiModel = env.BONZI_OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL
    const openAiBaseUrl = env.BONZI_OPENAI_BASE_URL?.trim() || DEFAULT_OPENAI_BASE_URL

    return {
      requestedProvider,
      effectiveProvider: 'pi-ai',
      provider: {
        kind: 'pi-ai',
        label: labelModel ? `Pi AI (${labelModel})` : 'Pi AI'
      },
      startupWarnings,
      e2eMode,
      systemPromptOverride,
      openai: {
        apiKey,
        baseUrl: openAiBaseUrl,
        model: openAiModel,
        ...(embedding ? { embedding } : {})
      },
      piAi: {
        ...(agentDir ? { agentDir } : {}),
        ...(modelSpec ? { modelSpec } : {}),
        ...(smallModelSpec ? { smallModelSpec } : {}),
        ...(largeModelSpec ? { largeModelSpec } : {}),
        ...(priority ? { priority } : {})
      }
    }
  }

  if (requestedProvider === 'openai-compatible') {
    const apiKey = env.BONZI_OPENAI_API_KEY?.trim()
    const model =
      providerSettings.openaiCompatible?.model?.trim() ||
      env.BONZI_OPENAI_MODEL?.trim() ||
      DEFAULT_OPENAI_MODEL
    const baseUrl =
      providerSettings.openaiCompatible?.baseUrl?.trim() ||
      env.BONZI_OPENAI_BASE_URL?.trim() ||
      DEFAULT_OPENAI_BASE_URL
    const directEmbeddingModel =
      env.BONZI_OPENAI_EMBEDDING_MODEL?.trim() || undefined
    const directEmbeddingBaseUrl =
      env.BONZI_OPENAI_EMBEDDING_URL?.trim() || undefined
    const directEmbeddingApiKey =
      env.BONZI_OPENAI_EMBEDDING_API_KEY?.trim() || undefined
    const serviceUpstreamBaseUrl =
      env.BONZI_EMBEDDINGS_UPSTREAM_URL?.trim() || undefined
    const serviceUpstreamModel =
      env.BONZI_EMBEDDINGS_UPSTREAM_MODEL?.trim() || undefined
    const serviceUpstreamApiKey =
      env.BONZI_EMBEDDINGS_UPSTREAM_API_KEY?.trim() || undefined
    const {
      dimensions: embeddingDimensions,
      warning: embeddingDimensionWarning
    } = parseElizaCompatibleEmbeddingDimension(
      env.BONZI_OPENAI_EMBEDDING_DIMENSIONS
    )
    const {
      value: servicePort,
      warning: servicePortWarning
    } = parseServicePort(env.BONZI_EMBEDDINGS_SERVICE_PORT)
    const {
      value: serviceTimeoutMs,
      warning: serviceTimeoutWarning
    } = parseServiceTimeout(env.BONZI_EMBEDDINGS_SERVICE_TIMEOUT_MS)
    const {
      value: serviceDimensionStrategy,
      warning: serviceDimensionStrategyWarning
    } = parseDimensionStrategy(env.BONZI_EMBEDDINGS_UPSTREAM_DIMENSION_STRATEGY)
    const startupWarnings = [...startupWarningsForInvalidProvider]

    if (embeddingDimensionWarning) {
      startupWarnings.push(embeddingDimensionWarning)
    }

    if (servicePortWarning) {
      startupWarnings.push(servicePortWarning)
    }

    if (serviceTimeoutWarning) {
      startupWarnings.push(serviceTimeoutWarning)
    }

    if (serviceDimensionStrategyWarning) {
      startupWarnings.push(serviceDimensionStrategyWarning)
    }

    if (!apiKey) {
      return {
        requestedProvider,
        effectiveProvider: 'eliza-classic',
        provider: {
          kind: 'eliza-classic',
          label: 'Eliza Classic (fallback)'
        },
        startupWarnings: [
          ...startupWarnings,
          'BONZI_ASSISTANT_PROVIDER=openai-compatible was requested, but BONZI_OPENAI_API_KEY is missing. Falling back to Eliza Classic.'
        ],
        e2eMode,
        systemPromptOverride
      }
    }

    const hasDirectEmbeddingOverride =
      directEmbeddingModel !== undefined ||
      directEmbeddingBaseUrl !== undefined ||
      directEmbeddingApiKey !== undefined ||
      embeddingDimensions !== undefined
    const hasServiceHints =
      serviceUpstreamBaseUrl !== undefined ||
      serviceUpstreamModel !== undefined ||
      serviceUpstreamApiKey !== undefined ||
      Boolean(env.BONZI_EMBEDDINGS_UPSTREAM_DIMENSION_STRATEGY?.trim()) ||
      Boolean(env.BONZI_EMBEDDINGS_SERVICE_PORT?.trim()) ||
      Boolean(env.BONZI_EMBEDDINGS_SERVICE_TIMEOUT_MS?.trim())

    let embedding: BonziOpenAiEmbeddingConfig | undefined

    if (serviceUpstreamBaseUrl && serviceUpstreamModel) {
      if (
        directEmbeddingModel !== undefined ||
        directEmbeddingBaseUrl !== undefined ||
        directEmbeddingApiKey !== undefined
      ) {
        startupWarnings.push(
          'BONZI_OPENAI_EMBEDDING_MODEL, BONZI_OPENAI_EMBEDDING_URL, and BONZI_OPENAI_EMBEDDING_API_KEY are ignored while BONZI_EMBEDDINGS_UPSTREAM_URL and BONZI_EMBEDDINGS_UPSTREAM_MODEL enable the Bonzi-managed embeddings service.'
        )
      }

      embedding = {
        mode: 'local-service',
        dimensions: embeddingDimensions,
        service: {
          upstreamBaseUrl: serviceUpstreamBaseUrl,
          upstreamModel: serviceUpstreamModel,
          upstreamApiKey: serviceUpstreamApiKey,
          dimensionStrategy: serviceDimensionStrategy,
          bindHost: '127.0.0.1',
          port: servicePort,
          timeoutMs: serviceTimeoutMs
        }
      }
    } else if (hasServiceHints) {
      startupWarnings.push(
        'BONZI_EMBEDDINGS_UPSTREAM_URL and BONZI_EMBEDDINGS_UPSTREAM_MODEL must both be set to enable the Bonzi-managed embeddings service. Falling back to direct embedding configuration.'
      )
    }

    if (!embedding && hasDirectEmbeddingOverride) {
      embedding = {
        mode: 'direct',
        model: directEmbeddingModel,
        baseUrl: directEmbeddingBaseUrl,
        apiKey: directEmbeddingApiKey,
        dimensions: embeddingDimensions
      }
    }

    return {
      requestedProvider,
      effectiveProvider: 'openai-compatible',
      provider: {
        kind: 'openai-compatible',
        label: `OpenAI-compatible (${model})`
      },
      startupWarnings,
      e2eMode,
      systemPromptOverride,
      openai: {
        apiKey,
        baseUrl,
        model,
        ...(embedding ? { embedding } : {})
      }
    }
  }

  return {
    requestedProvider,
    effectiveProvider: 'eliza-classic',
    provider: {
      kind: 'eliza-classic',
      label:
        requestedProvider === 'mock'
          ? 'Eliza Classic (legacy mock alias)'
          : 'Eliza Classic'
    },
    e2eMode,
    startupWarnings: [
      ...startupWarningsForInvalidProvider,
      ...(requestedProvider === 'mock'
        ? [
            'BONZI_ASSISTANT_PROVIDER=mock is now treated as a legacy alias for Eliza Classic.'
          ]
        : [])
    ],
    systemPromptOverride
  }
}


function buildEmbeddingConfigFromEnv(
  env: RuntimeEnv,
  startupWarnings: string[]
): BonziOpenAiEmbeddingConfig | undefined {
  const directEmbeddingModel =
    env.BONZI_OPENAI_EMBEDDING_MODEL?.trim() || undefined
  const directEmbeddingBaseUrl =
    env.BONZI_OPENAI_EMBEDDING_URL?.trim() || undefined
  const directEmbeddingApiKey =
    env.BONZI_OPENAI_EMBEDDING_API_KEY?.trim() || undefined
  const serviceUpstreamBaseUrl =
    env.BONZI_EMBEDDINGS_UPSTREAM_URL?.trim() || undefined
  const serviceUpstreamModel =
    env.BONZI_EMBEDDINGS_UPSTREAM_MODEL?.trim() || undefined
  const serviceUpstreamApiKey =
    env.BONZI_EMBEDDINGS_UPSTREAM_API_KEY?.trim() || undefined
  const {
    dimensions: embeddingDimensions,
    warning: embeddingDimensionWarning
  } = parseElizaCompatibleEmbeddingDimension(
    env.BONZI_OPENAI_EMBEDDING_DIMENSIONS
  )
  const {
    value: servicePort,
    warning: servicePortWarning
  } = parseServicePort(env.BONZI_EMBEDDINGS_SERVICE_PORT)
  const {
    value: serviceTimeoutMs,
    warning: serviceTimeoutWarning
  } = parseServiceTimeout(env.BONZI_EMBEDDINGS_SERVICE_TIMEOUT_MS)
  const {
    value: serviceDimensionStrategy,
    warning: serviceDimensionStrategyWarning
  } = parseDimensionStrategy(env.BONZI_EMBEDDINGS_UPSTREAM_DIMENSION_STRATEGY)

  if (embeddingDimensionWarning) {
    startupWarnings.push(embeddingDimensionWarning)
  }

  if (servicePortWarning) {
    startupWarnings.push(servicePortWarning)
  }

  if (serviceTimeoutWarning) {
    startupWarnings.push(serviceTimeoutWarning)
  }

  if (serviceDimensionStrategyWarning) {
    startupWarnings.push(serviceDimensionStrategyWarning)
  }

  const hasDirectEmbeddingOverride =
    directEmbeddingModel !== undefined ||
    directEmbeddingBaseUrl !== undefined ||
    directEmbeddingApiKey !== undefined ||
    embeddingDimensions !== undefined
  const hasServiceHints =
    serviceUpstreamBaseUrl !== undefined ||
    serviceUpstreamModel !== undefined ||
    serviceUpstreamApiKey !== undefined ||
    Boolean(env.BONZI_EMBEDDINGS_UPSTREAM_DIMENSION_STRATEGY?.trim()) ||
    Boolean(env.BONZI_EMBEDDINGS_SERVICE_PORT?.trim()) ||
    Boolean(env.BONZI_EMBEDDINGS_SERVICE_TIMEOUT_MS?.trim())

  if (serviceUpstreamBaseUrl && serviceUpstreamModel) {
    if (
      directEmbeddingModel !== undefined ||
      directEmbeddingBaseUrl !== undefined ||
      directEmbeddingApiKey !== undefined
    ) {
      startupWarnings.push(
        'BONZI_OPENAI_EMBEDDING_MODEL, BONZI_OPENAI_EMBEDDING_URL, and BONZI_OPENAI_EMBEDDING_API_KEY are ignored while BONZI_EMBEDDINGS_UPSTREAM_URL and BONZI_EMBEDDINGS_UPSTREAM_MODEL enable the Bonzi-managed embeddings service.'
      )
    }

    return {
      mode: 'local-service',
      dimensions: embeddingDimensions,
      service: {
        upstreamBaseUrl: serviceUpstreamBaseUrl,
        upstreamModel: serviceUpstreamModel,
        upstreamApiKey: serviceUpstreamApiKey,
        dimensionStrategy: serviceDimensionStrategy,
        bindHost: '127.0.0.1',
        port: servicePort,
        timeoutMs: serviceTimeoutMs
      }
    }
  }

  if (hasServiceHints) {
    startupWarnings.push(
      'BONZI_EMBEDDINGS_UPSTREAM_URL and BONZI_EMBEDDINGS_UPSTREAM_MODEL must both be set to enable the Bonzi-managed embeddings service. Falling back to direct embedding configuration.'
    )
  }

  if (hasDirectEmbeddingOverride) {
    return {
      mode: 'direct',
      model: directEmbeddingModel,
      baseUrl: directEmbeddingBaseUrl,
      apiKey: directEmbeddingApiKey,
      dimensions: embeddingDimensions
    }
  }

  return undefined
}

function loadRuntimeEnv(): RuntimeEnv {
  const fileEnv = loadDotEnv(join(process.cwd(), '.env'))
  const processEnv = Object.fromEntries(
    Object.entries(process.env).flatMap(([key, value]) =>
      typeof value === 'string' ? [[key, value]] : []
    )
  )

  return {
    ...fileEnv,
    ...processEnv
  }
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const normalized = value?.trim()
    if (normalized) {
      return normalized
    }
  }

  return undefined
}

function loadDotEnv(filePath: string): RuntimeEnv {
  if (!existsSync(filePath)) {
    return {}
  }

  return readFileSync(filePath, 'utf8')
    .split(/\r?\n/u)
    .reduce<RuntimeEnv>((env, line) => {
      const trimmed = line.trim()

      if (!trimmed || trimmed.startsWith('#')) {
        return env
      }

      const normalized = trimmed.startsWith('export ')
        ? trimmed.slice('export '.length)
        : trimmed
      const separatorIndex = normalized.indexOf('=')

      if (separatorIndex <= 0) {
        return env
      }

      const key = normalized.slice(0, separatorIndex).trim()
      const rawValue = normalized.slice(separatorIndex + 1).trim()
      env[key] = stripWrappingQuotes(rawValue)
      return env
    }, {})
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }

  return value
}

function parseServicePort(value: string | undefined): {
  value: number
  warning?: string
} {
  const trimmed = value?.trim()

  if (!trimmed) {
    return { value: 0 }
  }

  const parsed = Number(trimmed)
  if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 65_535) {
    return { value: parsed }
  }

  return {
    value: 0,
    warning:
      'BONZI_EMBEDDINGS_SERVICE_PORT must be an integer between 0 and 65535. Falling back to an ephemeral loopback port.'
  }
}

function parseServiceTimeout(value: string | undefined): {
  value: number
  warning?: string
} {
  const trimmed = value?.trim()

  if (!trimmed) {
    return { value: DEFAULT_EMBEDDINGS_SERVICE_TIMEOUT_MS }
  }

  const parsed = Number(trimmed)
  if (Number.isInteger(parsed) && parsed > 0) {
    return { value: parsed }
  }

  return {
    value: DEFAULT_EMBEDDINGS_SERVICE_TIMEOUT_MS,
    warning:
      `BONZI_EMBEDDINGS_SERVICE_TIMEOUT_MS must be a positive integer. Falling back to ${DEFAULT_EMBEDDINGS_SERVICE_TIMEOUT_MS}ms.`
  }
}

function parseDimensionStrategy(
  value: string | undefined
): {
  value: BonziEmbeddingsUpstreamDimensionStrategy
  warning?: string
} {
  const trimmed = value?.trim()

  if (!trimmed || trimmed === 'strict') {
    return { value: 'strict' }
  }

  if (trimmed === 'matryoshka-truncate') {
    return { value: 'matryoshka-truncate' }
  }

  return {
    value: 'strict',
    warning:
      'BONZI_EMBEDDINGS_UPSTREAM_DIMENSION_STRATEGY must be either strict or matryoshka-truncate. Falling back to strict.'
  }
}

function normalizeRequestedProvider(value: string | undefined): {
  requestedProvider: BonziElizaRequestedProvider
  invalidProviderValue?: string
} {
  const normalized = value?.trim()

  if (normalized === 'openai-compatible') {
    return {
      requestedProvider: 'openai-compatible'
    }
  }

  if (normalized === 'pi-ai') {
    return {
      requestedProvider: 'pi-ai'
    }
  }

  if (normalized === 'eliza-classic') {
    return {
      requestedProvider: 'eliza-classic'
    }
  }

  if (normalized === 'mock') {
    return {
      requestedProvider: 'mock'
    }
  }

  if (!normalized) {
    return {
      requestedProvider: 'eliza-classic'
    }
  }

  return {
    requestedProvider: 'eliza-classic',
    invalidProviderValue: normalized
  }
}
