import { createHash, randomBytes } from 'node:crypto'
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from 'node:http'
import {
  DEFAULT_ELIZA_EMBEDDING_DIMENSION,
  isElizaCompatibleEmbeddingDimension,
  type ElizaCompatibleEmbeddingDimension
} from './embedding-dimensions'

const DEFAULT_EMBEDDINGS_SERVICE_TIMEOUT_MS = 30_000
const MAX_REQUEST_BODY_BYTES = 1_000_000

export type BonziEmbeddingsUpstreamDimensionStrategy =
  | 'strict'
  | 'matryoshka-truncate'

type EmbeddingsResponseTransform = 'none' | 'matryoshka-truncate'

export interface BonziExternalEmbeddingsServiceConfig {
  upstreamBaseUrl: string
  upstreamModel: string
  upstreamApiKey?: string
  dimensionStrategy: BonziEmbeddingsUpstreamDimensionStrategy
  bindHost: '127.0.0.1'
  port: number
  timeoutMs: number
}

export interface ResolvedEmbeddingRuntimeSettings {
  model?: string
  baseUrl?: string
  apiKey?: string
  dimensions: ElizaCompatibleEmbeddingDimension
  warning?: string
}

export interface ExternalEmbeddingsProbeResult {
  expectedDimension: ElizaCompatibleEmbeddingDimension
  upstreamDimension: number
  actualDimension: ElizaCompatibleEmbeddingDimension
  requestDimensionsToUpstream: boolean
  responseTransform: EmbeddingsResponseTransform
}

interface RequestUpstreamEmbeddingsOptions {
  includeDimensions?: boolean
  inFlight?: Set<AbortController>
}

interface ValidatedEmbeddingsResponse {
  payload: Record<string, unknown>
  upstreamDimension: number
  actualDimension: ElizaCompatibleEmbeddingDimension
  responseTransform: EmbeddingsResponseTransform
}

class UpstreamEmbeddingsError extends Error {
  readonly status: number
  readonly responseBody: string

  constructor(status: number, responseBody: string) {
    super(`Upstream embeddings request failed: ${status} ${responseBody}`)
    this.name = 'UpstreamEmbeddingsError'
    this.status = status
    this.responseBody = responseBody
  }
}

export async function probeExternalEmbeddingsUpstream(
  config: BonziExternalEmbeddingsServiceConfig,
  expectedDimension: ElizaCompatibleEmbeddingDimension
): Promise<ExternalEmbeddingsProbeResult> {
  try {
    const withDimensions = await requestUpstreamEmbeddings(config, expectedDimension, {
      includeDimensions: true
    })

    return {
      expectedDimension,
      upstreamDimension: withDimensions.upstreamDimension,
      actualDimension: withDimensions.actualDimension,
      requestDimensionsToUpstream: true,
      responseTransform: withDimensions.responseTransform
    }
  } catch (error) {
    if (!(error instanceof UpstreamEmbeddingsError)) {
      throw error
    }

    if (!shouldRetryWithoutDimensions(error)) {
      throw error
    }

    const withoutDimensions = await requestUpstreamEmbeddings(config, expectedDimension, {
      includeDimensions: false
    })

    return {
      expectedDimension,
      upstreamDimension: withoutDimensions.upstreamDimension,
      actualDimension: withoutDimensions.actualDimension,
      requestDimensionsToUpstream: false,
      responseTransform: withoutDimensions.responseTransform
    }
  }
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

    const probeResult = await probeExternalEmbeddingsUpstream(
      config,
      expectedDimension
    )

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

class RequestBodyTooLargeError extends Error {
  constructor(limit: number) {
    super(`Request body exceeded ${limit} bytes.`)
    this.name = 'RequestBodyTooLargeError'
  }
}

async function requestUpstreamEmbeddings(
  config: BonziExternalEmbeddingsServiceConfig,
  expectedDimension: ElizaCompatibleEmbeddingDimension,
  options: RequestUpstreamEmbeddingsOptions = {}
): Promise<ValidatedEmbeddingsResponse> {
  const payload: Record<string, unknown> = {
    model: config.upstreamModel,
    input: 'Bonzi embeddings startup probe'
  }

  if (options.includeDimensions !== false) {
    payload.dimensions = expectedDimension
  }

  return requestUpstreamEmbeddingsRaw(config, payload, {
    ...options,
    expectedDimension
  })
}

async function requestUpstreamEmbeddingsRaw(
  config: BonziExternalEmbeddingsServiceConfig,
  payload: Record<string, unknown>,
  options: RequestUpstreamEmbeddingsOptions & {
    expectedDimension: ElizaCompatibleEmbeddingDimension
  }
): Promise<ValidatedEmbeddingsResponse> {
  const controller = new AbortController()
  options.inFlight?.add(controller)
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs)

  try {
    const response = await fetch(`${trimTrailingSlash(config.upstreamBaseUrl)}/embeddings`, {
      method: 'POST',
      headers: buildUpstreamHeaders(config.upstreamApiKey),
      body: JSON.stringify(payload),
      signal: controller.signal
    })

    if (!response.ok) {
      const responseBody = await response.text().catch(() => 'Unknown upstream error')
      throw new UpstreamEmbeddingsError(response.status, responseBody)
    }

    const json = (await response.json()) as unknown
    return validateEmbeddingsResponse(json, {
      expectedDimension: options.expectedDimension,
      dimensionStrategy: config.dimensionStrategy
    })
  } finally {
    clearTimeout(timeout)
    options.inFlight?.delete(controller)
  }
}

