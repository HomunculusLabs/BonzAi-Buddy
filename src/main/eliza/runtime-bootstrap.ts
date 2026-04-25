import { createHash } from 'node:crypto'
import type { AgentRuntime, Plugin } from '@elizaos/core/node'
import { elizaClassicPlugin } from '@elizaos/plugin-eliza-classic'
import localdbPlugin from '@elizaos/plugin-localdb'
import type { ShellState } from '../../shared/contracts'
import { createBonziCharacter } from './bonzi-character'
import { createBonziContextPlugin } from './bonzi-context-plugin'
import { createBonziDesktopActionsPlugin } from './bonzi-desktop-actions-plugin'
import type { BonziElizaResolvedConfig } from './config'
import { DEFAULT_ELIZA_EMBEDDING_DIMENSION } from './embedding-dimensions'
import type {
  BonziExternalEmbeddingsService,
  ResolvedEmbeddingRuntimeSettings
} from './external-embeddings-service'
import type { BonziElizaPluginRuntimeSettings } from './plugin-settings'
import type {
  BonziRuntimePluginResolutionResult,
  BonziRuntimePluginSelectionMetadata
} from './plugin-runtime-resolver'

interface RuntimePluginResolver {
  resolveRuntimePlugins(): Promise<BonziRuntimePluginResolutionResult>
}

export interface BuildRuntimePluginsResult {
  plugins: Plugin[]
  warnings: string[]
}

export async function buildRuntimePlugins(options: {
  config: BonziElizaResolvedConfig
  runtimeSettings: BonziElizaPluginRuntimeSettings
  getShellState: () => ShellState
  pluginResolver?: RuntimePluginResolver
}): Promise<BuildRuntimePluginsResult> {
  const plugins: Plugin[] = [localdbPlugin]

  if (options.runtimeSettings.contextEnabled) {
    plugins.push(
      createBonziContextPlugin({
        getShellState: options.getShellState
      })
    )
  }

  if (options.runtimeSettings.desktopActionsEnabled) {
    plugins.push(
      createBonziDesktopActionsPlugin({
        approvalsEnabled: options.runtimeSettings.approvalsEnabled
      })
    )
  }

  const providerPlugin =
    options.config.effectiveProvider === 'openai-compatible'
      ? (await import('@elizaos/plugin-openai')).default
      : elizaClassicPlugin
  const runtimePlugins: Plugin[] = [...plugins, providerPlugin]

  if (!options.pluginResolver) {
    return {
      plugins: runtimePlugins,
      warnings: []
    }
  }

  const resolved = await options.pluginResolver.resolveRuntimePlugins()

  return {
    plugins: [...runtimePlugins, ...resolved.plugins],
    warnings: resolved.warnings
  }
}

export function createRuntimeCharacter(options: {
  config: BonziElizaResolvedConfig
  runtimeSettings: BonziElizaPluginRuntimeSettings
}) {
  return createBonziCharacter({
    systemPromptOverride: options.config.systemPromptOverride,
    desktopActionsEnabled: options.runtimeSettings.desktopActionsEnabled,
    contextEnabled: options.runtimeSettings.contextEnabled,
    approvalsEnabled: options.runtimeSettings.approvalsEnabled
  })
}

export async function applyRuntimeSettings(options: {
  runtime: AgentRuntime
  config: BonziElizaResolvedConfig
  dataDir: string
  embeddingsService: BonziExternalEmbeddingsService
}): Promise<string[]> {
  const { runtime, config, dataDir, embeddingsService } = options

  runtime.setSetting('LLM_MODE', 'DEFAULT')
  runtime.setSetting('CHECK_SHOULD_RESPOND', false)
  runtime.setSetting('LOCALDB_DATA_DIR', dataDir)

  if (config.effectiveProvider === 'openai-compatible' && config.openai) {
    runtime.setSetting('OPENAI_API_KEY', config.openai.apiKey, true)
    runtime.setSetting('OPENAI_BASE_URL', config.openai.baseUrl)
    runtime.setSetting('OPENAI_SMALL_MODEL', config.openai.model)
    runtime.setSetting('OPENAI_LARGE_MODEL', config.openai.model)

    const embeddingRuntimeSettings = await resolveEmbeddingRuntimeSettings({
      config,
      embeddingsService
    })

    if (embeddingRuntimeSettings?.model) {
      runtime.setSetting(
        'OPENAI_EMBEDDING_MODEL',
        embeddingRuntimeSettings.model
      )
    }

    if (embeddingRuntimeSettings?.baseUrl) {
      runtime.setSetting(
        'OPENAI_EMBEDDING_URL',
        embeddingRuntimeSettings.baseUrl
      )
    }

    if (embeddingRuntimeSettings?.apiKey) {
      runtime.setSetting(
        'OPENAI_EMBEDDING_API_KEY',
        embeddingRuntimeSettings.apiKey,
        true
      )
    }

    if (embeddingRuntimeSettings?.dimensions !== undefined) {
      runtime.setSetting(
        'OPENAI_EMBEDDING_DIMENSIONS',
        String(embeddingRuntimeSettings.dimensions)
      )
    }

    return embeddingRuntimeSettings?.warning ? [embeddingRuntimeSettings.warning] : []
  }

  await embeddingsService.stop()
  return []
}

