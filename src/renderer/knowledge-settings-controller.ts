import type {
  KnowledgeImportDocumentResult,
  KnowledgeImportStatus
} from '../shared/contracts'
import { escapeHtml } from './html-utils'

interface KnowledgeSettingsControllerOptions {
  knowledgeSettingsEl: HTMLElement
  setStatusMessage(message: string): void
  onSavingChange(saving: boolean): void
}

export interface KnowledgeSettingsController {
  hydrate(): Promise<void>
  dispose(): void
}

const MAX_CLIENT_DOCUMENT_BYTES = 1024 * 1024
const MAX_CLIENT_TOTAL_BYTES = 5 * 1024 * 1024
const MAX_CLIENT_DOCUMENTS = 20

export function createKnowledgeSettingsController(
  options: KnowledgeSettingsControllerOptions
): KnowledgeSettingsController {
  const { knowledgeSettingsEl } = options
  let status: KnowledgeImportStatus | null = null
  let documentResults: KnowledgeImportDocumentResult[] = []
  let selectedFiles: File[] = []
  let isImporting = false
  let isHydrated = false

  const setImporting = (importing: boolean): void => {
    isImporting = importing
    options.onSavingChange(importing)
  }

  const hydrate = async (): Promise<void> => {
    if (!window.bonzi) {
      isHydrated = true
      render()
      return
    }

    try {
      status = await window.bonzi.settings.getKnowledgeImportStatus()
      isHydrated = true
      render()
    } catch (error) {
      isHydrated = true
      options.setStatusMessage(`Failed to load knowledge import status: ${String(error)}`)
      render()
    }
  }

  const render = (): void => {
    const bridgeAvailable = Boolean(window.bonzi)
    const disabled = !bridgeAvailable || isImporting ? 'disabled' : ''
    const canImport = bridgeAvailable && selectedFiles.length > 0 && !isImporting

    knowledgeSettingsEl.innerHTML = `
      <div class="knowledge-settings__intro">
        <div class="settings-panel__section-header">
          <h3 class="settings-panel__section-title">Knowledge import</h3>
          <p class="settings-panel__section-copy">
            Import Markdown files into elizaOS runtime memory/RAG. Files are read in the renderer and sent as text; file paths and imported Markdown are not saved in Bonzi settings.
          </p>
        </div>
      </div>

      <div class="settings-card knowledge-settings__card">
        <label class="knowledge-settings__file-field">
          <span>
            <strong>Markdown files</strong>
            <small>Select up to ${MAX_CLIENT_DOCUMENTS} .md files, max 1 MiB each / 5 MiB total.</small>
          </span>
          <input
            type="file"
            accept=".md,text/markdown"
            multiple
            data-knowledge-files
            ${disabled}
          />
        </label>
        ${renderSelectedFiles()}
        <div class="knowledge-settings__actions">
          <button
            class="settings-button settings-button--primary"
            type="button"
            data-knowledge-import
            ${canImport ? '' : 'disabled'}
          >${isImporting ? 'Importing…' : 'Import Markdown'}</button>
        </div>
      </div>

      ${renderStatus()}
      ${renderDocumentResults()}
    `
  }

  const renderSelectedFiles = (): string => {
    if (selectedFiles.length === 0) {
      return '<p class="knowledge-settings__empty">No Markdown files selected.</p>'
    }

    return `
      <ul class="knowledge-settings__file-list">
        ${selectedFiles
          .map(
            (file) => `
              <li>
                <span>${escapeHtml(file.name)}</span>
                <small>${formatBytes(file.size)}</small>
              </li>
            `
          )
          .join('')}
      </ul>
    `
  }

  const renderStatus = (): string => {
    const currentStatus = status
    if (!isHydrated || !currentStatus) {
      return '<p class="settings-panel__empty">Knowledge import status is loading…</p>'
    }

    return `
      <div class="settings-card knowledge-settings__status" data-knowledge-status-state="${escapeHtml(currentStatus.state)}">
        <h4 class="character-settings__section-title">Last import</h4>
        <p>${escapeHtml(currentStatus.message)}</p>
        <dl class="knowledge-settings__stats">
          <div><dt>State</dt><dd>${escapeHtml(currentStatus.state)}</dd></div>
          <div><dt>Documents</dt><dd>${currentStatus.importedDocuments} imported · ${currentStatus.skippedDocuments} skipped · ${currentStatus.failedDocuments} failed</dd></div>
          <div><dt>Chunks</dt><dd>${currentStatus.importedChunks}</dd></div>
        </dl>
        ${currentStatus.errors.length > 0
          ? `<ul class="knowledge-settings__errors">${currentStatus.errors.map((error) => `<li>${escapeHtml(error)}</li>`).join('')}</ul>`
          : ''}
      </div>
    `
  }

  const renderDocumentResults = (): string => {
    if (documentResults.length === 0) {
      return ''
    }

    return `
      <div class="settings-card knowledge-settings__results">
        <h4 class="character-settings__section-title">Document results</h4>
        <ul class="knowledge-settings__result-list">
          ${documentResults
            .map(
              (result) => `
                <li data-knowledge-document-status="${escapeHtml(result.status)}">
                  <span>${escapeHtml(result.name)}</span>
                  <small>${escapeHtml(result.status)} · ${result.chunksImported} chunks · ${formatBytes(result.bytes)}${result.error ? ` · ${escapeHtml(result.error)}` : ''}</small>
                </li>
              `
            )
            .join('')}
        </ul>
      </div>
    `
  }

  const handleChange = (event: Event): void => {
    const target = event.target
    if (!(target instanceof HTMLInputElement) || !target.matches('[data-knowledge-files]')) {
      return
    }

    selectedFiles = Array.from(target.files ?? [])
    documentResults = []
    render()
  }

  const handleClick = (event: MouseEvent): void => {
    const target = event.target
    if (!(target instanceof Element)) {
      return
    }

    if (target.closest('[data-knowledge-import]')) {
      void importSelectedFiles()
    }
  }

  const importSelectedFiles = async (): Promise<void> => {
    if (!window.bonzi || selectedFiles.length === 0 || isImporting) {
      return
    }

    const clientError = validateSelectedFiles(selectedFiles)
    if (clientError) {
      options.setStatusMessage(clientError)
      return
    }

    setImporting(true)
    options.setStatusMessage('Reading Markdown files…')
    render()

    try {
      const documents = await Promise.all(
        selectedFiles.map(async (file) => ({
          name: file.name,
          content: await file.text(),
          lastModified: file.lastModified
        }))
      )

      options.setStatusMessage('Importing Markdown knowledge into elizaOS memory…')
      const result = await window.bonzi.settings.importKnowledgeDocuments({ documents })
      status = result.status
      documentResults = result.documents

      if (result.ok) {
        selectedFiles = []
      }

      options.setStatusMessage(result.status.message)
    } catch (error) {
      options.setStatusMessage(`Knowledge import failed: ${String(error)}`)
    } finally {
      setImporting(false)
      render()
    }
  }

  knowledgeSettingsEl.addEventListener('change', handleChange)
  knowledgeSettingsEl.addEventListener('click', handleClick)
  render()

  return {
    hydrate,
    dispose: () => {
      knowledgeSettingsEl.removeEventListener('change', handleChange)
      knowledgeSettingsEl.removeEventListener('click', handleClick)
    }
  }
}

function validateSelectedFiles(files: readonly File[]): string | null {
  if (files.length > MAX_CLIENT_DOCUMENTS) {
    return `Select ${MAX_CLIENT_DOCUMENTS} or fewer Markdown files.`
  }

  let totalBytes = 0

  for (const file of files) {
    totalBytes += file.size

    if (!file.name.toLowerCase().endsWith('.md')) {
      return `Only .md Markdown files can be imported: ${file.name}`
    }

    if (file.size > MAX_CLIENT_DOCUMENT_BYTES) {
      return `Markdown files must be 1 MiB or smaller: ${file.name}`
    }
  }

  if (totalBytes > MAX_CLIENT_TOTAL_BYTES) {
    return 'Selected Markdown files must be 5 MiB or smaller in total.'
  }

  return null
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B'
  }

  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}
