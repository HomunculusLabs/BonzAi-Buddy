import { createHash, randomBytes } from 'node:crypto'
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from 'node:http'
import {
  DEFAULT_ELIZA_EMBEDDING_DIMENSION,
  type ElizaCompatibleEmbeddingDimension
} from './embedding-dimensions'
import {
  listenOnLoopback,
  readJsonRequestBody,
  RequestBodyTooLargeError,
  writeJson,
  writeOpenAiStyleError
} from './external-embeddings-http'
import {
  probeExternalEmbeddingsUpstream,
  requestUpstreamEmbeddingsRaw,
  UpstreamEmbeddingsError,
  type BonziEmbeddingsUpstreamDimensionStrategy,
  type ExternalEmbeddingsProbeResult,
  type ExternalEmbeddingsUpstreamConfig
} from './external-embeddings-upstream'

export {
  probeExternalEmbeddingsUpstream,
  type BonziEmbeddingsUpstreamDimensionStrategy,
  type EmbeddingsResponseTransform,
  type ExternalEmbeddingsProbeResult
} from './external-embeddings-upstream'

export interface BonziExternalEmbeddingsServiceConfig
  extends ExternalEmbeddingsUpstreamConfig {
  bindHost: '127.0.0.1'
  port: number
}

export interface ResolvedEmbeddingRuntimeSettings {
  model?: string
  baseUrl?: string
  apiKey?: string
  dimensions: ElizaCompatibleEmbeddingDimension
  warning?: string
}

export class BonziExternalEmbeddingsService {
  private server: Server | null = null
  private configKey: string | null = null
  private runtimeSettings: ResolvedEmbeddingRuntimeSettings | null = null
  private requestDimensionsToUpstream = true
  private authToken: string | null = null
  private expectedDimension = DEFAULT_ELIZA_EMBEDDING_DIMENSION
  private config: BonziExternalEmbeddingsServiceConfig | null = null
  private readonly inFlight = new Set<AbortController>()

  async start(
    config: BonziExternalEmbeddingsServiceConfig,
    expectedDimension: ElizaCompatibleEmbeddingDimension
  ): Promise<ResolvedEmbeddingRuntimeSettings> {
    const configKey = JSON.stringify({
      upstreamBaseUrl: config.upstreamBaseUrl,
      upstreamModel: config.upstreamModel,
      upstreamApiKey: fingerprintSecret(config.upstreamApiKey),
      dimensionStrategy: config.dimensionStrategy,
      bindHost: config.bindHost,
      port: config.port,
      timeoutMs: config.timeoutMs,
      expectedDimension
    })

    if (
      this.server !== null &&
      this.runtimeSettings !== null &&
      this.configKey === configKey
    ) {
      return this.runtimeSettings
    }

    await this.stop()

    const probeResult: ExternalEmbeddingsProbeResult =
      await probeExternalEmbeddingsUpstream(config, expectedDimension)

    this.requestDimensionsToUpstream = probeResult.requestDimensionsToUpstream
    this.expectedDimension = probeResult.expectedDimension
    this.authToken = `bonzi-${randomBytes(24).toString('hex')}`
    this.config = config

    const server = createServer((request, response) => {
      void this.handleRequest(request, response)
    })

    await listenOnLoopback(server, config)

    const address = server.address()
    if (!address || typeof address === 'string') {
      server.close()
      throw new Error('External embeddings service failed to bind a loopback port.')
    }

    this.server = server
    this.configKey = configKey
    this.runtimeSettings = {
      model: config.upstreamModel,
      baseUrl: `http://${config.bindHost}:${address.port}/v1`,
      apiKey: this.authToken,
      dimensions: expectedDimension,
      warning:
        probeResult.responseTransform === 'matryoshka-truncate'
          ? `Embeddings upstream returned ${probeResult.upstreamDimension} dimensions; Bonzi is truncating to ${expectedDimension} via BONZI_EMBEDDINGS_UPSTREAM_DIMENSION_STRATEGY=matryoshka-truncate.`
          : undefined
    }

    return this.runtimeSettings
  }

  async stop(): Promise<void> {
    for (const controller of this.inFlight) {
      controller.abort()
    }
    this.inFlight.clear()

    const server = this.server

    this.server = null
    this.configKey = null
    this.runtimeSettings = null
    this.requestDimensionsToUpstream = true
    this.authToken = null
    this.expectedDimension = DEFAULT_ELIZA_EMBEDDING_DIMENSION
    this.config = null

    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }

          resolve()
        })
      })
    }
  }

  private async handleRequest(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    try {
      if (request.method === 'GET' && request.url === '/healthz') {
        writeJson(response, 200, {
          status: 'ok',
          dimensions: this.expectedDimension
        })
        return
      }

      if (request.method !== 'POST' || request.url !== '/v1/embeddings') {
        writeOpenAiStyleError(response, 404, 'Route not found.', 'not_found')
        return
      }

      if (!this.server || !this.config || !this.authToken || !this.runtimeSettings) {
        writeOpenAiStyleError(
          response,
          503,
          'External embeddings service is not ready.',
          'service_unavailable'
        )
        return
      }

      const authorization = request.headers.authorization
      if (authorization !== `Bearer ${this.authToken}`) {
        writeOpenAiStyleError(
          response,
          401,
          'Missing or invalid embeddings service token.',
          'invalid_api_key'
        )
        return
      }

      const contentType = request.headers['content-type'] ?? ''
      if (!contentType.toLowerCase().includes('application/json')) {
        writeOpenAiStyleError(
          response,
          415,
          'Embeddings requests must use application/json.',
          'unsupported_media_type'
        )
        return
      }

      const body = await readJsonRequestBody(request)
      if (!isRecord(body)) {
        writeOpenAiStyleError(
          response,
          400,
          'Embeddings payload must be a JSON object.',
          'invalid_request_error'
        )
        return
      }

      const upstreamPayload: Record<string, unknown> = {
        model: this.config.upstreamModel,
        input: body.input
      }

      if ('encoding_format' in body) {
        upstreamPayload.encoding_format = body.encoding_format
      }

      if ('user' in body) {
        upstreamPayload.user = body.user
      }

      if (this.requestDimensionsToUpstream) {
        upstreamPayload.dimensions = this.expectedDimension
      }

      const validated = await requestUpstreamEmbeddingsRaw(this.config, upstreamPayload, {
        expectedDimension: this.expectedDimension,
        inFlight: this.inFlight
      })

      writeJson(response, 200, validated.payload)
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        writeOpenAiStyleError(
          response,
          413,
          'Embeddings request body exceeded 1000000 bytes.',
          'payload_too_large'
        )
        return
      }

      if (error instanceof UpstreamEmbeddingsError) {
        writeOpenAiStyleError(response, 502, error.message, 'upstream_error')
        return
      }

      if (error instanceof SyntaxError) {
        writeOpenAiStyleError(
          response,
          400,
          'Embeddings request body must contain valid JSON.',
          'invalid_request_error'
        )
        return
      }

      if (error instanceof Error) {
        const status = error.name === 'AbortError' ? 504 : 502
        writeOpenAiStyleError(response, status, error.message, 'upstream_error')
        return
      }

      writeOpenAiStyleError(
        response,
        502,
        'Unknown embeddings proxy failure.',
        'upstream_error'
      )
    }
  }
}

function fingerprintSecret(value: string | undefined): string {
  if (!value) {
    return 'none'
  }

  return createHash('sha256').update(value).digest('hex')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
