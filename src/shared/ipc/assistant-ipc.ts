import type {
  AssistantActionExecutionRequest,
  AssistantActionExecutionResponse,
  AssistantCommandRequest,
  AssistantCommandResponse,
  AssistantEvent,
  AssistantMessage,
  AssistantRuntimeStatus
} from '../contracts/assistant'
import type {
  BonziWorkflowRunSnapshot,
  CancelWorkflowRunRequest,
  CancelWorkflowRunResponse,
  RespondWorkflowApprovalRequest,
  RespondWorkflowApprovalResponse
} from '../contracts/workflow'
import { IPC_CHANNELS } from './channels'

export type AssistantIpcInvokeChannelMap = {
  [IPC_CHANNELS.assistant.sendCommand]: {
    args: [request: AssistantCommandRequest]
    response: AssistantCommandResponse
  }
  [IPC_CHANNELS.assistant.executeAction]: {
    args: [request: AssistantActionExecutionRequest]
    response: AssistantActionExecutionResponse
  }
  [IPC_CHANNELS.assistant.getHistory]: {
    args: []
    response: AssistantMessage[]
  }
  [IPC_CHANNELS.assistant.resetConversation]: {
    args: []
    response: void
  }
  [IPC_CHANNELS.assistant.reloadRuntime]: {
    args: []
    response: AssistantRuntimeStatus
  }
  [IPC_CHANNELS.assistant.getWorkflowRuns]: {
    args: []
    response: BonziWorkflowRunSnapshot[]
  }
  [IPC_CHANNELS.assistant.getWorkflowRun]: {
    args: [id: string]
    response: BonziWorkflowRunSnapshot | null
  }
  [IPC_CHANNELS.assistant.respondWorkflowApproval]: {
    args: [request: RespondWorkflowApprovalRequest]
    response: RespondWorkflowApprovalResponse
  }
  [IPC_CHANNELS.assistant.cancelWorkflow]: {
    args: [request: CancelWorkflowRunRequest]
    response: CancelWorkflowRunResponse
  }
}

export type AssistantIpcRendererEventChannelMap = {
  [IPC_CHANNELS.assistant.event]: {
    args: [event: AssistantEvent]
  }
}

export interface AssistantBridge {
  assistant: {
    sendCommand: (
      request: AssistantCommandRequest
    ) => Promise<AssistantCommandResponse>
    executeAction: (
      request: AssistantActionExecutionRequest
    ) => Promise<AssistantActionExecutionResponse>
    getHistory: () => Promise<AssistantMessage[]>
    resetConversation: () => Promise<void>
    reloadRuntime: () => Promise<AssistantRuntimeStatus>
    getWorkflowRuns: () => Promise<BonziWorkflowRunSnapshot[]>
    getWorkflowRun: (id: string) => Promise<BonziWorkflowRunSnapshot | null>
    respondWorkflowApproval: (
      request: RespondWorkflowApprovalRequest
    ) => Promise<RespondWorkflowApprovalResponse>
    cancelWorkflowRun: (
      request: CancelWorkflowRunRequest
    ) => Promise<CancelWorkflowRunResponse>
    onEvent: (listener: (event: AssistantEvent) => void) => () => void
  }
}
