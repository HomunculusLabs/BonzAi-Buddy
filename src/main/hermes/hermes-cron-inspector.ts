import { execFile } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, relative } from 'node:path'
import { promisify } from 'node:util'
import { normalizeText, truncate } from '../assistant-action-param-utils'
import { loadHermesConfig } from './hermes-config'

const execFileAsync = promisify(execFile)

interface HermesCronCliResult {
  stdout: string
  stderr: string
}

interface HermesCronStateEntry {
  relativePath: string
  content: string
}

export async function inspectHermesCronJobs(query: string | undefined): Promise<string> {
  const normalizedQuery = truncate(normalizeText(query), 200)

  try {
    const result = await listHermesCronWithCli()
    return formatHermesCronCliResult(result, normalizedQuery)
  } catch (error) {
    const cliError = error instanceof Error ? error.message : String(error)
    return inspectHermesCronStateFiles(normalizedQuery, cliError)
  }
}

async function listHermesCronWithCli(): Promise<HermesCronCliResult> {
  const config = loadHermesConfig()

  if (config.e2eMode) {
    return {
      stdout: 'Hermes cron inspection fixture: no scheduled jobs.',
      stderr: ''
    }
  }

  const result = await execFileAsync(config.cliPath, ['cron', 'list'], {
    cwd: config.cwd,
    timeout: Math.min(config.timeoutMs, 10_000),
    maxBuffer: 512 * 1024
  })

  return {
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? '')
  }
}

function formatHermesCronCliResult(
  result: HermesCronCliResult,
  query: string
): string {
  const stdout = result.stdout.trim()
  const stderr = result.stderr.trim()
  const outputLines = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)

  if (outputLines.length === 0) {
    return stderr
      ? `Hermes cron has no scheduled jobs. Hermes CLI notice: ${truncate(stderr, 500)}`
      : 'Hermes cron has no scheduled jobs.'
  }

  const matchingLines = query
    ? outputLines.filter((line) => line.toLowerCase().includes(query.toLowerCase()))
    : outputLines

  if (matchingLines.length === 0) {
    return [
      `Hermes cron returned ${outputLines.length} output ${outputLines.length === 1 ? 'line' : 'lines'}, but none matched “${query}”.`,
      'Hermes cron output:',
      ...outputLines.map((line) => `- ${line}`),
      stderr ? `Hermes CLI notice: ${truncate(stderr, 500)}` : ''
    ].filter(Boolean).join('\n')
  }

  return [
    query
      ? `Hermes cron output matching “${query}”:`
      : 'Hermes cron scheduled jobs:',
    ...matchingLines.map((line) => `- ${line}`),
    stderr ? `Hermes CLI notice: ${truncate(stderr, 500)}` : ''
  ].filter(Boolean).join('\n')
}

async function inspectHermesCronStateFiles(
  query: string,
  cliError: string
): Promise<string> {
  const cronStateDir = join(homedir(), '.hermes', 'cron')
  const stateEntries = await readHermesCronStateEntries(cronStateDir)
  const cliFallbackNotice = `Hermes CLI cron list was unavailable (${truncate(cliError, 500)}).`

  if (stateEntries.length === 0) {
    return [
      'No Hermes cron state files were found.',
      cliFallbackNotice,
      `Checked Hermes cron state directory: ${cronStateDir}.`
    ].join('\n')
  }

  const matchingEntries = query
    ? stateEntries.filter((entry) =>
        `${entry.relativePath}\n${entry.content}`.toLowerCase().includes(query.toLowerCase())
      )
    : stateEntries

  if (matchingEntries.length === 0) {
    return [
      `Found ${stateEntries.length} Hermes cron state ${stateEntries.length === 1 ? 'file' : 'files'}, but none matched “${query}”.`,
      cliFallbackNotice,
      'Hermes cron state files:',
      ...stateEntries.slice(0, 20).map(formatHermesCronStateEntry)
    ].join('\n')
  }

  return [
    query
      ? `Hermes cron state files matching “${query}”:`
      : 'Hermes cron state files:',
    cliFallbackNotice,
    ...matchingEntries.slice(0, 20).map(formatHermesCronStateEntry),
    matchingEntries.length > 20
      ? `...and ${matchingEntries.length - 20} more Hermes cron state ${matchingEntries.length - 20 === 1 ? 'file' : 'files'}.`
      : ''
  ].filter(Boolean).join('\n')
}

async function readHermesCronStateEntries(rootDir: string): Promise<HermesCronStateEntry[]> {
  const entries: HermesCronStateEntry[] = []

  async function visit(dir: string): Promise<void> {
    if (entries.length >= 50) {
      return
    }

    let dirents
    try {
      dirents = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const dirent of dirents.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entries.length >= 50) {
        return
      }

      const fullPath = join(dir, dirent.name)

      if (dirent.isDirectory()) {
        await visit(fullPath)
        continue
      }

      if (!dirent.isFile()) {
        continue
      }

      try {
        const content = await readFile(fullPath, 'utf8')
        entries.push({
          relativePath: relative(rootDir, fullPath) || dirent.name,
          content: truncate(content.trim(), 2_000)
        })
      } catch {
        entries.push({
          relativePath: relative(rootDir, fullPath) || dirent.name,
          content: '[unreadable Hermes cron state file]'
        })
      }
    }
  }

  await visit(rootDir)
  return entries
}

function formatHermesCronStateEntry(entry: HermesCronStateEntry): string {
  const content = entry.content.replace(/\s+/gu, ' ').trim()
  return `- ${entry.relativePath}: ${truncate(content || '[empty Hermes cron state file]', 700)}`
}
