import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { BonziRuntimeMemoryService } from '../../src/main/eliza/runtime-memory-service'
import type { KnowledgeImportStatus } from '../../src/shared/contracts'

const runs = Number(process.env.BONZI_KNOWLEDGE_IMPORT_RUNS ?? '3')
const fileCount = Number(process.env.BONZI_KNOWLEDGE_IMPORT_FILES ?? '300')
const filesPerDirectory = Number(process.env.BONZI_KNOWLEDGE_IMPORT_FILES_PER_DIR ?? '100')
const timerIntervalMs = Number(process.env.BONZI_KNOWLEDGE_IMPORT_TIMER_MS ?? '10')
const pollIntervalMs = Number(process.env.BONZI_KNOWLEDGE_IMPORT_POLL_MS ?? '25')
const writeBatchSize = Number(process.env.BONZI_KNOWLEDGE_IMPORT_WRITE_BATCH ?? '250')
const manifestEnabled = process.env.BONZI_KNOWLEDGE_IMPORT_MANIFEST !== '0'
const logProgress = process.env.BONZI_KNOWLEDGE_IMPORT_PROGRESS === '1'

interface LagStats {
  samples: number
  p50Ms: number
  p95Ms: number
  maxMs: number
}

interface RunResult {
  run: number
  fileCount: number
  timerIntervalMs: number
  totalImportMs: number
  lag: LagStats
  processedDocuments: number
  importedDocuments: number
  skippedDocuments: number
  failedDocuments: number
  importedChunks: number
  finalState: KnowledgeImportStatus['state']
  finalMessage: string
  fakeRuntimeMemoryCount: number
  manifestEnabled: boolean
}

const activeStates = new Set<KnowledgeImportStatus['state']>([
  'scanning',
  'importing',
  'cancel_requested'
])

function percentile(values: readonly number[], percentileValue: number): number {
  if (values.length === 0) {
    return 0
  }

  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1)
  )
  return sorted[index]
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10
}

function summarizeLag(samples: readonly number[]): LagStats {
  return {
    samples: samples.length,
    p50Ms: roundMs(percentile(samples, 50)),
    p95Ms: roundMs(percentile(samples, 95)),
    maxMs: roundMs(samples.length === 0 ? 0 : Math.max(...samples))
  }
}

function medianRunByTotalTime(results: readonly RunResult[]): RunResult {
  const sorted = [...results].sort((left, right) => left.totalImportMs - right.totalImportMs)
  return sorted[Math.floor(sorted.length / 2)]
}

async function generateKnowledgeFolder(root: string): Promise<string> {
  const folderRoot = join(root, 'knowledge-folder')
  await mkdir(folderRoot, { recursive: true })

  const directoryCount = Math.ceil(fileCount / filesPerDirectory)
  await Promise.all(
    Array.from({ length: directoryCount }, (_, index) =>
      mkdir(join(folderRoot, `group-${String(index).padStart(3, '0')}`), { recursive: true })
    )
  )

  for (let start = 0; start < fileCount; start += writeBatchSize) {
    await Promise.all(
      Array.from({ length: Math.min(writeBatchSize, fileCount - start) }, (_, offset) => {
        const index = start + offset
        const directory = join(
          folderRoot,
          `group-${String(Math.floor(index / filesPerDirectory)).padStart(3, '0')}`
        )
        const filePath = join(directory, `doc-${String(index).padStart(5, '0')}.md`)
        return writeFile(
          filePath,
          `# Knowledge Doc ${index}\n\nTiny generated baseline content for document ${index}.\n`,
          'utf8'
        )
      })
    )
  }

  return folderRoot
}

function createFakeRuntimeBundle(memoryStore: Map<string, unknown>) {
  const agentId = '00000000-0000-0000-0000-000000000004'
  const roomId = '00000000-0000-0000-0000-000000000002'

  return {
    userId: '00000000-0000-0000-0000-000000000001',
    roomId,
    worldId: '00000000-0000-0000-0000-000000000003',
    runtime: {
      agentId,
      getMemoryById: async (id: string) => memoryStore.get(String(id)) ?? null,
      addEmbeddingToMemory: async (memory: unknown) => memory,
      createMemory: async (memory: { id?: unknown }) => {
        memoryStore.set(String(memory?.id ?? `memory-${memoryStore.size}`), memory)
      },
      countMemories: async (requestedRoomId: string, _unique?: boolean, tableName?: string) => {
        if (requestedRoomId !== roomId || tableName !== 'knowledge') {
          return 0
        }
        return memoryStore.size
      },
      getMemories: async () => []
    }
  }
}

