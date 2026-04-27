import type {
  AssistantActionType,
  AssistantProviderInfo,
  AssistantRuntimeStatus
} from './assistant'
import type { RuntimeApprovalSettings } from './approvals'

export type ShellStateStage =
  | 'runtime-starting'
  | 'assistant-ready'
  | 'runtime-error'

export interface ShellState {
  stage: ShellStateStage
  platform: string
  vrmAssetPath: string
  notes: string[]
  assistant: {
    provider: AssistantProviderInfo
    availableActions: AssistantActionType[]
    warnings: string[]
    runtime: AssistantRuntimeStatus
    approvals: RuntimeApprovalSettings
  }
}
