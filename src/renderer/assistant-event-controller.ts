import type { AssistantEvent } from '../shared/contracts'

export interface AssistantEventController {
  dispose(): void
}

export interface AssistantEventControllerOptions {
  onAssistantEvent(event: AssistantEvent): void
}

export function createAssistantEventController(
  options: AssistantEventControllerOptions
): AssistantEventController {
  const unsubscribe = window.bonzi.assistant.onEvent(options.onAssistantEvent)

  return {
    dispose: unsubscribe
  }
}
