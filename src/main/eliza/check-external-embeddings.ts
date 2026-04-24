import {
  probeExternalEmbeddingsUpstream,
  type BonziExternalEmbeddingsServiceConfig
} from './external-embeddings-service'
import {
  DEFAULT_ELIZA_EMBEDDING_DIMENSION,
  type ElizaCompatibleEmbeddingDimension
} from './embedding-dimensions'
import { loadBonziElizaConfig } from './config'

async function main(): Promise<void> {
  const config = loadBonziElizaConfig()

  if (config.effectiveProvider !== 'openai-compatible' || !config.openai) {
    throw new Error(
      'Bonzi external embeddings check requires BONZI_ASSISTANT_PROVIDER=openai-compatible.'
    )
  }

  if (config.openai.embedding?.mode !== 'local-service' || !config.openai.embedding.service) {
    throw new Error(
      'Bonzi external embeddings check requires BONZI_EMBEDDINGS_UPSTREAM_URL and BONZI_EMBEDDINGS_UPSTREAM_MODEL to be configured.'
    )
  }

  const expectedDimension =
    config.openai.embedding.dimensions ?? DEFAULT_ELIZA_EMBEDDING_DIMENSION
  const serviceConfig = config.openai.embedding.service
  const result = await probeExternalEmbeddingsUpstream(
    serviceConfig,
    expectedDimension as ElizaCompatibleEmbeddingDimension
  )

  printSuccess(serviceConfig, result)
}

function printSuccess(
  serviceConfig: BonziExternalEmbeddingsServiceConfig,
  result: {
    expectedDimension: ElizaCompatibleEmbeddingDimension
    upstreamDimension: number
    actualDimension: ElizaCompatibleEmbeddingDimension
    requestDimensionsToUpstream: boolean
    responseTransform: 'none' | 'matryoshka-truncate'
  }
): void {
  console.log('Bonzi external embeddings check passed.')
  console.log(`- upstream URL: ${serviceConfig.upstreamBaseUrl}`)
  console.log(`- upstream model: ${serviceConfig.upstreamModel}`)
  console.log(`- upstream dimension: ${result.upstreamDimension}`)
  console.log(`- expected dimension: ${result.expectedDimension}`)
  console.log(`- effective Bonzi dimension: ${result.actualDimension}`)
  console.log(
    `- dimensions forwarded upstream: ${result.requestDimensionsToUpstream ? 'yes' : 'no (fallback mode)'}`
  )
  console.log(`- response transform: ${result.responseTransform}`)
}

main().catch((error) => {
  console.error(
    error instanceof Error
      ? `Bonzi external embeddings check failed: ${error.message}`
      : `Bonzi external embeddings check failed: ${String(error)}`
  )
  process.exitCode = 1
})
