import { IPC_CHANNELS } from '../../shared/ipc-contracts'
import { handleInvoke, type IpcHandlerContext } from './ipc-handler-utils'

export function registerPluginsIpcHandlers({
  assistantService
}: IpcHandlerContext): void {
  handleInvoke(IPC_CHANNELS.plugins.discover, async (_event, request) => {
    return assistantService.discoverPlugins(request)
  })

  handleInvoke(IPC_CHANNELS.plugins.install, async (_event, request) => {
    return assistantService.installPlugin(request)
  })

  handleInvoke(IPC_CHANNELS.plugins.uninstall, async (_event, request) => {
    return assistantService.uninstallPlugin(request)
  })
}
