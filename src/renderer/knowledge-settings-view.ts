import type {
  KnowledgeImportDocumentResult,
  KnowledgeImportFolderSelection,
  KnowledgeImportStatus
} from '../shared/contracts/knowledge'
import { escapeHtml } from './html-utils'

const MAX_FOLDER_DOCUMENTS = 10_000
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

export interface KnowledgeSettingsViewModel {
  status: KnowledgeImportStatus | null
  documentResults: KnowledgeImportDocumentResult[]
  selectedFiles: File[]
  selectedFolders: KnowledgeImportFolderSelection[]
  isImporting: boolean
  isHydrated: boolean
  bridgeAvailable: boolean
}

export function renderKnowledgeSettings(
  container: HTMLElement,
  viewModel: KnowledgeSettingsViewModel
): void {
  const disabled = !viewModel.bridgeAvailable || viewModel.isImporting ? 'disabled' : ''
  const canImportFiles =
    viewModel.bridgeAvailable &&
    viewModel.selectedFiles.length > 0 &&
    !viewModel.isImporting
  const canImportFolders =
    viewModel.bridgeAvailable &&
    viewModel.selectedFolders.length > 0 &&
    !viewModel.isImporting
  const canCancel = viewModel.bridgeAvailable && Boolean(viewModel.status?.cancellable)

  container.innerHTML = `
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
      ${renderSelectedFolders(viewModel.selectedFolders)}
      <div class="knowledge-settings__actions">
        <button
          class="settings-button settings-button--primary"
          type="button"
          data-knowledge-import-folders
          ${canImportFolders ? '' : 'disabled'}
        >${viewModel.isImporting ? 'Import running…' : 'Import folder Markdown'}</button>
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
          <small>Secondary path for up to 20 .md files, max 1 MiB each / 5 MiB total.</small>
        </span>
        <input
          type="file"
          accept=".md,text/markdown"
          multiple
          data-knowledge-files
          ${disabled}
        />
      </label>
      ${renderSelectedFiles(viewModel.selectedFiles)}
      <div class="knowledge-settings__actions">
        <button
          class="settings-button"
          type="button"
          data-knowledge-import
          ${canImportFiles ? '' : 'disabled'}
        >${viewModel.isImporting ? 'Importing…' : 'Import selected files'}</button>
      </div>
    </div>

    ${renderStatus(viewModel.status, viewModel.isHydrated)}
    ${renderDocumentResults(viewModel.status, viewModel.documentResults)}
  `
}

function renderSelectedFolders(
  selectedFolders: readonly KnowledgeImportFolderSelection[]
): string {
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

function renderSelectedFiles(selectedFiles: readonly File[]): string {
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

function renderStatus(
  status: KnowledgeImportStatus | null,
  isHydrated: boolean
): string {
  if (!isHydrated || !status) {
    return '<p class="settings-panel__empty">Knowledge import status is loading…</p>'
  }

  return `
    <div class="settings-card knowledge-settings__status" data-knowledge-status-state="${escapeHtml(status.state)}">
      <h4 class="character-settings__section-title">Knowledge import status</h4>
      <p>${escapeHtml(status.message)}</p>
      ${status.recovered && typeof status.knowledgeMemoryCount === 'number'
        ? `<p class="knowledge-settings__library-note">Recovered from persisted elizaOS knowledge memory after restart: ${status.knowledgeMemoryCount.toLocaleString()} chunk${status.knowledgeMemoryCount === 1 ? '' : 's'} available.</p>`
        : ''}
      ${renderProgress(status)}
      <dl class="knowledge-settings__stats">
        <div><dt>State</dt><dd>${escapeHtml(status.state)}</dd></div>
        <div><dt>Files</dt><dd>${formatProgressCount(status.processedDocuments, status.totalDocuments)}</dd></div>
        <div><dt>Documents</dt><dd>${status.importedDocuments} imported · ${status.skippedDocuments} skipped · ${status.failedDocuments} failed</dd></div>
        <div><dt>Chunks</dt><dd>${status.importedChunks}</dd></div>
        ${typeof status.knowledgeMemoryCount === 'number'
          ? `<div><dt>Library chunks</dt><dd>${status.knowledgeMemoryCount.toLocaleString()}</dd></div>`
          : ''}
        <div><dt>Discovered</dt><dd>${status.discoveredDocuments ?? status.totalDocuments ?? 0}</dd></div>
        <div><dt>Errors</dt><dd>${status.errorCount ?? status.errors.length}</dd></div>
      </dl>
      ${status.currentDocumentRelativePath
        ? `<p class="knowledge-settings__current-file">Current: ${escapeHtml(status.currentDocumentRelativePath)}</p>`
        : ''}
      ${status.errors.length > 0
        ? `<ul class="knowledge-settings__errors">${status.errors.map((error) => `<li>${escapeHtml(error)}</li>`).join('')}</ul>`
        : ''}
    </div>
  `
}

function renderProgress(status: KnowledgeImportStatus): string {
  if (!isActiveImport(status)) {
    return ''
  }

  const total = status.totalDocuments ?? status.discoveredDocuments ?? 0
  const processed = status.processedDocuments ?? 0
  const percent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0

  return `
    <div class="knowledge-settings__progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">
      <span style="width: ${percent}%"></span>
    </div>
  `
}

function renderDocumentResults(
  status: KnowledgeImportStatus | null,
  documentResults: readonly KnowledgeImportDocumentResult[]
): string {
  if (status && ACTIVE_RESULT_SUPPRESSION_STATES.has(status.state)) {
    return ''
  }

  const hasImmediateResults = documentResults.length > 0
  const results = hasImmediateResults ? documentResults : status?.recentDocuments ?? []

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
