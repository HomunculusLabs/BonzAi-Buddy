import type {
  KnowledgeImportDocumentResult,
  KnowledgeImportFolderSelection,
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
const MAX_FOLDER_DOCUMENTS = 10_000
const STATUS_POLL_MS = 2000
const MAX_RENDERED_DOCUMENT_RESULTS = 20
const TERMINAL_IMPORT_STATES = new Set<KnowledgeImportStatus['state']>([
  'succeeded',
  'partial_failed',
  'failed',
  'cancelled'
])
const ACTIVE_RESULT_SUPPRESSION_STATES = new Set<KnowledgeImportStatus['state']>([
  'scanning',
  'importing',
  'cancel_requested'
])

export function createKnowledgeSettingsController(
  options: KnowledgeSettingsControllerOptions
): KnowledgeSettingsController {
  const { knowledgeSettingsEl } = options
  let status: KnowledgeImportStatus | null = null
  let documentResults: KnowledgeImportDocumentResult[] = []
  let selectedFiles: File[] = []
  let selectedFolders: KnowledgeImportFolderSelection[] = []
  let selectedFolderSelectionId: string | null = null
  let isImporting = false
  let isHydrated = false
  let pollTimer: number | null = null
  let pollInFlight = false
  let lastImportId: string | null = null

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
      lastImportId = status.importId ?? lastImportId
      if (isActiveImport(status)) {
        setImporting(true)
        startPolling()
      }
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
    const canImportFiles = bridgeAvailable && selectedFiles.length > 0 && !isImporting
    const canImportFolders = bridgeAvailable && selectedFolders.length > 0 && !isImporting
    const canCancel = bridgeAvailable && Boolean(status?.cancellable)

    knowledgeSettingsEl.innerHTML = `
      <div class="knowledge-settings__intro">
        <div class="settings-panel__section-header">
          <h3 class="settings-panel__section-title">Knowledge import</h3>
          <p class="settings-panel__section-copy">
            Import Markdown into elizaOS runtime memory/RAG. Folder imports are scanned and read in the main process; paths and Markdown are not saved in Bonzi settings.
          </p>
        </div>
      </div>

      <div class="settings-card knowledge-settings__card knowledge-settings__folder-card">
        <div class="knowledge-settings__card-header">
          <div>
            <strong>Folder import</strong>
            <small>Choose one or more folders. Bonzi recursively imports up to ${MAX_FOLDER_DOCUMENTS.toLocaleString()} .md files, skipping symlinks and common vendor/build directories.</small>
          </div>
          <button
            class="settings-button"
            type="button"
            data-knowledge-choose-folders
            ${disabled}
          >Choose folders…</button>
        </div>
        ${renderSelectedFolders()}
        <div class="knowledge-settings__actions">
          <button
            class="settings-button settings-button--primary"
            type="button"
            data-knowledge-import-folders
            ${canImportFolders ? '' : 'disabled'}
          >${isImporting ? 'Import running…' : 'Import folder Markdown'}</button>
          <button
            class="settings-button settings-button--danger"
            type="button"
            data-knowledge-cancel
            ${canCancel ? '' : 'disabled'}
          >Cancel import</button>
        </div>
      </div>

      <div class="settings-card knowledge-settings__card knowledge-settings__file-card">
        <label class="knowledge-settings__file-field">
          <span>
            <strong>Small direct file import</strong>
            <small>Secondary path for up to ${MAX_CLIENT_DOCUMENTS} .md files, max 1 MiB each / 5 MiB total.</small>
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
            class="settings-button"
            type="button"
            data-knowledge-import
            ${canImportFiles ? '' : 'disabled'}
          >${isImporting ? 'Importing…' : 'Import selected files'}</button>
        </div>
      </div>

      ${renderStatus()}
      ${renderDocumentResults()}
    `
  }

  const renderSelectedFolders = (): string => {
    if (selectedFolders.length === 0) {
      return '<p class="knowledge-settings__empty">No folders selected.</p>'
    }

    return `
      <ul class="knowledge-settings__file-list knowledge-settings__folder-list">
        ${selectedFolders
          .map(
            (folder) => `
              <li>
                <span>${escapeHtml(folder.name)}</span>
                <small>${escapeHtml(folder.path)}</small>
              </li>
            `
          )
          .join('')}
      </ul>
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
        <h4 class="character-settings__section-title">Knowledge import status</h4>
        <p>${escapeHtml(currentStatus.message)}</p>
        ${currentStatus.recovered && typeof currentStatus.knowledgeMemoryCount === 'number'
          ? `<p class="knowledge-settings__library-note">Recovered from persisted elizaOS knowledge memory after restart: ${currentStatus.knowledgeMemoryCount.toLocaleString()} chunk${currentStatus.knowledgeMemoryCount === 1 ? '' : 's'} available.</p>`
          : ''}
        ${renderProgress(currentStatus)}
        <dl class="knowledge-settings__stats">
          <div><dt>State</dt><dd>${escapeHtml(currentStatus.state)}</dd></div>
          <div><dt>Files</dt><dd>${formatProgressCount(currentStatus.processedDocuments, currentStatus.totalDocuments)}</dd></div>
          <div><dt>Documents</dt><dd>${currentStatus.importedDocuments} imported · ${currentStatus.skippedDocuments} skipped · ${currentStatus.failedDocuments} failed</dd></div>
          <div><dt>Chunks</dt><dd>${currentStatus.importedChunks}</dd></div>
          ${typeof currentStatus.knowledgeMemoryCount === 'number'
            ? `<div><dt>Library chunks</dt><dd>${currentStatus.knowledgeMemoryCount.toLocaleString()}</dd></div>`
            : ''}
          <div><dt>Discovered</dt><dd>${currentStatus.discoveredDocuments ?? currentStatus.totalDocuments ?? 0}</dd></div>
          <div><dt>Errors</dt><dd>${currentStatus.errorCount ?? currentStatus.errors.length}</dd></div>
        </dl>
        ${currentStatus.currentDocumentRelativePath
          ? `<p class="knowledge-settings__current-file">Current: ${escapeHtml(currentStatus.currentDocumentRelativePath)}</p>`
          : ''}
        ${currentStatus.errors.length > 0
          ? `<ul class="knowledge-settings__errors">${currentStatus.errors.map((error) => `<li>${escapeHtml(error)}</li>`).join('')}</ul>`
          : ''}
      </div>
    `
  }

  const renderProgress = (currentStatus: KnowledgeImportStatus): string => {
    if (!isActiveImport(currentStatus)) {
      return ''
    }

    const total = currentStatus.totalDocuments ?? currentStatus.discoveredDocuments ?? 0
    const processed = currentStatus.processedDocuments ?? 0
    const percent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0

    return `
      <div class="knowledge-settings__progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">
        <span style="width: ${percent}%"></span>
      </div>
    `
  }

  const renderDocumentResults = (): string => {
    if (status && ACTIVE_RESULT_SUPPRESSION_STATES.has(status.state)) {
      return ''
    }

    const hasImmediateResults = documentResults.length > 0
    const results = hasImmediateResults
      ? documentResults
      : status?.recentDocuments ?? []

    if (results.length === 0) {
      return ''
    }

    const renderedResults = results.slice(-MAX_RENDERED_DOCUMENT_RESULTS)
    const statusResultCount = status
      ? status.importedDocuments + status.skippedDocuments + status.failedDocuments
      : results.length
    const totalResultCount = hasImmediateResults
      ? Math.max(documentResults.length, statusResultCount)
      : Math.max(results.length, statusResultCount)
    const hasAdditionalResults = totalResultCount > renderedResults.length

    return `
      <div class="settings-card knowledge-settings__results">
        <h4 class="character-settings__section-title">Recent document results</h4>
        ${hasAdditionalResults
          ? `<p class="knowledge-settings__results-note">Showing last ${renderedResults.length.toLocaleString()} results (of ${totalResultCount.toLocaleString()}).</p>`
          : ''}
        <ul class="knowledge-settings__result-list">
          ${renderedResults
            .map(
              (result) => `
                <li data-knowledge-document-status="${escapeHtml(result.status)}">
                  <span>${escapeHtml(result.relativePath ?? result.name)}</span>
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

    if (target.closest('[data-knowledge-choose-folders]')) {
      void chooseFolders()
      return
    }

    if (target.closest('[data-knowledge-import-folders]')) {
      void importSelectedFolders()
      return
    }

    if (target.closest('[data-knowledge-cancel]')) {
      void cancelImport()
      return
    }

    if (target.closest('[data-knowledge-import]')) {
      void importSelectedFiles()
    }
  }

  const chooseFolders = async (): Promise<void> => {
    if (!window.bonzi || isImporting) {
      return
    }

    try {
      const result = await window.bonzi.settings.selectKnowledgeImportFolders()

      if (!result.ok) {
        options.setStatusMessage(result.error ?? result.message ?? 'Failed to select folders.')
        return
      }

      if (!result.cancelled) {
        selectedFolders = result.folders
        selectedFolderSelectionId = result.selectionId ?? null
        documentResults = []
      }

      options.setStatusMessage(result.message ?? 'Folder selection updated.')
      render()
    } catch (error) {
      options.setStatusMessage(`Failed to select folders: ${String(error)}`)
    }
  }

  const importSelectedFolders = async (): Promise<void> => {
    if (!window.bonzi || selectedFolders.length === 0 || isImporting) {
      return
    }

    setImporting(true)
    options.setStatusMessage('Starting Markdown folder import…')
    documentResults = []
    render()

    try {
      const result = await window.bonzi.settings.importKnowledgeFolders({
        folderSelectionId: selectedFolderSelectionId ?? undefined
      })
      status = result.status
      lastImportId = result.importId ?? result.status.importId ?? null
      options.setStatusMessage(result.message)

      if (!result.ok) {
        setImporting(false)
        render()
        return
      }

      selectedFolders = []
      selectedFolderSelectionId = null
      startPolling()
      render()
    } catch (error) {
      setImporting(false)
      options.setStatusMessage(`Knowledge folder import failed to start: ${String(error)}`)
      render()
    }
  }

  const cancelImport = async (): Promise<void> => {
    if (!window.bonzi || !status?.cancellable) {
      return
    }

    try {
      const result = await window.bonzi.settings.cancelKnowledgeImport({
        importId: status.importId ?? lastImportId ?? undefined
      })
      status = result.status
      options.setStatusMessage(result.message)
      if (result.ok) {
        startPolling()
      }
      render()
    } catch (error) {
      options.setStatusMessage(`Failed to cancel knowledge import: ${String(error)}`)
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
      lastImportId = result.status.importId ?? lastImportId
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

  const startPolling = (): void => {
    if (pollTimer !== null) {
      return
    }

    pollTimer = window.setInterval(() => {
      void pollStatus()
    }, STATUS_POLL_MS)
    void pollStatus()
  }

  const stopPolling = (): void => {
    if (pollTimer === null) {
      return
    }

    window.clearInterval(pollTimer)
    pollTimer = null
  }

  const pollStatus = async (): Promise<void> => {
    if (!window.bonzi || pollInFlight) {
      return
    }

    pollInFlight = true
    try {
      status = await window.bonzi.settings.getKnowledgeImportStatus()
      lastImportId = status.importId ?? lastImportId

      if (!isActiveImport(status)) {
        stopPolling()
        setImporting(false)
        options.setStatusMessage(status.message)
      }

      render()
    } catch (error) {
      stopPolling()
      setImporting(false)
      options.setStatusMessage(`Failed to refresh knowledge import status: ${String(error)}`)
      render()
    } finally {
      pollInFlight = false
    }
  }

  knowledgeSettingsEl.addEventListener('change', handleChange)
  knowledgeSettingsEl.addEventListener('click', handleClick)
  render()

  return {
    hydrate,
    dispose: () => {
      stopPolling()
      setImporting(false)
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

function isActiveImport(status: KnowledgeImportStatus): boolean {
  return !TERMINAL_IMPORT_STATES.has(status.state) && status.state !== 'idle'
}

function formatProgressCount(done: number | undefined, total: number | undefined): string {
  if (typeof total === 'number' && total > 0) {
    return `${done ?? 0} / ${total}`
  }

  return `${done ?? 0}`
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
