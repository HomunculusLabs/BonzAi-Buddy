import type { AssistantService } from './assistant'
import { registerAppIpcHandlers } from './ipc/app-handlers'
import { registerAssistantIpcHandlers } from './ipc/assistant-handlers'
import { registerPluginsIpcHandlers } from './ipc/plugins-handlers'
import { registerSettingsIpcHandlers } from './ipc/settings-handlers'
import { registerWindowIpcHandlers } from './ipc/window-handlers'
import type { IpcHandlerContext } from './ipc/ipc-handler-utils'

interface RegisterIpcHandlersOptions {
  assistantService: AssistantService
}

let handlersRegistered = false

export function registerIpcHandlers(
  options: RegisterIpcHandlersOptions
): void {
  if (handlersRegistered) {
    return
  }

  handlersRegistered = true

  const context: IpcHandlerContext = {
    assistantService: options.assistantService
  }

  registerAppIpcHandlers(context)
  registerSettingsIpcHandlers(context)
  registerPluginsIpcHandlers(context)
  registerWindowIpcHandlers()
  registerAssistantIpcHandlers(context)
}
