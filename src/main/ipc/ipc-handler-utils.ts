import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import type { AssistantService } from '../assistant'
import type {
  IpcInvokeArgs,
  IpcInvokeChannel,
  IpcInvokeResponse,
  IpcSendArgs,
  IpcSendChannel
} from '../../shared/ipc-contracts'

export interface IpcHandlerContext {
  assistantService: AssistantService
}

export function handleInvoke<Channel extends IpcInvokeChannel>(
  channel: Channel,
  listener: (
    event: IpcMainInvokeEvent,
    ...args: IpcInvokeArgs<Channel>
  ) => IpcInvokeResponse<Channel> | Promise<IpcInvokeResponse<Channel>>
): void {
  ipcMain.handle(
    channel,
    listener as (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  )
}

export function onSend<Channel extends IpcSendChannel>(
  channel: Channel,
  listener: (event: IpcMainEvent, ...args: IpcSendArgs<Channel>) => void
): void {
  ipcMain.on(
    channel,
    listener as (event: IpcMainEvent, ...args: unknown[]) => void
  )
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
