import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { BonziWorkflowRunSnapshot } from '../../shared/contracts'
import { isRecord } from '../../shared/value-utils'
import { normalizePersistedRun } from './workflow-snapshot-utils'

const WORKFLOW_RUNS_SCHEMA_VERSION = 1

interface PersistedWorkflowRunsFile {
  schemaVersion: number
  runs: BonziWorkflowRunSnapshot[]
}

export class BonziWorkflowRunPersistence {
  private readonly persistencePath: string

  constructor(options: { persistencePath: string }) {
    this.persistencePath = options.persistencePath
  }

  load(): BonziWorkflowRunSnapshot[] {
    if (!existsSync(this.persistencePath)) {
      return []
    }

    try {
      const parsed = JSON.parse(readFileSync(this.persistencePath, 'utf8'))

      if (!isRecord(parsed) || !Array.isArray(parsed.runs)) {
        return []
      }

      const schemaVersion = Number(parsed.schemaVersion)
      if (!Number.isFinite(schemaVersion) || schemaVersion < 1) {
        return []
      }

      return parsed.runs
        .map((entry) => normalizePersistedRun(entry))
        .filter((run): run is BonziWorkflowRunSnapshot => Boolean(run))
    } catch (error) {
      console.error('Failed to load workflow runs; starting fresh.', error)
      return []
    }
  }

  save(input: {
    runOrder: readonly string[]
    runsById: ReadonlyMap<string, BonziWorkflowRunSnapshot>
  }): void {
    try {
      const payload: PersistedWorkflowRunsFile = {
        schemaVersion: WORKFLOW_RUNS_SCHEMA_VERSION,
        runs: input.runOrder
          .map((runId) => input.runsById.get(runId))
          .filter((run): run is BonziWorkflowRunSnapshot => Boolean(run))
      }

      mkdirSync(dirname(this.persistencePath), { recursive: true })
      writeFileSync(this.persistencePath, JSON.stringify(payload, null, 2))
    } catch (error) {
      console.error('Failed to persist workflow runs.', error)
    }
  }
}
