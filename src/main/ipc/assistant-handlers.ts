import { IPC_CHANNELS } from '../../shared/ipc-contracts'
import { handleInvoke, type IpcHandlerContext } from './ipc-handler-utils'

export function registerAssistantIpcHandlers({
  assistantService
}: IpcHandlerContext): void {
  handleInvoke(IPC_CHANNELS.assistant.sendCommand, async (_event, request) => {
    return assistantService.sendCommand(request)
  })

  handleInvoke(IPC_CHANNELS.assistant.executeAction, async (_event, request) => {
    return assistantService.executeAction(request)
  })

  handleInvoke(IPC_CHANNELS.assistant.getHistory, async () => {
    return assistantService.getHistory()
  })

  handleInvoke(IPC_CHANNELS.assistant.resetConversation, async () => {
    await assistantService.resetConversation()
  })

  handleInvoke(IPC_CHANNELS.assistant.reloadRuntime, async () => {
    return assistantService.reloadRuntime()
  })

  handleInvoke(IPC_CHANNELS.assistant.getWorkflowRuns, () => {
    return assistantService.getWorkflowRuns()
  })

  handleInvoke(IPC_CHANNELS.assistant.getWorkflowRun, (_event, id) => {
    if (typeof id !== 'string' || !id.trim()) {
      return null
    }

    return assistantService.getWorkflowRun(id)
  })

  handleInvoke(
    IPC_CHANNELS.assistant.respondWorkflowApproval,
    async (_event, request) => {
      return assistantService.respondWorkflowApproval(request)
    }
  )

  handleInvoke(IPC_CHANNELS.assistant.cancelWorkflow, async (_event, request) => {
    return assistantService.cancelWorkflowRun(request)
  })
}
