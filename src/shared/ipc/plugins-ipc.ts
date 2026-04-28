import type {
  ElizaPluginDiscoveryRequest,
  ElizaPluginInstallRequest,
  ElizaPluginOperationResult,
  ElizaPluginSettings,
  ElizaPluginUninstallRequest
} from '../contracts/plugins'
import { IPC_CHANNELS } from './channels'

export type PluginsIpcInvokeChannelMap = {
  [IPC_CHANNELS.plugins.discover]: {
    args: [request?: ElizaPluginDiscoveryRequest]
    response: ElizaPluginSettings
  }
  [IPC_CHANNELS.plugins.install]: {
    args: [request: ElizaPluginInstallRequest]
    response: ElizaPluginOperationResult
  }
  [IPC_CHANNELS.plugins.uninstall]: {
    args: [request: ElizaPluginUninstallRequest]
    response: ElizaPluginOperationResult
  }
}

export interface PluginsBridge {
  plugins: {
    discover: (request?: ElizaPluginDiscoveryRequest) => Promise<ElizaPluginSettings>
    install: (
      request: ElizaPluginInstallRequest
    ) => Promise<ElizaPluginOperationResult>
    uninstall: (
      request: ElizaPluginUninstallRequest
    ) => Promise<ElizaPluginOperationResult>
  }
}
