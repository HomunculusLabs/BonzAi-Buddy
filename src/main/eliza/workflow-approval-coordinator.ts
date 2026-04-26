import { WORKFLOW_APPROVAL_TIMEOUT_MS, pendingApprovalKey } from './workflow-snapshot-utils'

interface PendingApprovalEntry {
  runId: string
  stepId: string
  resolve: (approved: boolean) => void
  promise: Promise<boolean>
  timeout: ReturnType<typeof setTimeout>
}

interface WorkflowApprovalCoordinatorOptions {
  approvalTimeoutMs?: number
  onApprovalTimeout: (input: { runId: string; stepId: string }) => void
}

export class WorkflowApprovalCoordinator {
  private readonly approvalTimeoutMs: number
  private readonly onApprovalTimeout: (input: { runId: string; stepId: string }) => void
  private readonly pendingApprovals = new Map<string, PendingApprovalEntry>()
  private approvalsEnabled = true

  constructor(options: WorkflowApprovalCoordinatorOptions) {
    this.approvalTimeoutMs = options.approvalTimeoutMs ?? WORKFLOW_APPROVAL_TIMEOUT_MS
    this.onApprovalTimeout = options.onApprovalTimeout
  }

  getApprovalsEnabled(): boolean {
    return this.approvalsEnabled
  }

  setApprovalsEnabled(
    enabled: boolean,
    approvePendingApproval: (input: { runId: string; stepId: string }) => void
  ): void {
    const nextEnabled = enabled === true

    if (this.approvalsEnabled === nextEnabled) {
      return
    }

    this.approvalsEnabled = nextEnabled

    if (!nextEnabled) {
      this.approvePendingApprovals(approvePendingApproval)
    }
  }

  hasPendingApproval(runId: string, stepId: string): boolean {
    return this.pendingApprovals.has(pendingApprovalKey(runId, stepId))
  }

  getPendingApprovalPromise(runId: string, stepId: string): Promise<boolean> | null {
    return this.pendingApprovals.get(pendingApprovalKey(runId, stepId))?.promise ?? null
  }

  requestApproval(input: { runId: string; stepId: string }): Promise<boolean> {
    const approvalKey = pendingApprovalKey(input.runId, input.stepId)
    const existing = this.pendingApprovals.get(approvalKey)

    if (existing) {
      return existing.promise
    }

    let resolvePromise!: (approved: boolean) => void
    const timeout = setTimeout(() => {
      this.onApprovalTimeout({ runId: input.runId, stepId: input.stepId })
    }, this.approvalTimeoutMs)
    timeout.unref?.()

    const promise = new Promise<boolean>((resolve) => {
      resolvePromise = resolve
    }).finally(() => {
      clearTimeout(timeout)
      this.pendingApprovals.delete(approvalKey)
    })

    this.pendingApprovals.set(approvalKey, {
      runId: input.runId,
      stepId: input.stepId,
      resolve: resolvePromise,
      promise,
      timeout
    })

    return promise
  }

  resolveApproval(input: {
    runId: string
    stepId: string
    approved: boolean
  }): boolean {
    const approvalKey = pendingApprovalKey(input.runId, input.stepId)
    const pending = this.pendingApprovals.get(approvalKey)

    if (!pending) {
      return false
    }

    this.resolvePendingApproval(approvalKey, pending, input.approved)
    return true
  }

  declinePendingApprovalsForRun(runId: string): void {
    for (const [approvalKey, pending] of Array.from(this.pendingApprovals.entries())) {
      if (pending.runId !== runId) {
        continue
      }

      this.resolvePendingApproval(approvalKey, pending, false)
    }
  }

  dispose(): void {
    for (const [approvalKey, pending] of Array.from(this.pendingApprovals.entries())) {
      this.resolvePendingApproval(approvalKey, pending, false)
    }
  }

  private approvePendingApprovals(
    approvePendingApproval: (input: { runId: string; stepId: string }) => void
  ): void {
    for (const [approvalKey, pending] of Array.from(this.pendingApprovals.entries())) {
      approvePendingApproval({ runId: pending.runId, stepId: pending.stepId })
      this.resolvePendingApproval(approvalKey, pending, true)
    }
  }

  private resolvePendingApproval(
    approvalKey: string,
    pending: PendingApprovalEntry,
    approved: boolean
  ): void {
    this.pendingApprovals.delete(approvalKey)
    clearTimeout(pending.timeout)
    pending.resolve(approved)
  }
}
