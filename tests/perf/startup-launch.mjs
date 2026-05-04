import { _electron as electron } from '@playwright/test'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'

const runs = Number(process.env.BONZI_STARTUP_RUNS ?? '5')
const timeoutMs = Number(process.env.BONZI_STARTUP_TIMEOUT_MS ?? '30000')
const appEntry = join(process.cwd(), 'out/main/index.js')

function roundMs(value) {
  return Math.round(value * 10) / 10
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle]
  return (sorted[middle - 1] + sorted[middle]) / 2
}

function percentile(values, percentileRank) {
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileRank / 100) * sorted.length) - 1)
  )
  return sorted[index]
}

async function assertBuiltAppExists() {
  try {
    await stat(appEntry)
  } catch {
    throw new Error(
      `Built Electron entry was not found at ${appEntry}. Run \`bun run build\` before measuring startup.`
    )
  }
}

function withTimeout(promise, label, startedAt) {
  let timeout
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      const elapsedMs = roundMs(performance.now() - startedAt)
      reject(new Error(`${label} timed out after ${timeoutMs} ms (elapsed ${elapsedMs} ms)`))
    }, timeoutMs)
  })

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout))
}

function safeElectronPid(app) {
  try {
    return app?.process()?.pid ?? null
  } catch {
    return null
  }
}

async function measureOnce(run) {
  const userDataDir = await mkdtemp(join(tmpdir(), 'bonzi-startup-'))
  const env = {
    ...process.env,
    BONZI_E2E_MODE: '1',
    BONZI_ASSISTANT_PROVIDER: process.env.BONZI_ASSISTANT_PROVIDER ?? 'eliza-classic',
    BONZI_DISABLE_GPU: '1',
    BONZI_OPAQUE_WINDOW: '1',
    BONZI_DISABLE_VRM: '1',
    BONZI_USER_DATA_DIR: userDataDir
  }
  delete env.ELECTRON_RENDERER_URL

  const startedAt = performance.now()
  let app = null
  let pid = null

  try {
    app = await withTimeout(
      electron.launch({
        args: [appEntry],
        env
      }),
      'electron.launch',
      startedAt
    )
    const launchedAt = performance.now()
    pid = safeElectronPid(app)

    const window = await withTimeout(app.firstWindow(), 'app.firstWindow', startedAt)
    const firstWindowAt = performance.now()

    await withTimeout(
      window.locator('.shell[data-app-ready="ready"]').waitFor({
        state: 'visible',
        timeout: timeoutMs
      }),
      'shell ready marker',
      startedAt
    )
    const readyAt = performance.now()

    return {
      run,
      pid,
      status: 'ready',
      launchMs: roundMs(launchedAt - startedAt),
      firstWindowMs: roundMs(firstWindowAt - startedAt),
      readyMs: roundMs(readyAt - startedAt)
    }
  } catch (error) {
    return {
      run,
      pid: pid ?? safeElectronPid(app),
      status: 'timeout',
      elapsedMs: roundMs(performance.now() - startedAt),
      error: String(error instanceof Error ? error.message : error)
    }
  } finally {
    await app?.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
}

if (!Number.isInteger(runs) || runs < 1) {
  throw new Error('BONZI_STARTUP_RUNS must be a positive integer.')
}

if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
  throw new Error('BONZI_STARTUP_TIMEOUT_MS must be a positive number.')
}

function cleanupChildProcesses() {
  try {
    execFileSync('pkill', ['-TERM', '-P', String(process.pid)], { stdio: 'ignore' })
  } catch {
    // No child processes, or pkill unavailable. Best-effort cleanup only.
  }

  try {
    execFileSync('pkill', ['-KILL', '-P', String(process.pid)], { stdio: 'ignore' })
  } catch {
    // No child processes, or pkill unavailable. Best-effort cleanup only.
  }
}

await assertBuiltAppExists()

const samples = []
for (let run = 1; run <= runs; run += 1) {
  const sample = await measureOnce(run)
  samples.push(sample)
  console.log(JSON.stringify(sample))
}

const readySamples = samples.filter((sample) => sample.status === 'ready')
const readyMs = readySamples.map((sample) => sample.readyMs)
const firstWindowMs = readySamples.map((sample) => sample.firstWindowMs)
const launchMs = readySamples.map((sample) => sample.launchMs)

console.log(
  JSON.stringify({
    summary: {
      runs,
      timeoutMs,
      metric: 'electron-cold-launch-to-shell-ready-ms',
      readyRuns: readySamples.length,
      timeoutRuns: samples.length - readySamples.length,
      medianReadyMs: readyMs.length > 0 ? roundMs(median(readyMs)) : null,
      p95ReadyMs: readyMs.length > 0 ? roundMs(percentile(readyMs, 95)) : null,
      medianFirstWindowMs: firstWindowMs.length > 0 ? roundMs(median(firstWindowMs)) : null,
      medianElectronLaunchMs: launchMs.length > 0 ? roundMs(median(launchMs)) : null,
      readyMs,
      firstWindowMs,
      launchMs,
      failures: samples.filter((sample) => sample.status !== 'ready')
    }
  })
)

cleanupChildProcesses()
process.exit(0)
