import type { Dirent } from 'node:fs'
import { lstat, readdir } from 'node:fs/promises'
import { basename, relative, resolve } from 'node:path'
import type { KnowledgeImportFolderSelection } from '../../shared/contracts'

export const MAX_KNOWLEDGE_FOLDER_MARKDOWN_FILES = 10_000

const MAX_SCAN_ERRORS = 50
const SCAN_EVENT_LOOP_YIELD_INTERVAL = 250

const EXCLUDED_DIRECTORY_NAMES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  'coverage'
])

export interface KnowledgeFolderDocumentCandidate {
  absolutePath: string
  rootPath: string
  rootName: string
  relativePath: string
  name: string
  bytes: number
  lastModified?: number
}

export interface KnowledgeFolderScanResult {
  roots: KnowledgeImportFolderSelection[]
  documents: KnowledgeFolderDocumentCandidate[]
  errors: string[]
  errorCount: number
  capped: boolean
  markdownFileCount: number
}

export async function scanKnowledgeImportFolders(
  folderPaths: readonly string[],
  options: { signal?: AbortSignal } = {}
): Promise<KnowledgeFolderScanResult> {
  const roots: KnowledgeImportFolderSelection[] = []
  const documents: KnowledgeFolderDocumentCandidate[] = []
  const errors: string[] = []
  let capped = false
  let markdownFileCount = 0
  let errorCount = 0

  const recordError = (message: string): void => {
    errorCount += 1
    errors.push(message)
    if (errors.length > MAX_SCAN_ERRORS) {
      errors.shift()
    }
  }

  for (const rawPath of folderPaths) {
    throwIfAborted(options.signal)

    if (typeof rawPath !== 'string' || !rawPath.trim()) {
      recordError('Selected folder path must be a non-empty string.')
      continue
    }

    const rootPath = resolve(rawPath)
    const rootName = basename(rootPath) || rootPath

    try {
      const rootStat = await lstat(rootPath)

      if (rootStat.isSymbolicLink()) {
        recordError(`${rootName}: selected folder is a symlink and was skipped.`)
        continue
      }

      if (!rootStat.isDirectory()) {
        recordError(`${rootName}: selected path is not a folder.`)
        continue
      }
    } catch (error) {
      recordError(`${rootName}: ${normalizeScanError(error)}`)
      continue
    }

    roots.push({ path: rootPath, name: rootName })
    const stack = [rootPath]

    while (stack.length > 0) {
      throwIfAborted(options.signal)

      if (capped) {
        break
      }

      const currentDir = stack.pop()

      if (!currentDir) {
        continue
      }

      let entries: Dirent<string>[]

      try {
        entries = await readdir(currentDir, { withFileTypes: true })
      } catch (error) {
        recordError(`${relative(rootPath, currentDir) || rootName}: ${normalizeScanError(error)}`)
        continue
      }

      const directories = entries
        .filter((entry) => entry.isDirectory() && !EXCLUDED_DIRECTORY_NAMES.has(entry.name))
        .sort((left, right) => left.name.localeCompare(right.name))
      const files = entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
        .sort((left, right) => left.name.localeCompare(right.name))

      for (const file of files) {
        throwIfAborted(options.signal)
        const absolutePath = resolve(currentDir, file.name)
        let fileStat: Awaited<ReturnType<typeof lstat>>

        try {
          fileStat = await lstat(absolutePath)
        } catch (error) {
          recordError(`${file.name}: ${normalizeScanError(error)}`)
          continue
        }

        if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
          continue
        }

        markdownFileCount += 1

        if (markdownFileCount % SCAN_EVENT_LOOP_YIELD_INTERVAL === 0) {
          await yieldToEventLoop()
        }

        if (markdownFileCount > MAX_KNOWLEDGE_FOLDER_MARKDOWN_FILES) {
          capped = true
          break
        }

        documents.push({
          absolutePath,
          rootPath,
          rootName,
          relativePath: normalizeRelativePath(relative(rootPath, absolutePath)),
          name: file.name,
          bytes: fileStat.size,
          lastModified: Number.isFinite(fileStat.mtimeMs) ? fileStat.mtimeMs : undefined
        })
      }

      for (const directory of directories.reverse()) {
        throwIfAborted(options.signal)

        // Dirent#isDirectory() is false for symlinks, so symlinked directories are
        // intentionally not traversed. This prevents loops without persisting or
        // comparing absolute realpaths.
        stack.push(resolve(currentDir, directory.name))
      }
    }

    if (capped) {
      break
    }
  }

  documents.sort((left, right) => {
    const rootCompare = left.rootName.localeCompare(right.rootName)
    return rootCompare === 0
      ? left.relativePath.localeCompare(right.relativePath)
      : rootCompare
  })

  return {
    roots,
    documents,
    errors,
    errorCount,
    capped,
    markdownFileCount
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException('Knowledge import was cancelled.', 'AbortError')
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function normalizeRelativePath(value: string): string {
  return value.split(/[\\/]+/u).filter(Boolean).join('/')
}

function normalizeScanError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
