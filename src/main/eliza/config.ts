import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AssistantProviderInfo } from '../../shared/contracts'

export const DEFAULT_OPENAI_BASE_URL = 'https://api.z.ai/api/coding/paas/v4'
export const DEFAULT_OPENAI_MODEL = 'GLM-5.1'

export type BonziElizaProviderMode = 'eliza-classic' | 'openai-compatible'
export type BonziElizaRequestedProvider =
  | BonziElizaProviderMode
  | 'mock'

type RuntimeEnv = Record<string, string>

export interface BonziElizaResolvedConfig {
  requestedProvider: BonziElizaRequestedProvider
  effectiveProvider: BonziElizaProviderMode
  provider: AssistantProviderInfo
  startupWarnings: string[]
  systemPromptOverride?: string
  openai?: {
    apiKey: string
    baseUrl: string
    model: string
  }
}

export function loadBonziElizaConfig(
  env: RuntimeEnv = loadRuntimeEnv()
): BonziElizaResolvedConfig {
  const { requestedProvider, invalidProviderValue } = normalizeRequestedProvider(
    env.BONZI_ASSISTANT_PROVIDER
  )
  const systemPromptOverride = env.BONZI_OPENAI_SYSTEM_PROMPT?.trim() || undefined
  const startupWarningsForInvalidProvider =
    invalidProviderValue === undefined
      ? []
      : [
          `BONZI_ASSISTANT_PROVIDER=${invalidProviderValue} is not recognized. Falling back to Eliza Classic.`
        ]

  if (requestedProvider === 'openai-compatible') {
    const apiKey = env.BONZI_OPENAI_API_KEY?.trim()
    const model = env.BONZI_OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL
    const baseUrl = env.BONZI_OPENAI_BASE_URL?.trim() || DEFAULT_OPENAI_BASE_URL

    if (!apiKey) {
      return {
        requestedProvider,
        effectiveProvider: 'eliza-classic',
        provider: {
          kind: 'eliza-classic',
          label: 'Eliza Classic (fallback)'
        },
        startupWarnings: [
          ...startupWarningsForInvalidProvider,
          'BONZI_ASSISTANT_PROVIDER=openai-compatible was requested, but BONZI_OPENAI_API_KEY is missing. Falling back to Eliza Classic.'
        ],
        systemPromptOverride
      }
    }

    return {
      requestedProvider,
      effectiveProvider: 'openai-compatible',
      provider: {
        kind: 'openai-compatible',
        label: `OpenAI-compatible (${model})`
      },
      startupWarnings: startupWarningsForInvalidProvider,
      systemPromptOverride,
      openai: {
        apiKey,
        baseUrl,
        model
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
