import {
  ASSISTANT_ACTION_TYPES,
  type AssistantActionType,
  type AssistantProviderInfo,
  type ElizaCharacterSettings,
  type ElizaPluginDiscoveryRequest,
  type ElizaPluginInstallRequest,
  type ElizaPluginOperationResult,
  type ElizaPluginSettings,
  type ElizaPluginUninstallRequest,
  type RuntimeApprovalSettings,
  type UpdateElizaCharacterSettingsRequest,
  type UpdateElizaPluginSettingsRequest,
  type UpdateRuntimeApprovalSettingsRequest
} from '../../shared/contracts'
import type { BonziPluginDiscoveryService } from './plugin-discovery'
import type { BonziPluginInstallationService } from './plugin-installer'
import type { BonziPluginSettingsStore } from './plugin-settings'

interface RuntimePluginOperationsOptions {
  settingsStore: BonziPluginSettingsStore
  discoveryService: BonziPluginDiscoveryService
  installationService: BonziPluginInstallationService
  getProviderInfo: () => AssistantProviderInfo
  waitForRuntimeInitialization: () => Promise<void>
  invalidateRuntimeConfig: () => void
  setWorkflowApprovalsEnabled: (enabled: boolean) => void
}

export class BonziRuntimePluginOperations {
  private readonly settingsStore: BonziPluginSettingsStore
  private readonly discoveryService: BonziPluginDiscoveryService
  private readonly installationService: BonziPluginInstallationService
  private readonly getProviderInfo: () => AssistantProviderInfo
  private readonly waitForRuntimeInitialization: () => Promise<void>
  private readonly invalidateRuntimeConfig: () => void
  private readonly setWorkflowApprovalsEnabled: (enabled: boolean) => void

  constructor(options: RuntimePluginOperationsOptions) {
    this.settingsStore = options.settingsStore
    this.discoveryService = options.discoveryService
    this.installationService = options.installationService
    this.getProviderInfo = options.getProviderInfo
    this.waitForRuntimeInitialization = options.waitForRuntimeInitialization
    this.invalidateRuntimeConfig = options.invalidateRuntimeConfig
    this.setWorkflowApprovalsEnabled = options.setWorkflowApprovalsEnabled
  }

  getPluginSettings(): ElizaPluginSettings {
    return this.settingsStore.getSettings(this.getProviderInfo())
  }

  getRuntimeApprovalSettings(): RuntimeApprovalSettings {
    return this.settingsStore.getRuntimeApprovalSettings()
  }

  updateRuntimeApprovalSettings(
    request: UpdateRuntimeApprovalSettingsRequest
  ): RuntimeApprovalSettings {
    const settings = this.settingsStore.updateRuntimeApprovalSettings(request)
    this.setWorkflowApprovalsEnabled(settings.approvalsEnabled)
    this.invalidateRuntimeConfig()
    return settings
  }

  getCharacterSettings(): ElizaCharacterSettings {
    return this.settingsStore.getCharacterSettings()
  }

  updateCharacterSettings(
    request: UpdateElizaCharacterSettingsRequest
  ): ElizaCharacterSettings {
    const settings = this.settingsStore.updateCharacterSettings(request)
    this.invalidateRuntimeConfig()
    return settings
  }

  async discoverPlugins(
    request: ElizaPluginDiscoveryRequest = {}
  ): Promise<ElizaPluginSettings> {
    return this.discoveryService.discover(this.getProviderInfo(), request)
  }

  async updatePluginSettings(
    request: UpdateElizaPluginSettingsRequest
  ): Promise<ElizaPluginSettings> {
    const settings = this.settingsStore.updateSettings(
      request,
      this.getProviderInfo()
    )

    await this.waitForRuntimeInitialization()
    this.invalidateRuntimeConfig()

    return settings
  }

  async installPlugin(
    request: ElizaPluginInstallRequest
  ): Promise<ElizaPluginOperationResult> {
    const result = await this.installationService.install(
      this.getProviderInfo(),
      request
    )

    if (result.ok) {
      this.invalidateRuntimeConfig()
    }

    return result
  }

  async uninstallPlugin(
    request: ElizaPluginUninstallRequest
  ): Promise<ElizaPluginOperationResult> {
    const effectiveRequest = this.getRuntimeApprovalSettings().approvalsEnabled
      ? request
      : { ...request, confirmed: true }
    const result = await this.installationService.uninstall(
      this.getProviderInfo(),
      effectiveRequest
    )

    if (result.ok) {
      this.invalidateRuntimeConfig()
    }

    return result
  }

  getAvailableActionTypes(): AssistantActionType[] {
    const settings = this.settingsStore.getRuntimeSettings()
    return settings.desktopActionsEnabled ? [...ASSISTANT_ACTION_TYPES] : []
  }
}
