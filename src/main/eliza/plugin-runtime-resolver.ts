import { app } from 'electron'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Plugin } from '@elizaos/core/node'
import type {
  ElizaPluginExecutionPolicy,
  ElizaPluginLifecycleStatus,
  ElizaPluginSource
} from '../../shared/contracts'
import { isRecord, normalizeError, normalizeOptionalString } from '../../shared/value-utils'
import { resolvePluginWorkspaceDir } from './plugin-installer'
import {
  BonziPluginSettingsStore,
  type BonziPersistedPluginRecordSnapshot
} from './plugin-settings'
import type { BonziWorkflowManager } from './workflow-manager'
import {
  instrumentPluginActionsForWorkflow,
  type WorkflowBonziDesktopActionGateway
} from './workflow-action-instrumentation'

interface BonziPluginRuntimeResolverOptions {
  settingsStore?: BonziPluginSettingsStore
  workspaceDir?: string
  userDataDir?: string
  env?: NodeJS.ProcessEnv
  workflowManager?: BonziWorkflowManager
  bonziDesktopActionGateway?: WorkflowBonziDesktopActionGateway
}

export interface BonziRuntimePluginSelectionMetadata {
  id: string
  packageName?: string
  versionRange?: string
  exportName?: string
  executionPolicy: ElizaPluginExecutionPolicy
  lifecycleStatus: ElizaPluginLifecycleStatus
  source: ElizaPluginSource
}

export interface BonziRuntimePluginResolutionResult {
  plugins: Plugin[]
  metadata: BonziRuntimePluginSelectionMetadata[]
  warnings: string[]
}

export class BonziPluginRuntimeResolver {
  private readonly settingsStore: BonziPluginSettingsStore
  private readonly workspaceDir: string
  private readonly workflowManager: BonziWorkflowManager | null
  private readonly bonziDesktopActionGateway: WorkflowBonziDesktopActionGateway | null

  constructor(options: BonziPluginRuntimeResolverOptions = {}) {
    this.settingsStore = options.settingsStore ?? new BonziPluginSettingsStore()
    this.workspaceDir = resolvePluginWorkspaceDir({
      env: options.env ?? process.env,
      explicit: options.workspaceDir,
      userDataDir: options.userDataDir ?? app.getPath('userData')
    })
    this.workflowManager = options.workflowManager ?? null
    this.bonziDesktopActionGateway = options.bonziDesktopActionGateway ?? null
  }

  getRuntimeSelectionMetadata(): BonziRuntimePluginSelectionMetadata[] {
    return this.getExternalEnabledEntries().map(([id, record]) => ({
      id,
      packageName: record.packageName,
      versionRange: record.versionRange,
      exportName: record.exportName,
      executionPolicy: record.executionPolicy,
      lifecycleStatus: record.lifecycleStatus,
      source: record.source
    }))
  }

  async resolveRuntimePlugins(): Promise<BonziRuntimePluginResolutionResult> {
    const metadata = this.getRuntimeSelectionMetadata()
    const warnings: string[] = []
    const plugins: Plugin[] = []

    if (metadata.length === 0) {
      return { plugins, metadata, warnings }
    }

    const workspacePackageJsonPath = join(this.workspaceDir, 'package.json')

    if (!existsSync(workspacePackageJsonPath)) {
      for (const item of metadata) {
        warnings.push(
          `Plugin "${item.id}" could not be loaded because plugin workspace package.json was not found at ${workspacePackageJsonPath}.`
        )
        this.markPluginLoadFailed(item.id)
      }

      return { plugins, metadata, warnings }
    }

    const requireFromWorkspace = createRequire(workspacePackageJsonPath)

    for (const item of metadata) {
      try {
        if (!item.packageName) {
          throw new Error('Package name is missing from persisted plugin settings.')
        }

        const resolvedPath = requireFromWorkspace.resolve(item.packageName)
        const moduleUrl = pathToFileURL(resolvedPath).href
        const moduleNamespace = (await import(moduleUrl)) as Record<string, unknown>
        const selected = selectPluginExport(moduleNamespace, item.exportName)

        if (!selected) {
          throw new Error(
            item.exportName
              ? `Configured export "${item.exportName}" was not found or is not a valid plugin export.`
              : 'No valid plugin export was found.'
          )
        }

        const runtimePlugin = this.workflowManager
          ? instrumentPluginActionsForWorkflow({
              plugin: selected.plugin,
              pluginId: item.id,
              executionPolicy: item.executionPolicy,
              workflowManager: this.workflowManager,
              bonziDesktopActionGateway: this.bonziDesktopActionGateway ?? undefined
            })
          : selected.plugin

        plugins.push(runtimePlugin)
        this.settingsStore.updateRuntimePluginRecord({
          pluginId: item.id,
          lifecycleStatus: 'enabled',
          capabilities: extractCapabilities(selected.plugin)
        })
      } catch (error) {
        const message = normalizeError(error)
        warnings.push(`Failed to load plugin "${item.id}" (${item.packageName}): ${message}`)
        this.markPluginLoadFailed(item.id)
      }
    }

    return {
      plugins,
      metadata,
      warnings
    }
  }

