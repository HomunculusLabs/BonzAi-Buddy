import { IPC_CHANNELS } from './channels'

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export type WindowIpcInvokeChannelMap = {
  [IPC_CHANNELS.window.getBounds]: {
    args: []
    response: WindowBounds | null
  }
}

export type WindowIpcSendChannelMap = {
  [IPC_CHANNELS.window.minimize]: {
    args: []
  }
  [IPC_CHANNELS.window.close]: {
    args: []
  }
  [IPC_CHANNELS.window.setPosition]: {
    args: [x: number, y: number]
  }
  [IPC_CHANNELS.window.setBounds]: {
    args: [bounds: WindowBounds]
  }
  [IPC_CHANNELS.window.setMouseEventsIgnored]: {
    args: [ignored: boolean]
  }
}

export interface WindowBridge {
  window: {
    getBounds: () => Promise<WindowBounds | null>
    minimize: () => void
    close: () => void
    setPosition: (x: number, y: number) => void
    setBounds: (bounds: WindowBounds) => void
    setMouseEventsIgnored: (ignored: boolean) => void
  }
}
