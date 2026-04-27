import { createHash } from 'node:crypto'
import type {
  ImportKnowledgeDocumentsRequest,
  KnowledgeImportDocumentResult
} from '../../shared/contracts'
import { isRecord } from '../../shared/value-utils'

const MAX_DOCUMENTS_PER_IMPORT = 20
const MAX_SINGLE_DOCUMENT_BYTES = 1024 * 1024
const MAX_TOTAL_IMPORT_BYTES = 5 * 1024 * 1024
const MAX_CHUNKS_PER_IMPORT = 500
const TARGET_CHUNK_CHARS = 3500
const CHUNK_OVERLAP_CHARS = 250
const MAX_DOCUMENT_NAME_CHARS = 180

export interface PreparedKnowledgeDocument {
  name: string
  bytes: number
  lastModified?: number
  documentHash: string
  chunks: KnowledgeImportChunk[]
}

export interface KnowledgeImportChunk {
  documentName: string
  documentHash: string
  chunkIndex: number
  chunkCount: number
  text: string
}

export interface PreparedKnowledgeImport {
  documents: PreparedKnowledgeDocument[]
  rejectedDocuments: KnowledgeImportDocumentResult[]
}

export function prepareKnowledgeImportRequest(
  request: ImportKnowledgeDocumentsRequest
): PreparedKnowledgeImport {
  if (!isRecord(request) || !Array.isArray(request.documents)) {
    throw new Error('Knowledge import request must include a documents array.')
  }

  if (request.documents.length === 0) {
    throw new Error('Select at least one Markdown file to import.')
  }

  if (request.documents.length > MAX_DOCUMENTS_PER_IMPORT) {
    throw new Error(
      `Knowledge import supports at most ${MAX_DOCUMENTS_PER_IMPORT} Markdown files at a time.`
    )
  }

  const documents: PreparedKnowledgeDocument[] = []
  const rejectedDocuments: KnowledgeImportDocumentResult[] = []
  let totalBytes = 0
  let totalChunks = 0

  for (const [index, document] of request.documents.entries()) {
    if (!isRecord(document)) {
      rejectedDocuments.push({
        name: `Document ${index + 1}`,
        status: 'failed',
        bytes: 0,
        chunksImported: 0,
        error: 'Document payload must be an object.'
      })
      continue
    }

    const rawName = typeof document.name === 'string' ? document.name : ''
    const sanitizedName = sanitizeDocumentName(rawName || `Document ${index + 1}.md`)
    const name = truncateDocumentName(sanitizedName)
    const content = typeof document.content === 'string' ? document.content : null
    const lastModified = normalizeLastModified(document.lastModified)

    if (content === null) {
      rejectedDocuments.push({
        name,
        status: 'failed',
        bytes: 0,
        chunksImported: 0,
        error: 'Markdown document content must be text.'
      })
      continue
    }

    const rawBytes = byteLength(content)
    totalBytes += rawBytes

    if (rawBytes > MAX_SINGLE_DOCUMENT_BYTES) {
      rejectedDocuments.push({
        name,
        status: 'failed',
        bytes: rawBytes,
        chunksImported: 0,
        error: 'Markdown file must be 1 MiB or smaller.'
      })
      continue
    }

    if (!sanitizedName.toLowerCase().endsWith('.md')) {
      rejectedDocuments.push({
        name,
        status: 'failed',
        bytes: rawBytes,
        chunksImported: 0,
        error: 'Only .md Markdown files can be imported.'
      })
      continue
    }

    const normalizedContent = normalizeLineEndings(content).trim()
    const bytes = rawBytes

    if (!normalizedContent) {
      rejectedDocuments.push({
        name,
        status: 'skipped',
        bytes,
        chunksImported: 0,
        error: 'Markdown file was empty.'
      })
      continue
    }

    const documentHash = createHash('sha256')
      .update(name)
      .update('\0')
      .update(normalizedContent)
      .digest('hex')
    const chunkTexts = chunkMarkdown(normalizedContent).map(
      (chunk) => `Source: ${name}\n\n${chunk}`
    )
    totalChunks += chunkTexts.length

    documents.push({
      name,
      bytes,
      lastModified,
      documentHash,
      chunks: chunkTexts.map((text, chunkIndex) => ({
        documentName: name,
        documentHash,
        chunkIndex,
        chunkCount: chunkTexts.length,
        text
      }))
    })
  }

  if (totalBytes > MAX_TOTAL_IMPORT_BYTES) {
    throw new Error('Knowledge import payload must be 5 MiB or smaller in total.')
  }

  if (totalChunks > MAX_CHUNKS_PER_IMPORT) {
    throw new Error(
      `Knowledge import generated too many chunks. Import fewer or smaller files (max ${MAX_CHUNKS_PER_IMPORT} chunks).`
    )
  }

  return { documents, rejectedDocuments }
}

function sanitizeDocumentName(name: string): string {
  const sanitized = name
    .trim()
    .replace(/[\\/]+/gu, '_')
    .replace(/[\u0000-\u001f\u007f]+/gu, '')

  return sanitized || 'knowledge.md'
}

function truncateDocumentName(name: string): string {
  if (name.length <= MAX_DOCUMENT_NAME_CHARS) {
    return name
  }

  const suffix = name.toLowerCase().endsWith('.md') ? name.slice(-3) : ''
  return `${name.slice(0, MAX_DOCUMENT_NAME_CHARS - suffix.length)}${suffix}`
}

function normalizeLastModified(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/gu, '\n')
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

function chunkMarkdown(markdown: string): string[] {
  const sections = splitMarkdownSections(markdown)
  const chunks: string[] = []

  for (const section of sections) {
    chunks.push(...splitOversizedSection(section))
  }

  return chunks.length > 0 ? chunks : [markdown]
}

function splitMarkdownSections(markdown: string): string[] {
  const lines = markdown.split('\n')
  const sections: string[] = []
  let current: string[] = []

  for (const line of lines) {
    if (/^#{1,6}\s+/u.test(line) && current.length > 0) {
      sections.push(current.join('\n').trim())
      current = []
    }

    current.push(line)
  }

  if (current.length > 0) {
    sections.push(current.join('\n').trim())
  }

  return sections.filter((section) => section.length > 0)
}

function splitOversizedSection(section: string): string[] {
  if (section.length <= TARGET_CHUNK_CHARS) {
    return [section]
  }

  const chunks: string[] = []
  let start = 0

  while (start < section.length) {
    const maxEnd = Math.min(start + TARGET_CHUNK_CHARS, section.length)
    let end = maxEnd

    if (maxEnd < section.length) {
      const paragraphBoundary = section.lastIndexOf('\n\n', maxEnd)
      if (paragraphBoundary > start + TARGET_CHUNK_CHARS / 2) {
        end = paragraphBoundary
      } else {
        const newlineBoundary = section.lastIndexOf('\n', maxEnd)
        if (newlineBoundary > start + TARGET_CHUNK_CHARS / 2) {
          end = newlineBoundary
        }
      }
    }

    const chunk = section.slice(start, end).trim()
    if (chunk) {
      chunks.push(chunk)
    }

    if (end >= section.length) {
      break
    }

    start = Math.max(end - CHUNK_OVERLAP_CHARS, start + 1)
  }

  return chunks
}
