import type { AssistantMessage } from '../shared/contracts/assistant'
import type { ShellState } from '../shared/contracts/shell'
import type { HydratePluginSettingsOptions } from './plugin-settings-controller'

export interface AppHydrationControllerOptions {
  shellStateEl: HTMLElement
  vrmPathEl: HTMLElement
  vrmStatusEl: HTMLElement
  vrmErrorEl: HTMLElement
  vrmRetryButton: HTMLButtonElement
  getShellState(): Promise<ShellState>
  getAssistantHistory(): Promise<AssistantMessage[]>
  applyShellState(state: ShellState): void
  hydrateConversation(messages: AssistantMessage[]): void
  appendSystemMessage(message: string): void
  getConversationEntryCount(): number
  hydrateProviderSettings(): Promise<void>
  hydrateCharacterSettings(): Promise<void>
  hydrateKnowledgeSettings(): Promise<void>
  hydratePluginSettings(options?: HydratePluginSettingsOptions): Promise<void>
  setInputEnabled(enabled: boolean): void
  setAppReadyState(state: 'loading' | 'ready' | 'error'): void
  syncBubbleWindowLayout(): void
  loadVrm(): Promise<void>
}

export interface AppHydrationController {
  hydrate(): void
}

export function createAppHydrationController(
  options: AppHydrationControllerOptions
): AppHydrationController {
  const setVrmFailureState = (message: string): void => {
    options.vrmPathEl.textContent = 'Unavailable'
    options.vrmStatusEl.textContent = 'VRM failed to initialize'
    options.vrmErrorEl.hidden = false
    options.vrmErrorEl.textContent = message
    options.vrmRetryButton.hidden = true
  }

  const hydrate = (): void => {
    void (async () => {
      const [shellStateResult, historyResult] = await Promise.allSettled([
        options.getShellState(),
        options.getAssistantHistory()
      ])

      if (shellStateResult.status === 'rejected') {
        const message = `Failed to load shell state: ${String(shellStateResult.reason)}`
        options.setAppReadyState('error')
        options.shellStateEl.textContent = message
        setVrmFailureState(message)
        options.appendSystemMessage(message)
        options.syncBubbleWindowLayout()
        return
      }

      options.applyShellState(shellStateResult.value)

      if (historyResult.status === 'fulfilled') {
        options.hydrateConversation(historyResult.value)
      } else {
        options.appendSystemMessage(
          `Failed to load assistant history: ${String(historyResult.reason)}`
        )
      }

      await Promise.all([
        options.hydrateProviderSettings(),
        options.hydrateCharacterSettings(),
        options.hydrateKnowledgeSettings(),
        options.hydratePluginSettings({
          preserveStatus: true,
          fallbackToSavedSettings: false
        })
      ])

      if (
        options.getConversationEntryCount() === 0 &&
        shellStateResult.value.assistant.warnings.length > 0
      ) {
        options.appendSystemMessage(
          shellStateResult.value.assistant.warnings.join(' ')
        )
      }

      options.setInputEnabled(true)
      options.setAppReadyState('ready')
      void options.loadVrm()
    })().catch((error: unknown) => {
      const message = `Failed to hydrate Bonzi shell: ${String(error)}`
      options.setAppReadyState('error')
      options.shellStateEl.textContent = message
      setVrmFailureState(message)
      options.appendSystemMessage(message)
      options.syncBubbleWindowLayout()
    })
  }

  return { hydrate }
}
