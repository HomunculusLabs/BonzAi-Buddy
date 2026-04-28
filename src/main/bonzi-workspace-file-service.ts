import {
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from 'node:fs'
import { lstat, mkdir, open, readdir } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import type { BonziWorkspaceSettings } from '../shared/contracts'
import { isRecord, normalizeOptionalString } from '../shared/value-utils'

const DEFAULT_WORKSPACE_DIR_NAME = 'bonzi-writable-workspace'
const WORKSPACE_SETTINGS_FILE_NAME = 'bonzi-workspace-settings.json'
const MAX_WORKSPACE_FILE_BYTES = 1024 * 1024
const MAX_WORKSPACE_FILE_CONTENT_CHARS = 1_000_000
const MAX_LIST_ENTRIES = 200

export interface BonziWorkspaceFileServiceOptions {
  env?: NodeJS.ProcessEnv
  explicitWorkspaceDir?: string
  userDataDir: string
}

export interface WorkspaceFileWriteRequest {
  filePath: string
  content: string
}

export interface WorkspaceFileReadRequest {
  filePath: string
}

export interface WorkspaceFileListRequest {
  directoryPath?: string
}

export class BonziWorkspaceFileService {
  private readonly env: NodeJS.ProcessEnv
  private readonly defaultWorkspaceDir: string
  private readonly settingsPath: string
  private workspaceDir: string

  constructor(options: BonziWorkspaceFileServiceOptions) {
    this.env = options.env ?? process.env
    this.defaultWorkspaceDir = resolve(options.userDataDir, DEFAULT_WORKSPACE_DIR_NAME)
    this.settingsPath = join(options.userDataDir, WORKSPACE_SETTINGS_FILE_NAME)
    this.workspaceDir = this.resolveConfiguredWorkspaceDir(options.explicitWorkspaceDir)
  }

  getWorkspaceDir(): string {
    return this.workspaceDir
  }

  getSettings(): BonziWorkspaceSettings {
    const envWorkspaceDir = normalizeConfiguredWorkspaceDir(
      this.env.BONZI_WRITABLE_WORKSPACE_DIR
    )
    const persistedWorkspaceDir = this.readPersistedWorkspaceDir()

    return {
      workspaceDir: this.workspaceDir,
      defaultWorkspaceDir: this.defaultWorkspaceDir,
      source: envWorkspaceDir ? 'env' : persistedWorkspaceDir ? 'settings' : 'default',
      envLocked: Boolean(envWorkspaceDir)
    }
  }

  async setWorkspaceDir(workspaceDir: string): Promise<BonziWorkspaceSettings> {
    if (normalizeConfiguredWorkspaceDir(this.env.BONZI_WRITABLE_WORKSPACE_DIR)) {
      throw new Error('BONZI_WRITABLE_WORKSPACE_DIR is set, so the workspace folder cannot be changed from Settings.')
    }

    const nextWorkspaceDir = normalizeConfiguredWorkspaceDir(workspaceDir)

    if (!nextWorkspaceDir) {
      throw new Error('Choose an absolute workspace folder path.')
    }

    await ensureWorkspaceRoot(nextWorkspaceDir)
    writeJsonFile(this.settingsPath, {
      schemaVersion: 1,
      workspaceDir: nextWorkspaceDir
    })
    this.workspaceDir = nextWorkspaceDir

    return this.getSettings()
  }

  async resetWorkspaceDir(): Promise<BonziWorkspaceSettings> {
    if (normalizeConfiguredWorkspaceDir(this.env.BONZI_WRITABLE_WORKSPACE_DIR)) {
      throw new Error('BONZI_WRITABLE_WORKSPACE_DIR is set, so the workspace folder cannot be reset from Settings.')
    }

    writeJsonFile(this.settingsPath, {
      schemaVersion: 1,
      workspaceDir: null
    })
    this.workspaceDir = this.defaultWorkspaceDir
    await ensureWorkspaceRoot(this.workspaceDir)

    return this.getSettings()
  }

  async writeTextFile(request: WorkspaceFileWriteRequest): Promise<string> {
    const target = this.resolveWorkspacePath(request.filePath, { allowRoot: false })
    const content = normalizeWorkspaceFileContent(request.content)
    const bytes = Buffer.byteLength(content, 'utf8')

    if (bytes > MAX_WORKSPACE_FILE_BYTES) {
      throw new Error('Workspace file content must be 1 MiB or smaller.')
    }

    await ensureWorkspaceRoot(this.workspaceDir)
    await assertNoSymlinkAncestors(this.workspaceDir, target.parts.slice(0, -1))
    await mkdir(dirname(target.absolutePath), { recursive: true })
    await assertNoSymlinkAncestors(this.workspaceDir, target.parts.slice(0, -1))

    try {
      const existing = await lstat(target.absolutePath)

      if (existing.isSymbolicLink()) {
        throw new Error('Workspace writes cannot replace symlinks.')
      }

      if (existing.isDirectory()) {
        throw new Error('Workspace writes require a file path, not a directory.')
      }
    } catch (error) {
      if (!isNodeErrorCode(error, 'ENOENT')) {
        throw error
      }
    }

    const fileHandle = await open(
      target.absolutePath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
      0o600
    )

    try {
      await fileHandle.writeFile(content, 'utf8')
    } finally {
      await fileHandle.close()
    }

    return [
      `Wrote ${bytes} byte${bytes === 1 ? '' : 's'} to ${target.relativePath}.`,
      `Workspace folder: ${this.workspaceDir}`
    ].join('\n')
  }

  async readTextFile(request: WorkspaceFileReadRequest): Promise<string> {
    const target = this.resolveWorkspacePath(request.filePath, { allowRoot: false })
    await ensureWorkspaceRoot(this.workspaceDir)
    await assertNoSymlinkAncestors(this.workspaceDir, target.parts.slice(0, -1))
    const fileHandle = await open(
      target.absolutePath,
      constants.O_RDONLY | constants.O_NOFOLLOW
    )

    try {
      const stat = await fileHandle.stat()

      if (!stat.isFile()) {
        throw new Error('Workspace reads require a file path.')
      }

      if (stat.size > MAX_WORKSPACE_FILE_BYTES) {
        throw new Error('Workspace file is too large to read through Bonzi.')
      }

      const content = await fileHandle.readFile('utf8')
      return [`${target.relativePath}:`, content].join('\n')
    } finally {
      await fileHandle.close()
    }
  }

  async listFiles(request: WorkspaceFileListRequest = {}): Promise<string> {
    const target = this.resolveWorkspacePath(request.directoryPath ?? '', { allowRoot: true })
    await ensureWorkspaceRoot(this.workspaceDir)
    await assertNoSymlinkAncestors(this.workspaceDir, target.parts)

    let stat: Awaited<ReturnType<typeof lstat>>
    try {
      stat = await lstat(target.absolutePath)
    } catch (error) {
      if (isNodeErrorCode(error, 'ENOENT')) {
        return target.relativePath
          ? `Workspace directory not found: ${target.relativePath}\nWorkspace folder: ${this.workspaceDir}`
          : `Workspace folder is empty.\nWorkspace folder: ${this.workspaceDir}`
      }

      throw error
    }

    if (stat.isSymbolicLink()) {
      throw new Error('Workspace listing does not follow symlinks.')
    }

    if (!stat.isDirectory()) {
      throw new Error('Workspace listing requires a directory path.')
    }

    const entries = await readdir(target.absolutePath, { withFileTypes: true })
    const visibleEntries = entries
      .filter((entry) => !entry.name.startsWith('.'))
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(0, MAX_LIST_ENTRIES)
      .map((entry) => `${entry.isDirectory() ? 'dir ' : 'file'} ${entry.name}`)

    const relativeLabel = target.relativePath || '.'
    const lines = visibleEntries.length > 0 ? visibleEntries : ['(empty)']
    const cappedNote = entries.length > MAX_LIST_ENTRIES
      ? `\nShowing first ${MAX_LIST_ENTRIES} of ${entries.length} entries.`
      : ''

    return [
      `Workspace folder: ${this.workspaceDir}`,
      `Listing ${relativeLabel}:`,
      ...lines,
      cappedNote
    ]
      .filter(Boolean)
      .join('\n')
  }

  private resolveWorkspacePath(
    rawPath: string,
    options: { allowRoot: boolean }
  ): { absolutePath: string; relativePath: string; parts: string[] } {
    const normalizedInput = normalizeWorkspaceRelativePath(rawPath, options)
    const parts = normalizedInput ? normalizedInput.split('/') : []
    const absolutePath = resolve(this.workspaceDir, ...parts)
    const workspaceRoot = resolve(this.workspaceDir)
    const rootPrefix = workspaceRoot.endsWith(sep) ? workspaceRoot : `${workspaceRoot}${sep}`

    if (absolutePath !== workspaceRoot && !absolutePath.startsWith(rootPrefix)) {
      throw new Error('Workspace path must stay inside the Bonzi workspace folder.')
    }

    return {
      absolutePath,
      relativePath: parts.join('/'),
      parts
    }
  }

  private resolveConfiguredWorkspaceDir(explicit: string | undefined): string {
    const explicitWorkspaceDir = normalizeConfiguredWorkspaceDir(explicit)
    const envWorkspaceDir = normalizeConfiguredWorkspaceDir(
      this.env.BONZI_WRITABLE_WORKSPACE_DIR
    )
    const persistedWorkspaceDir = this.readPersistedWorkspaceDir()

    return explicitWorkspaceDir ?? envWorkspaceDir ?? persistedWorkspaceDir ?? this.defaultWorkspaceDir
  }

  private readPersistedWorkspaceDir(): string | null {
    if (!existsSync(this.settingsPath)) {
      return null
    }

    try {
      const parsed = JSON.parse(readFileSync(this.settingsPath, 'utf8'))
      if (!isRecord(parsed)) {
        return null
      }

      return normalizeConfiguredWorkspaceDir(parsed.workspaceDir) ?? null
    } catch {
      return null
    }
  }
}

export function resolveBonziWritableWorkspaceDir(options: {
  env: NodeJS.ProcessEnv
  explicit?: string
  userDataDir: string
}): string {
  const fallback = resolve(options.userDataDir, DEFAULT_WORKSPACE_DIR_NAME)
  const explicit = normalizeConfiguredWorkspaceDir(options.explicit)

  if (explicit) {
    return explicit
  }

  return normalizeConfiguredWorkspaceDir(options.env.BONZI_WRITABLE_WORKSPACE_DIR) ?? fallback
}

function normalizeConfiguredWorkspaceDir(value: unknown): string | null {
  const normalized = normalizeOptionalString(value)

  if (!normalized || !isAbsolute(normalized)) {
    return null
  }

  return resolve(normalized)
}

function writeJsonFile(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tempPath, JSON.stringify(value, null, 2))
  renameSync(tempPath, filePath)
}

