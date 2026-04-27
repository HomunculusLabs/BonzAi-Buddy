import type { AssistantEvent } from '../../shared/contracts'

export class BonziRuntimeEventEmitter {
  private readonly listeners = new Set<(event: AssistantEvent) => void>()

  subscribe(listener: (event: AssistantEvent) => void): () => void {
    this.listeners.add(listener)

    return (): void => {
      this.listeners.delete(listener)
    }
  }

  emit(event: AssistantEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  clear(): void {
    this.listeners.clear()
  }
}