export function createRuntimeConfigSignature(options: {
  config: BonziElizaResolvedConfig
  runtimeSettings: BonziElizaPluginRuntimeSettings
  runtimePluginSelection?: BonziRuntimePluginSelectionMetadata[]
}): string {
  const { config, runtimeSettings } = options
  const runtimePluginSelection = [...(options.runtimePluginSelection ?? [])].sort(
    (left, right) => left.id.localeCompare(right.id)
  )

  return JSON.stringify({
    effectiveProvider: config.effectiveProvider,
    e2eMode: config.e2eMode,
    systemPromptOverride: config.systemPromptOverride ?? '',
    pluginSettings: runtimeSettings,
    externalRuntimePlugins: runtimePluginSelection.map((plugin) => ({
      id: plugin.id,
      packageName: plugin.packageName ?? '',
      versionRange: plugin.versionRange ?? '',
      exportName: plugin.exportName ?? '',
      executionPolicy: plugin.executionPolicy,
      lifecycleStatus: plugin.lifecycleStatus,
      source: plugin.source
    })),
    openai: config.openai
      ? {
          baseUrl: config.openai.baseUrl,
          model: config.openai.model,
          apiKeyFingerprint: fingerprintSecret(config.openai.apiKey),
          embedding: config.openai.embedding
            ? {
                mode: config.openai.embedding.mode,
                model: config.openai.embedding.model ?? '',
                baseUrl: config.openai.embedding.baseUrl ?? '',
                apiKeyFingerprint: fingerprintSecret(
                  config.openai.embedding.apiKey
                ),
                dimensions:
                  config.openai.embedding.dimensions ??
                  DEFAULT_ELIZA_EMBEDDING_DIMENSION,
                service: config.openai.embedding.service
                  ? {
                      upstreamBaseUrl:
                        config.openai.embedding.service.upstreamBaseUrl,
                      upstreamModel:
                        config.openai.embedding.service.upstreamModel,
                      upstreamApiKeyFingerprint: fingerprintSecret(
                        config.openai.embedding.service.upstreamApiKey
                      ),
                      dimensionStrategy:
                        config.openai.embedding.service.dimensionStrategy,
                      port: config.openai.embedding.service.port,
                      timeoutMs: config.openai.embedding.service.timeoutMs
                    }
                  : null
              }
            : null
        }
      : null
  })
}

async function resolveEmbeddingRuntimeSettings(options: {
  config: BonziElizaResolvedConfig
  embeddingsService: BonziExternalEmbeddingsService
}): Promise<ResolvedEmbeddingRuntimeSettings | null> {
  const { config, embeddingsService } = options

  if (config.effectiveProvider !== 'openai-compatible' || !config.openai) {
    await embeddingsService.stop()
    return null
  }

  const embeddingConfig = config.openai.embedding
  if (!embeddingConfig) {
    await embeddingsService.stop()
    return null
  }

  const dimensions =
    embeddingConfig.dimensions ?? DEFAULT_ELIZA_EMBEDDING_DIMENSION

  if (embeddingConfig.mode === 'local-service' && embeddingConfig.service) {
    return embeddingsService.start(embeddingConfig.service, dimensions)
  }

  await embeddingsService.stop()
  return {
    model: embeddingConfig.model,
    baseUrl: embeddingConfig.baseUrl,
    apiKey: embeddingConfig.apiKey,
    dimensions
  }
}

function fingerprintSecret(value: string | undefined): string {
  if (!value) {
    return 'none'
  }

  return createHash('sha256').update(value).digest('hex')
}
