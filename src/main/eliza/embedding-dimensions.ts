export const ELIZA_COMPATIBLE_EMBEDDING_DIMENSIONS = [
  384,
  512,
  768,
  1024,
  1536,
  3072
] as const

export type ElizaCompatibleEmbeddingDimension =
  (typeof ELIZA_COMPATIBLE_EMBEDDING_DIMENSIONS)[number]

export const DEFAULT_ELIZA_EMBEDDING_DIMENSION: ElizaCompatibleEmbeddingDimension =
  1536

const EMBEDDING_DIMENSION_LIST =
  ELIZA_COMPATIBLE_EMBEDDING_DIMENSIONS.join(', ')

export function isElizaCompatibleEmbeddingDimension(
  value: number
): value is ElizaCompatibleEmbeddingDimension {
  return (ELIZA_COMPATIBLE_EMBEDDING_DIMENSIONS as readonly number[]).includes(value)
}

export function parseElizaCompatibleEmbeddingDimension(
  raw: string | undefined,
  envKey = 'BONZI_OPENAI_EMBEDDING_DIMENSIONS'
): {
  dimensions?: ElizaCompatibleEmbeddingDimension
  warning?: string
} {
  const trimmed = raw?.trim()

  if (!trimmed) {
    return {}
  }

  const parsed = Number(trimmed)

  if (Number.isInteger(parsed) && isElizaCompatibleEmbeddingDimension(parsed)) {
    return { dimensions: parsed }
  }

  return {
    warning: `${envKey} must be one of ${EMBEDDING_DIMENSION_LIST}. Ignoring invalid embedding dimensions override.`
  }
}