function startEventLoopLagProbe(intervalMs: number) {
  const samples: number[] = []
  let expected = performance.now() + intervalMs
  const timer = setInterval(() => {
    const now = performance.now()
    samples.push(Math.max(0, now - expected))
    expected += intervalMs
  }, intervalMs)

  return {
    stop: () => clearInterval(timer),
    samples
  }
}

async function waitForFinalStatus(
  service: BonziRuntimeMemoryService,
  run: number
): Promise<KnowledgeImportStatus> {
  let lastProgressLogAt = 0

  while (true) {
    const status = await service.getKnowledgeImportStatus()
    if (!activeStates.has(status.state)) {
      return status
    }

    if (logProgress && performance.now() - lastProgressLogAt >= 1_000) {
      lastProgressLogAt = performance.now()
      console.error(
        JSON.stringify({
          progress: true,
          run,
          state: status.state,
          processedDocuments: status.processedDocuments ?? 0,
          totalDocuments: status.totalDocuments ?? 0,
          importedChunks: status.importedChunks,
          currentDocumentName: status.currentDocumentName,
          currentDocumentRelativePath: status.currentDocumentRelativePath
        })
      )
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }
}

async function measureOnce(run: number): Promise<RunResult> {
  const tempRoot = await mkdtemp(join(tmpdir(), 'bonzi-knowledge-import-lag-'))
  const memoryStore = new Map<string, unknown>()

  try {
    const folderRoot = await generateKnowledgeFolder(tempRoot)
    const service = new BonziRuntimeMemoryService({
      knowledgeImportManifestPath: manifestEnabled
        ? join(tempRoot, 'knowledge-import-manifest.json')
        : undefined,
      getRuntime: async () => createFakeRuntimeBundle(memoryStore) as any
    })

    const lagProbe = startEventLoopLagProbe(timerIntervalMs)
    const startedAt = performance.now()
    const startResult = await service.startKnowledgeFolderImport({ folderPaths: [folderRoot] })

    if (!startResult.ok) {
      lagProbe.stop()
      throw new Error(startResult.error ?? startResult.message)
    }

    const finalStatus = await waitForFinalStatus(service, run)
    const totalImportMs = performance.now() - startedAt
    lagProbe.stop()

    return {
      run,
      fileCount,
      timerIntervalMs,
      totalImportMs: roundMs(totalImportMs),
      lag: summarizeLag(lagProbe.samples),
      processedDocuments: finalStatus.processedDocuments ?? 0,
      importedDocuments: finalStatus.importedDocuments,
      skippedDocuments: finalStatus.skippedDocuments,
      failedDocuments: finalStatus.failedDocuments,
      importedChunks: finalStatus.importedChunks,
      finalState: finalStatus.state,
      finalMessage: finalStatus.message,
      fakeRuntimeMemoryCount: memoryStore.size,
      manifestEnabled
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

const results: RunResult[] = []

for (let run = 1; run <= runs; run += 1) {
  const result = await measureOnce(run)
  results.push(result)
  console.log(JSON.stringify(result))
}

const median = medianRunByTotalTime(results)
console.log(
  JSON.stringify({
    summary: {
      metric: 'knowledge-import-folder-event-loop-lag-ms',
      runs,
      workload: {
        fileCount,
        filesPerDirectory,
        timerIntervalMs,
        tinyMarkdown: true,
        fakeRuntime: true,
        manifestEnabled
      },
      medianRun: median.run,
      medianTotalImportMs: median.totalImportMs,
      medianP50LagMs: median.lag.p50Ms,
      medianP95LagMs: median.lag.p95Ms,
      medianMaxLagMs: median.lag.maxMs,
      medianProcessedDocuments: median.processedDocuments,
      medianImportedChunks: median.importedChunks,
      finalStates: results.map((result) => result.finalState),
      rawRuns: results
    }
  })
)
