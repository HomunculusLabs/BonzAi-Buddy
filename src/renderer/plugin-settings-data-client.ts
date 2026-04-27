import type {
  ElizaPluginInstallRequest,
  ElizaPluginOperationResult,
  ElizaPluginSettings,
  ElizaPluginUninstallRequest,
  ShellState,
  UpdateElizaPluginSettingsRequest
} from '../shared/contracts'

export interface PluginSettingsDataClient {
  isAvailable(): boolean
  discoverPluginSettings(): Promise<ElizaPluginSettings>
  getSavedPluginSettings(): Promise<ElizaPluginSettings>
  updatePluginSettings(
    request: UpdateElizaPluginSettingsRequest
  ): Promise<ElizaPluginSettings>
  installPlugin(request: ElizaPluginInstallRequest): Promise<ElizaPluginOperationResult>
  uninstallPlugin(
    request: ElizaPluginUninstallRequest
  ): Promise<ElizaPluginOperationResult>
  getShellState(): Promise<ShellState>
}

export function createPluginSettingsDataClient(): PluginSettingsDataClient {
  const requireBridge = (): NonNullable<typeof window.bonzi> => {
    if (!window.bonzi) {
      throw new Error('Bonzi bridge unavailable')
    }

    return window.bonzi
  }

  return {
    isAvailable: () => Boolean(window.bonzi),
    discoverPluginSettings: async () => {
      const bridge = requireBridge()
      const discover = bridge.plugins?.discover

      if (typeof discover !== 'function') {
        return bridge.settings.getElizaPlugins()
      }

      try {
        return await discover({
          includeInstalled: true
        } as unknown as Parameters<typeof discover>[0])
      } catch {
        return discover({} as Parameters<typeof discover>[0])
      }
    },
    getSavedPluginSettings: async () => {
      const bridge = requireBridge()
      return bridge.settings.getElizaPlugins()
    },
    updatePluginSettings: async (request) => {
      const bridge = requireBridge()
      return bridge.settings.updateElizaPlugins(request)
    },
    installPlugin: async (request) => {
      const bridge = requireBridge()
      return bridge.plugins.install(request)
    },
    uninstallPlugin: async (request) => {
      const bridge = requireBridge()
      return bridge.plugins.uninstall(request)
    },
    getShellState: async () => {
      const bridge = requireBridge()
      return bridge.app.getShellState()
    }
  }
}
