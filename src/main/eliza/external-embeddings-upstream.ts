import {
  isElizaCompatibleEmbeddingDimension,
  type ElizaCompatibleEmbeddingDimension
} from './embedding-dimensions'
import { isRecord } from '../../shared/value-utils'

export type BonziEmbeddingsUpstreamDimensionStrategy =
  | 'strict'
  | 'matryoshka-truncate'

export type EmbeddingsResponseTransform = 'none' | 'matryoshka-truncate'

export interface ExternalEmbeddingsUpstreamConfig {
  upstreamBaseUrl: string
  upstreamModel: string
  upstreamApiKey?: string
  dimensionStrategy: BonziEmbeddingsUpstreamDimensionStrategy
  timeoutMs: number
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

export class UpstreamEmbeddingsError extends Error {
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
  config: ExternalEmbeddingsUpstreamConfig,
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

async function requestUpstreamEmbeddings(
  config: ExternalEmbeddingsUpstreamConfig,
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

export async function requestUpstreamEmbeddingsRaw(
  config: ExternalEmbeddingsUpstreamConfig,
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

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, '')
}

