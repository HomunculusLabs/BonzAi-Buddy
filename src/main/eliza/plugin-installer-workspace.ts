import { accessSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { constants } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import { isRecord, normalizeOptionalString } from '../../shared/value-utils'

const DEFAULT_WORKSPACE_DIR_NAME = 'eliza-plugin-workspace'

export function resolvePluginWorkspaceDir(options: {
  env: NodeJS.ProcessEnv
  explicit?: string
  userDataDir: string
}): string {
  const fallback = join(options.userDataDir, DEFAULT_WORKSPACE_DIR_NAME)
  const explicit = normalizeOptionalString(options.explicit)

  if (explicit) {
    return explicit
  }

  const envWorkspaceDir = normalizeOptionalString(options.env.BONZI_PLUGIN_WORKSPACE_DIR)

  if (!envWorkspaceDir) {
    return fallback
  }

  if (isAbsolute(envWorkspaceDir)) {
    return envWorkspaceDir
  }

  return fallback
}

export function ensureWorkspacePackageJson(workspaceDir: string): void {
  mkdirSync(workspaceDir, { recursive: true })
  const packageJsonPath = join(workspaceDir, 'package.json')

  if (!existsSync(packageJsonPath)) {
    writeFileSync(
      packageJsonPath,
      JSON.stringify(
        {
          private: true,
          type: 'module',
          dependencies: {}
        },
        null,
        2
      )
    )
    return
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  } catch {
    throw new Error('Plugin workspace package.json exists but is not valid JSON.')
  }

  if (!isRecord(parsed)) {
    throw new Error('Plugin workspace package.json must contain a JSON object.')
  }

  const dependencies = isRecord(parsed.dependencies) ? parsed.dependencies : {}
  const normalized = {
    ...parsed,
    private: true,
    type: 'module',
    dependencies
  }

  writeFileSync(packageJsonPath, JSON.stringify(normalized, null, 2))
}

export function resolveBunPath(env: NodeJS.ProcessEnv): string {
  const explicitPath = normalizeOptionalString(env.BONZI_BUN_PATH)

  if (explicitPath) {
    assertExecutable(explicitPath, 'BONZI_BUN_PATH')
    return explicitPath
  }

  const pathValue = normalizeOptionalString(env.PATH)

  if (!pathValue) {
    throw new Error(
      'Could not locate Bun. Set BONZI_BUN_PATH or ensure bun is available on PATH.'
    )
  }

  for (const segment of pathValue.split(delimiter)) {
    const normalizedSegment = normalizeOptionalString(segment)
    if (!normalizedSegment) {
      continue
    }

    const candidate = join(normalizedSegment, 'bun')

    if (!isExecutable(candidate)) {
      continue
    }

    return candidate
  }

  throw new Error(
    'Could not locate Bun. Set BONZI_BUN_PATH or ensure bun is available on PATH.'
  )
}

export function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)

  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed
  }

  return fallback
}

function assertExecutable(path: string, envVarName: string): void {
  if (!isExecutable(path)) {
    throw new Error(`${envVarName} points to a non-executable path: ${path}`)
  }
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}
