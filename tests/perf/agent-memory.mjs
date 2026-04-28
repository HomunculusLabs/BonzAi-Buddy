import { _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const runs = Number(process.env.BONZI_MEMORY_RUNS ?? '15')
const sampleDelayMs = Number(process.env.BONZI_MEMORY_SAMPLE_DELAY_MS ?? '2000')
const appEntry = join(process.cwd(), 'out/main/index.js')

function bytesToMiB(bytes) {
  return Math.round((bytes / 1024 / 1024) * 10) / 10
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle]
  return (sorted[middle - 1] + sorted[middle]) / 2
}

async function measureOnce(run) {
  const userDataDir = await mkdtemp(join(tmpdir(), 'bonzi-memory-'))
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

  const app = await electron.launch({
    args: ['--js-flags=--expose-gc', appEntry],
    env
  })

  try {
    const window = await app.firstWindow()
    await window.locator('.shell[data-app-ready="ready"]').waitFor({
      state: 'visible',
      timeout: 90_000
    })

    // Trigger one history hydration through the public bridge so the runtime and
    // message-memory path are resident before sampling the main process.
    await window.evaluate(async () => {
      await window.bonzi.assistant.getHistory()
    })

    const gcRan = await app.evaluate(() => {
      const maybeGc = globalThis.gc
      if (typeof maybeGc !== 'function') {
        return false
      }

      maybeGc()
      return true
    })

    await new Promise((resolve) => setTimeout(resolve, sampleDelayMs))

    const main = await app.evaluate(() => {
      const usage = process.memoryUsage()
      return {
        rss: usage.rss,
        heapTotal: usage.heapTotal,
        heapUsed: usage.heapUsed,
        external: usage.external,
        arrayBuffers: usage.arrayBuffers
      }
    })

    return {
      run,
      pid: app.process()?.pid ?? null,
      main,
      gcRan
    }
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
}

const samples = []
for (let run = 1; run <= runs; run += 1) {
  const sample = await measureOnce(run)
  samples.push(sample)
  console.log(
    JSON.stringify({
      run,
      pid: sample.pid,
      rssMiB: bytesToMiB(sample.main.rss),
      heapUsedMiB: bytesToMiB(sample.main.heapUsed),
      heapTotalMiB: bytesToMiB(sample.main.heapTotal),
      externalMiB: bytesToMiB(sample.main.external),
      arrayBuffersMiB: bytesToMiB(sample.main.arrayBuffers),
      gcRan: sample.gcRan
    })
  )
}

const rssMiB = samples.map((sample) => bytesToMiB(sample.main.rss))
const heapUsedMiB = samples.map((sample) => bytesToMiB(sample.main.heapUsed))
const heapTotalMiB = samples.map((sample) => bytesToMiB(sample.main.heapTotal))
const externalMiB = samples.map((sample) => bytesToMiB(sample.main.external))

console.log(
  JSON.stringify({
    summary: {
      runs,
      metric: 'electron-main-rss-after-agent-history-warm-mib',
      medianRssMiB: median(rssMiB),
      medianHeapUsedMiB: median(heapUsedMiB),
      medianHeapTotalMiB: median(heapTotalMiB),
      medianExternalMiB: median(externalMiB),
      rssMiB,
      heapUsedMiB,
      heapTotalMiB,
      externalMiB,
      gcRanAllRuns: samples.every((sample) => sample.gcRan)
    }
  })
)
