import type { ElizaPluginOperationSnapshot } from '../../shared/contracts'

const OPERATION_HISTORY_LIMIT = 24

export class PluginOperationHistory {
  private readonly operationHistory: ElizaPluginOperationSnapshot[] = []

  record(snapshot: ElizaPluginOperationSnapshot): void {
    const index = this.operationHistory.findIndex(
      (operation) => operation.operationId === snapshot.operationId
    )

    if (index >= 0) {
      this.operationHistory[index] = snapshot
      return
    }

    this.operationHistory.unshift(snapshot)

    if (this.operationHistory.length > OPERATION_HISTORY_LIMIT) {
      this.operationHistory.length = OPERATION_HISTORY_LIMIT
    }
  }

  list(): ElizaPluginOperationSnapshot[] {
    return [...this.operationHistory]
  }
}
