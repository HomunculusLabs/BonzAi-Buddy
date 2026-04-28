export { IPC_CHANNELS } from './ipc/channels'
export type { WindowBounds } from './ipc/window-ipc'

import type { AppBridge, AppIpcInvokeChannelMap } from './ipc/app-ipc'
import type {
  AssistantBridge,
  AssistantIpcInvokeChannelMap,
  AssistantIpcRendererEventChannelMap
} from './ipc/assistant-ipc'
import type {
  PluginsBridge,
  PluginsIpcInvokeChannelMap
} from './ipc/plugins-ipc'
import type {
  SettingsBridge,
  SettingsIpcInvokeChannelMap
} from './ipc/settings-ipc'
import type {
  WindowBridge,
  WindowIpcInvokeChannelMap,
  WindowIpcSendChannelMap
} from './ipc/window-ipc'

export type IpcInvokeChannelMap = AppIpcInvokeChannelMap &
  SettingsIpcInvokeChannelMap &
  PluginsIpcInvokeChannelMap &
  WindowIpcInvokeChannelMap &
  AssistantIpcInvokeChannelMap

export type IpcSendChannelMap = WindowIpcSendChannelMap

export type IpcRendererEventChannelMap = AssistantIpcRendererEventChannelMap

export type IpcInvokeChannel = keyof IpcInvokeChannelMap
export type IpcSendChannel = keyof IpcSendChannelMap
export type IpcRendererEventChannel = keyof IpcRendererEventChannelMap

export type IpcInvokeArgs<Channel extends IpcInvokeChannel> =
  IpcInvokeChannelMap[Channel]['args']

export type IpcInvokeResponse<Channel extends IpcInvokeChannel> =
  IpcInvokeChannelMap[Channel]['response']

export type IpcSendArgs<Channel extends IpcSendChannel> =
  IpcSendChannelMap[Channel]['args']

export type IpcRendererEventArgs<Channel extends IpcRendererEventChannel> =
  IpcRendererEventChannelMap[Channel]['args']

export interface BonziBridge
  extends AppBridge,
    SettingsBridge,
    PluginsBridge,
    WindowBridge,
    AssistantBridge {}
