import { buildShellState } from '../shell-state'
import { IPC_CHANNELS } from '../../shared/ipc-contracts'
import { handleInvoke, type IpcHandlerContext } from './ipc-handler-utils'

export function registerAppIpcHandlers({
  assistantService
}: IpcHandlerContext): void {
  handleInvoke(IPC_CHANNELS.app.getShellState, () => {
    return buildShellState(
      assistantService.getProviderInfo(),
      assistantService.getStartupWarnings(),
      assistantService.getRuntimeStatus(),
      assistantService.getAvailableActionTypes(),
      assistantService.getRuntimeApprovalSettings()
    )
  })
}
