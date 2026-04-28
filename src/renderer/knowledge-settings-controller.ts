import { createKnowledgeSettingsDataClient } from './knowledge-settings-data-client'
import { createKnowledgeSettingsFlows } from './knowledge-settings-flows'
import { createKnowledgeSettingsState } from './knowledge-settings-state'

interface KnowledgeSettingsControllerOptions {
  knowledgeSettingsEl: HTMLElement
  setStatusMessage(message: string): void
  onSavingChange(saving: boolean): void
}

export interface KnowledgeSettingsController {
  hydrate(): Promise<void>
  dispose(): void
}

export function createKnowledgeSettingsController(
  options: KnowledgeSettingsControllerOptions
): KnowledgeSettingsController {
  const { knowledgeSettingsEl } = options
  const state = createKnowledgeSettingsState({ knowledgeSettingsEl })
  const flows = createKnowledgeSettingsFlows({
    state,
    client: createKnowledgeSettingsDataClient(),
    setStatusMessage: options.setStatusMessage,
    onSavingChange: options.onSavingChange
  })

  const handleChange = (event: Event): void => {
    const target = event.target
    if (!(target instanceof HTMLInputElement) || !target.matches('[data-knowledge-files]')) {
      return
    }

    flows.setSelectedFiles(Array.from(target.files ?? []))
  }

  const handleClick = (event: MouseEvent): void => {
    const target = event.target
    if (!(target instanceof Element)) {
      return
    }

    if (target.closest('[data-knowledge-choose-folders]')) {
      void flows.chooseFolders()
      return
    }

    if (target.closest('[data-knowledge-import-folders]')) {
      void flows.importSelectedFolders()
      return
    }

    if (target.closest('[data-knowledge-cancel]')) {
      void flows.cancelImport()
      return
    }

    if (target.closest('[data-knowledge-import]')) {
      void flows.importSelectedFiles()
    }
  }

  knowledgeSettingsEl.addEventListener('change', handleChange)
  knowledgeSettingsEl.addEventListener('click', handleClick)
  state.render()

  return {
    hydrate: flows.hydrate,
    dispose: () => {
      flows.dispose()
      knowledgeSettingsEl.removeEventListener('change', handleChange)
      knowledgeSettingsEl.removeEventListener('click', handleClick)
    }
  }
}
