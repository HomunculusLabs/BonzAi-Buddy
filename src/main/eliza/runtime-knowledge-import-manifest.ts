import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { KnowledgeFolderDocumentCandidate } from './runtime-knowledge-folder-scan'
import type { PreparedKnowledgeDocument } from './runtime-knowledge-import'

const KNOWLEDGE_IMPORT_MANIFEST_VERSION = 1
const MANIFEST_FLUSH_FILE_INTERVAL = 100
const MANIFEST_FLUSH_MS = 2_000

interface PersistedKnowledgeImportManifestEntry {
  bytes: number
  lastModified?: number
  documentHash: string
  chunkCount: number
  importedAt: string
}

interface PersistedKnowledgeImportManifestFile {
  version: number
  files: Record<string, PersistedKnowledgeImportManifestEntry>
}

interface KnowledgeImportManifestEntry {
  key: string
  value: PersistedKnowledgeImportManifestEntry
}

export class KnowledgeImportManifestStore {
  private readonly manifestPath: string
  private readonly files: Map<string, PersistedKnowledgeImportManifestEntry>
  private dirtyFileCount = 0
  private lastFlushAt = Date.now()

  private constructor(
    manifestPath: string,
    files: Map<string, PersistedKnowledgeImportManifestEntry>
  ) {
    this.manifestPath = manifestPath
    this.files = files
  }

  static async create(manifestPath: string): Promise<KnowledgeImportManifestStore> {
    const files = new Map<string, PersistedKnowledgeImportManifestEntry>()

    try {
      const raw = await readFile(manifestPath, 'utf8')
      const parsed = JSON.parse(raw) as PersistedKnowledgeImportManifestFile

      if (parsed.version !== KNOWLEDGE_IMPORT_MANIFEST_VERSION || !parsed.files) {
        return new KnowledgeImportManifestStore(manifestPath, files)
      }

      for (const [key, value] of Object.entries(parsed.files)) {
        if (!isManifestEntry(value)) {
          continue
        }
        files.set(key, value)
      }
    } catch {
      // Missing/corrupt manifest should not block imports.
    }

    return new KnowledgeImportManifestStore(manifestPath, files)
  }

  shouldSkipUnchangedFile(candidate: KnowledgeFolderDocumentCandidate): boolean {
    const entry = this.files.get(createManifestKey(candidate.rootPath, candidate.relativePath))

    if (!entry) {
      return false
    }

    return (
      entry.chunkCount > 0 &&
      entry.bytes === candidate.bytes &&
      normalizeLastModified(entry.lastModified) === normalizeLastModified(candidate.lastModified)
    )
  }

  async markImportedFile(
    candidate: KnowledgeFolderDocumentCandidate,
    document: PreparedKnowledgeDocument,
    importedAt: string
  ): Promise<void> {
    const entry: KnowledgeImportManifestEntry = {
      key: createManifestKey(candidate.rootPath, candidate.relativePath),
      value: {
        bytes: document.bytes,
        lastModified: normalizeLastModified(document.lastModified),
        documentHash: document.documentHash,
        chunkCount: document.chunks.length,
        importedAt
      }
    }
    this.files.set(entry.key, entry.value)
    this.dirtyFileCount += 1

    if (this.shouldFlush()) {
      await this.flush()
    }
  }

  async flush(): Promise<void> {
    if (this.dirtyFileCount === 0) {
      return
    }

    await this.persist()
    this.dirtyFileCount = 0
    this.lastFlushAt = Date.now()
  }

  private shouldFlush(): boolean {
    return (
      this.dirtyFileCount >= MANIFEST_FLUSH_FILE_INTERVAL ||
      Date.now() - this.lastFlushAt >= MANIFEST_FLUSH_MS
    )
  }

  private async persist(): Promise<void> {
    const payload: PersistedKnowledgeImportManifestFile = {
      version: KNOWLEDGE_IMPORT_MANIFEST_VERSION,
      files: Object.fromEntries(this.files.entries())
    }

    await mkdir(dirname(this.manifestPath), { recursive: true })
    await writeFile(this.manifestPath, JSON.stringify(payload, null, 2), 'utf8')
  }
}

function createManifestKey(rootPath: string, relativePath: string): string {
  const rootPathHash = createHash('sha256')
    .update(resolve(rootPath))
    .digest('hex')
    .slice(0, 16)
  return `${rootPathHash}:${normalizeRelativePath(relativePath)}`
}

function normalizeRelativePath(value: string): string {
  return value.split(/[\\/]+/u).filter(Boolean).join('/')
}

function normalizeLastModified(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function isManifestEntry(value: unknown): value is PersistedKnowledgeImportManifestEntry {
  if (!value || typeof value !== 'object') {
    return false
  }

  const entry = value as PersistedKnowledgeImportManifestEntry
  return (
    typeof entry.bytes === 'number' &&
    Number.isFinite(entry.bytes) &&
    typeof entry.documentHash === 'string' &&
    entry.documentHash.length > 0 &&
    typeof entry.chunkCount === 'number' &&
    Number.isFinite(entry.chunkCount) &&
    entry.chunkCount >= 0 &&
    typeof entry.importedAt === 'string' &&
    entry.importedAt.length > 0 &&
    (entry.lastModified === undefined ||
      (typeof entry.lastModified === 'number' && Number.isFinite(entry.lastModified)))
  )
}