function buildUpstreamHeaders(
  apiKey: string | undefined
): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
  }
}

function shouldRetryWithoutDimensions(error: UpstreamEmbeddingsError): boolean {
  if (error.status !== 400 && error.status !== 422) {
    return false
  }

  const normalizedBody = error.responseBody.toLowerCase()
  return (
    normalizedBody.includes('dimensions') ||
    normalizedBody.includes('dimension')
  )
}

function validateEmbeddingsResponse(
  payload: unknown,
  options: {
    expectedDimension: ElizaCompatibleEmbeddingDimension
    dimensionStrategy: BonziEmbeddingsUpstreamDimensionStrategy
  }
): ValidatedEmbeddingsResponse {
  if (!isRecord(payload)) {
    throw new Error('External embeddings upstream returned a non-object payload.')
  }

  const data = payload.data
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('External embeddings upstream returned no embeddings.')
  }

  let actualDimension: number | null = null

  for (const item of data) {
    if (!isRecord(item) || !Array.isArray(item.embedding)) {
      throw new Error('External embeddings upstream returned malformed embedding data.')
    }

    const embedding = item.embedding
    if (embedding.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
      throw new Error('External embeddings upstream returned non-numeric embeddings.')
    }

    if (actualDimension === null) {
      actualDimension = embedding.length
      continue
    }

    if (embedding.length !== actualDimension) {
      throw new Error('External embeddings upstream returned inconsistent vector lengths.')
    }
  }

  if (actualDimension === null) {
    throw new Error('External embeddings upstream returned no usable embeddings.')
  }

  if (actualDimension === options.expectedDimension) {
    return {
      payload,
      upstreamDimension: actualDimension,
      actualDimension: options.expectedDimension,
      responseTransform: 'none'
    }
  }

  if (
    options.dimensionStrategy === 'matryoshka-truncate' &&
    actualDimension > options.expectedDimension
  ) {
    return {
      payload: truncateEmbeddingsPayload(payload, options.expectedDimension),
      upstreamDimension: actualDimension,
      actualDimension: options.expectedDimension,
      responseTransform: 'matryoshka-truncate'
    }
  }

  if (!isElizaCompatibleEmbeddingDimension(actualDimension)) {
    throw new Error(
      `External embeddings startup failed: upstream returned unsupported dimension ${actualDimension}. Supported dimensions are 384, 512, 768, 1024, 1536, 3072.`
    )
  }

  const truncationHint =
    options.dimensionStrategy === 'matryoshka-truncate'
      ? ' Matryoshka truncation only applies when the upstream returns more dimensions than requested.'
      : ''

  throw new Error(
    `External embeddings startup failed: upstream returned ${actualDimension} dimensions, expected ${options.expectedDimension}.${truncationHint}`
  )
}

function truncateEmbeddingsPayload(
  payload: Record<string, unknown>,
  expectedDimension: ElizaCompatibleEmbeddingDimension
): Record<string, unknown> {
  const data = Array.isArray(payload.data) ? payload.data : []

  return {
    ...payload,
    data: data.map((item) => {
      if (!isRecord(item) || !Array.isArray(item.embedding)) {
        return item
      }

      return {
        ...item,
        embedding: item.embedding.slice(0, expectedDimension)
      }
    })
  }
}

async function readJsonRequestBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length

    if (total > MAX_REQUEST_BODY_BYTES) {
      throw new RequestBodyTooLargeError(MAX_REQUEST_BODY_BYTES)
    }

    chunks.push(buffer)
  }

  const text = Buffer.concat(chunks).toString('utf8')
  return JSON.parse(text)
}

function writeJson(
  response: ServerResponse,
  status: number,
  payload: Record<string, unknown>
): void {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(payload))
}

function writeOpenAiStyleError(
  response: ServerResponse,
  status: number,
  message: string,
  code: string
): void {
  writeJson(response, status, {
    error: {
      message,
      type: 'invalid_request_error',
      code
    }
  })
}

async function listenOnLoopback(
  server: Server,
  config: BonziExternalEmbeddingsServiceConfig
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening)
      reject(
        new Error(
          `External embeddings service failed to bind ${config.bindHost}:${config.port}: ${error.message}`
        )
      )
    }

    const onListening = (): void => {
      server.off('error', onError)
      resolve()
    }

    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(config.port, config.bindHost)
  })
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, '')
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
