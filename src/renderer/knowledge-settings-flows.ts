import { createKnowledgeSettingsDataClient } from './knowledge-settings-data-client'
import {
  isActiveImport,
  type KnowledgeSettingsState
} from './knowledge-settings-state'

const MAX_CLIENT_DOCUMENT_BYTES = 1024 * 1024
const MAX_CLIENT_TOTAL_BYTES = 5 * 1024 * 1024
const MAX_CLIENT_DOCUMENTS = 20
const STATUS_POLL_MS = 2000

interface KnowledgeSettingsFlowsOptions {
  state: KnowledgeSettingsState
  client?: ReturnType<typeof createKnowledgeSettingsDataClient>
  setStatusMessage(message: string): void
  onSavingChange(saving: boolean): void
}

export interface KnowledgeSettingsFlows {
  hydrate(): Promise<void>
  setSelectedFiles(files: File[]): void
  chooseFolders(): Promise<void>
  importSelectedFolders(): Promise<void>
  cancelImport(): Promise<void>
  importSelectedFiles(): Promise<void>
  dispose(): void
}

export function createKnowledgeSettingsFlows(
  options: KnowledgeSettingsFlowsOptions
): KnowledgeSettingsFlows {
  const client = options.client ?? createKnowledgeSettingsDataClient()
  let pollTimer: number | null = null
  let pollInFlight = false

  const setImporting = (importing: boolean): void => {
    options.state.setImporting(importing)
    options.onSavingChange(importing)
  }

  const hydrate = async (): Promise<void> => {
    if (!client.isAvailable()) {
      options.state.setHydrated(true)
      options.state.render()
      return
    }

    try {
      const status = await client.getStatus()
      options.state.setStatus(status)
      if (isActiveImport(status)) {
        setImporting(true)
        startPolling()
      }
      options.state.setHydrated(true)
      options.state.render()
    } catch (error) {
      options.state.setHydrated(true)
      options.setStatusMessage(`Failed to load knowledge import status: ${String(error)}`)
      options.state.render()
    }
  }

  const setSelectedFiles = (files: File[]): void => {
    options.state.setSelectedFiles(files)
    options.state.setDocumentResults([])
    options.state.render()
  }

  const chooseFolders = async (): Promise<void> => {
    if (!client.isAvailable() || options.state.isImporting()) {
      return
    }

    try {
      const result = await client.selectFolders()

      if (!result.ok) {
        options.setStatusMessage(result.error ?? result.message ?? 'Failed to select folders.')
        return
      }

      if (!result.cancelled) {
        options.state.setSelectedFolders(result.folders)
        options.state.setSelectedFolderSelectionId(result.selectionId ?? null)
        options.state.setDocumentResults([])
      }

      options.setStatusMessage(result.message ?? 'Folder selection updated.')
      options.state.render()
    } catch (error) {
      options.setStatusMessage(`Failed to select folders: ${String(error)}`)
    }
  }

  const importSelectedFolders = async (): Promise<void> => {
    if (
      !client.isAvailable() ||
      options.state.getSelectedFolders().length === 0 ||
      options.state.isImporting()
    ) {
      return
    }

    setImporting(true)
    options.setStatusMessage('Starting Markdown folder import…')
    options.state.setDocumentResults([])
    options.state.render()

    try {
      const result = await client.importFolders({
        folderSelectionId:
          options.state.getSelectedFolderSelectionId() ?? undefined
      })
      options.state.setStatus(result.status)
      options.state.setLastImportId(
        result.importId ?? result.status.importId ?? null
      )
      options.setStatusMessage(result.message)

      if (!result.ok) {
        setImporting(false)
        options.state.render()
        return
      }

      options.state.setSelectedFolders([])
      options.state.setSelectedFolderSelectionId(null)
      startPolling()
      options.state.render()
    } catch (error) {
      setImporting(false)
      options.setStatusMessage(
        `Knowledge folder import failed to start: ${String(error)}`
      )
      options.state.render()
    }
  }

  const cancelImport = async (): Promise<void> => {
    const status = options.state.getStatus()
    if (!client.isAvailable() || !status?.cancellable) {
      return
    }

    try {
      const result = await client.cancelImport({
        importId: status.importId ?? options.state.getLastImportId() ?? undefined
      })
      options.state.setStatus(result.status)
      options.setStatusMessage(result.message)
      if (result.ok) {
        startPolling()
      }
      options.state.render()
    } catch (error) {
      options.setStatusMessage(`Failed to cancel knowledge import: ${String(error)}`)
    }
  }

  const importSelectedFiles = async (): Promise<void> => {
    const selectedFiles = options.state.getSelectedFiles()

    if (!client.isAvailable() || selectedFiles.length === 0 || options.state.isImporting()) {
      return
    }

    const clientError = validateSelectedFiles(selectedFiles)
    if (clientError) {
      options.setStatusMessage(clientError)
      return
    }

    setImporting(true)
    options.setStatusMessage('Reading Markdown files…')
    options.state.render()

    try {
      const documents = await Promise.all(
        selectedFiles.map(async (file) => ({
          name: file.name,
          content: await file.text(),
          lastModified: file.lastModified
        }))
      )

      options.setStatusMessage('Importing Markdown knowledge into elizaOS memory…')
      const result = await client.importDocuments({ documents })
      options.state.setStatus(result.status)
      options.state.syncLastImportIdFromStatus(result.status)
      options.state.setDocumentResults(result.documents)

      if (result.ok) {
        options.state.setSelectedFiles([])
      }

      options.setStatusMessage(result.status.message)
    } catch (error) {
      options.setStatusMessage(`Knowledge import failed: ${String(error)}`)
    } finally {
      setImporting(false)
      options.state.render()
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
    if (!client.isAvailable() || pollInFlight) {
      return
    }

    pollInFlight = true
    try {
      const status = await client.getStatus()
      options.state.setStatus(status)

      if (!isActiveImport(status)) {
        stopPolling()
        setImporting(false)
        options.setStatusMessage(status.message)
      }

      options.state.render()
    } catch (error) {
      stopPolling()
      setImporting(false)
      options.setStatusMessage(
        `Failed to refresh knowledge import status: ${String(error)}`
      )
      options.state.render()
    } finally {
      pollInFlight = false
    }
  }

  const dispose = (): void => {
    stopPolling()
    setImporting(false)
  }

  return {
    hydrate,
    setSelectedFiles,
    chooseFolders,
    importSelectedFolders,
    cancelImport,
    importSelectedFiles,
    dispose
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
