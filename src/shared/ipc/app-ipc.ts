import type { ShellState } from '../contracts/shell'
import { IPC_CHANNELS } from './channels'

export type AppIpcInvokeChannelMap = {
  [IPC_CHANNELS.app.getShellState]: {
    args: []
    response: ShellState
  }
}

export interface AppBridge {
  app: {
    getShellState: () => Promise<ShellState>
  }
}
