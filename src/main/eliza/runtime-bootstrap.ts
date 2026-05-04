import { createHash } from 'node:crypto'
import type { AgentRuntime, Plugin } from '@elizaos/core/node'
import { elizaClassicPlugin } from '@elizaos/plugin-eliza-classic'
import localdbPlugin from '@elizaos/plugin-localdb'
import type { ShellState } from '../../shared/contracts'
import { createBonziCharacter } from './bonzi-character'
import { createBonziContextPlugin } from './bonzi-context-plugin'
import { createBonziDesktopActionsPlugin } from './bonzi-desktop-actions-plugin'
import { createBonziKnowledgePlugin } from './bonzi-knowledge-plugin'
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
  const plugins: Plugin[] = [localdbPlugin, createBonziKnowledgePlugin()]

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

  const providerPlugins = await buildProviderPlugins(options.config)
  const runtimePlugins: Plugin[] = [...plugins, ...providerPlugins]

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
    approvalsEnabled: options.runtimeSettings.approvalsEnabled,
    characterOverride: options.runtimeSettings.character.enabled
      ? options.runtimeSettings.character.override
      : null
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

  if (config.effectiveProvider === 'pi-ai') {
    const modelSpec =
      config.piAi?.modelSpec ??
      config.piAi?.largeModelSpec ??
      config.piAi?.smallModelSpec

    if (modelSpec) {
      runtime.setSetting('MODEL_PROVIDER', modelSpec)
    }

    if (config.piAi?.agentDir) {
      runtime.setSetting('PI_CODING_AGENT_DIR', config.piAi.agentDir)
    }

    if (config.piAi?.modelSpec) {
      runtime.setSetting('PI_AI_MODEL_SPEC', config.piAi.modelSpec)
    }

    if (config.piAi?.smallModelSpec) {
      runtime.setSetting('PI_AI_SMALL_MODEL_SPEC', config.piAi.smallModelSpec)
    }

    if (config.piAi?.largeModelSpec) {
      runtime.setSetting('PI_AI_LARGE_MODEL_SPEC', config.piAi.largeModelSpec)
    }

    if (config.piAi?.priority) {
      runtime.setSetting('PI_AI_PRIORITY', config.piAi.priority)
    }

    if (config.openai?.embedding) {
      const embeddingRuntimeSettings = await resolveEmbeddingRuntimeSettings({
        config,
        embeddingsService
      })
      applyOpenAiEmbeddingRuntimeSettings(runtime, embeddingRuntimeSettings)
      return embeddingRuntimeSettings?.warning ? [embeddingRuntimeSettings.warning] : []
    }

    await embeddingsService.stop()
    return config.openai?.embedding
      ? []
      : [
          'Pi AI does not provide TEXT_EMBEDDING. Configure BONZI_EMBEDDINGS_UPSTREAM_URL and BONZI_EMBEDDINGS_UPSTREAM_MODEL, or BONZI_OPENAI_EMBEDDING_* settings, to enable knowledge embeddings.'
        ]
  }

  if (config.effectiveProvider === 'openai-compatible' && config.openai) {
    runtime.setSetting('OPENAI_API_KEY', config.openai.apiKey, true)
    runtime.setSetting('OPENAI_BASE_URL', config.openai.baseUrl)
    runtime.setSetting('OPENAI_SMALL_MODEL', config.openai.model)
    runtime.setSetting('OPENAI_LARGE_MODEL', config.openai.model)

    const embeddingRuntimeSettings = await resolveEmbeddingRuntimeSettings({
      config,
      embeddingsService
    })

    applyOpenAiEmbeddingRuntimeSettings(runtime, embeddingRuntimeSettings)

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
    pluginSettings: {
      contextEnabled: runtimeSettings.contextEnabled,
      desktopActionsEnabled: runtimeSettings.desktopActionsEnabled,
      approvalsEnabled: runtimeSettings.approvalsEnabled,
      character: {
        enabled: runtimeSettings.character.enabled,
        characterJson: runtimeSettings.character.enabled
          ? runtimeSettings.character.characterJson
          : '{}'
      }
    },
    externalRuntimePlugins: runtimePluginSelection.map((plugin) => ({
      id: plugin.id,
      packageName: plugin.packageName ?? '',
      versionRange: plugin.versionRange ?? '',
      exportName: plugin.exportName ?? '',
      executionPolicy: plugin.executionPolicy,
      lifecycleStatus: plugin.lifecycleStatus,
      source: plugin.source
    })),
    piAi: config.piAi
      ? {
          agentDir: config.piAi.agentDir ?? '',
          modelSpec: config.piAi.modelSpec ?? '',
          smallModelSpec: config.piAi.smallModelSpec ?? '',
          largeModelSpec: config.piAi.largeModelSpec ?? '',
          priority: config.piAi.priority ?? ''
        }
      : null,
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


function applyOpenAiEmbeddingRuntimeSettings(
  runtime: AgentRuntime,
  embeddingRuntimeSettings: ResolvedEmbeddingRuntimeSettings | null
): void {
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
}

async function buildProviderPlugins(
  config: BonziElizaResolvedConfig
): Promise<Plugin[]> {
  if (config.effectiveProvider === 'openai-compatible') {
    return [(await import('@elizaos/plugin-openai')).default]
  }

  if (config.effectiveProvider === 'pi-ai') {
    const openAiPlugin = (await import('@elizaos/plugin-openai')).default
    const piAiPlugin = (await import('@elizaos/plugin-pi-ai')).default as unknown as Plugin

    // Keep Eliza Classic + OpenAI available for model types not handled by
    // plugin-pi (notably TEXT_EMBEDDING/tokenizers). plugin-pi's high-priority
    // handlers still win for text/object/image generation.
    return [elizaClassicPlugin, openAiPlugin, createPiAiRuntimePlugin(piAiPlugin, config)]
  }

  return [elizaClassicPlugin]
}

function createPiAiRuntimePlugin(
  plugin: Plugin,
  config: BonziElizaResolvedConfig
): Plugin {
  return {
    ...plugin,
    config: buildPiAiPluginConfig(config)
  } as Plugin
}

function buildPiAiPluginConfig(
  config: BonziElizaResolvedConfig
): Record<string, string> {
  const pluginConfig: Record<string, string> = {}

  if (config.piAi?.agentDir) {
    pluginConfig.PI_CODING_AGENT_DIR = config.piAi.agentDir
  }

  if (config.piAi?.modelSpec) {
    pluginConfig.PI_AI_MODEL_SPEC = config.piAi.modelSpec
  }

  if (config.piAi?.smallModelSpec) {
    pluginConfig.PI_AI_SMALL_MODEL_SPEC = config.piAi.smallModelSpec
  }

  if (config.piAi?.largeModelSpec) {
    pluginConfig.PI_AI_LARGE_MODEL_SPEC = config.piAi.largeModelSpec
  }

  if (config.piAi?.priority) {
    pluginConfig.PI_AI_PRIORITY = config.piAi.priority
  }

  return pluginConfig
}

async function resolveEmbeddingRuntimeSettings(options: {
  config: BonziElizaResolvedConfig
  embeddingsService: BonziExternalEmbeddingsService
}): Promise<ResolvedEmbeddingRuntimeSettings | null> {
  const { config, embeddingsService } = options

  if (!config.openai) {
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