  private getExternalEnabledEntries(): Array<[string, BonziPersistedPluginRecordSnapshot]> {
    const persisted = this.settingsStore.getPersistedPluginInventorySnapshot()

    return Object.entries(persisted)
      .filter(([, record]) => {
        return (
          record.installed &&
          record.enabled &&
          record.source !== 'required' &&
          record.source !== 'bonzi-builtin'
        )
      })
      .sort(([left], [right]) => left.localeCompare(right))
  }

  private markPluginLoadFailed(pluginId: string): void {
    try {
      this.settingsStore.updateRuntimePluginRecord({
        pluginId,
        lifecycleStatus: 'load_failed'
      })
    } catch {
      // Keep runtime boot resilient even if settings writes fail.
    }
  }
}

function selectPluginExport(
  moduleNamespace: Record<string, unknown>,
  configuredExportName: string | undefined
): { plugin: Plugin; exportName: string } | null {
  const normalizedConfiguredExportName = normalizeOptionalString(configuredExportName)

  if (normalizedConfiguredExportName) {
    const configuredExport = moduleNamespace[normalizedConfiguredExportName]
    if (!isPluginLike(configuredExport)) {
      return null
    }

    return {
      plugin: configuredExport,
      exportName: normalizedConfiguredExportName
    }
  }

  const defaultExport = moduleNamespace.default
  if (isPluginLike(defaultExport)) {
    return {
      plugin: defaultExport,
      exportName: 'default'
    }
  }

  for (const [exportName, candidate] of Object.entries(moduleNamespace)) {
    if (exportName === 'default') {
      continue
    }

    if (!isPluginLike(candidate)) {
      continue
    }

    return {
      plugin: candidate,
      exportName
    }
  }

  return null
}

function isPluginLike(value: unknown): value is Plugin {
  if (!isRecord(value)) {
    return false
  }

  if (typeof value.name !== 'string' || value.name.trim().length === 0) {
    return false
  }

  for (const key of ['actions', 'providers', 'evaluators', 'services', 'routes']) {
    if (value[key] !== undefined && !Array.isArray(value[key])) {
      return false
    }
  }

  if (value.models !== undefined && !isRecord(value.models)) {
    return false
  }

  return true
}

function extractCapabilities(plugin: Plugin): string[] | undefined {
  const capabilities: string[] = []

  if (Array.isArray(plugin.actions) && plugin.actions.length > 0) {
    capabilities.push('actions')
  }

  if (Array.isArray(plugin.providers) && plugin.providers.length > 0) {
    capabilities.push('providers')
  }

  if (Array.isArray(plugin.evaluators) && plugin.evaluators.length > 0) {
    capabilities.push('evaluators')
  }

  if (Array.isArray(plugin.services) && plugin.services.length > 0) {
    capabilities.push('services')
  }

  if (Array.isArray(plugin.routes) && plugin.routes.length > 0) {
    capabilities.push('routes')
  }

  if (isRecord(plugin.models) && Object.keys(plugin.models).length > 0) {
    capabilities.push('models')
  }

  return capabilities.length > 0 ? capabilities : undefined
}