function normalizeWorkspaceRelativePath(
  value: string,
  options: { allowRoot: boolean }
): string {
  const normalized = value.trim().replace(/\\/gu, '/')

  if (!normalized) {
    if (options.allowRoot) {
      return ''
    }

    throw new Error('Workspace file path is required.')
  }

  if (isAbsolute(normalized) || /^[a-z]:/iu.test(normalized)) {
    throw new Error('Workspace paths must be relative paths.')
  }

  if (/[\x00-\x1F\x7F]/u.test(normalized)) {
    throw new Error('Workspace paths cannot contain control characters.')
  }

  const parts = normalized.split('/').filter(Boolean)

  if (parts.length === 0) {
    if (options.allowRoot) {
      return ''
    }

    throw new Error('Workspace file path is required.')
  }

  for (const part of parts) {
    if (part === '.' || part === '..') {
      throw new Error('Workspace paths cannot contain . or .. segments.')
    }
  }

  return parts.join('/')
}

function normalizeWorkspaceFileContent(value: string): string {
  const normalized = value.replace(/\r\n?/gu, '\n')

  if (normalized.length > MAX_WORKSPACE_FILE_CONTENT_CHARS) {
    throw new Error('Workspace file content is too long.')
  }

  if (/\u0000/u.test(normalized)) {
    throw new Error('Workspace file content cannot contain NUL bytes.')
  }

  return normalized
}

async function ensureWorkspaceRoot(workspaceDir: string): Promise<void> {
  await mkdir(workspaceDir, { recursive: true })
  const stat = await lstat(workspaceDir)

  if (stat.isSymbolicLink()) {
    throw new Error('Bonzi workspace folder cannot be a symlink.')
  }

  if (!stat.isDirectory()) {
    throw new Error('Bonzi workspace path must be a directory.')
  }
}

async function assertNoSymlinkAncestors(
  workspaceDir: string,
  parts: string[]
): Promise<void> {
  let currentPath = resolve(workspaceDir)

  for (const part of parts) {
    currentPath = join(currentPath, part)

    try {
      const stat = await lstat(currentPath)

      if (stat.isSymbolicLink()) {
        throw new Error('Workspace paths cannot traverse symlinked directories.')
      }

      if (!stat.isDirectory()) {
        throw new Error('Workspace path parent must be a directory.')
      }
    } catch (error) {
      if (isNodeErrorCode(error, 'ENOENT')) {
        return
      }

      throw error
    }
  }
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}
