import {
  ASSISTANT_ACTION_TYPES,
  type AssistantProviderInfo,
  type AssistantRuntimeStatus,
  type RuntimeApprovalSettings,
  type ShellState,
  type ShellStateStage
} from '../shared/contracts'

export const VRM_ASSET_PATH = './static/7120171664031727876.vrm'

export function buildShellState(
  provider: AssistantProviderInfo,
  warnings: string[],
  runtime: AssistantRuntimeStatus,
  availableActions = [...ASSISTANT_ACTION_TYPES],
  approvals: RuntimeApprovalSettings = {
    approvalsEnabled: true,
    continuation: {
      maxSteps: 6,
      maxRuntimeMs: 120_000,
      postActionDelayMs: 750
    }
  }
): ShellState {
  const approvalNote = approvals.approvalsEnabled
    ? 'Desktop actions remain constrained to Bonzi’s small allowlist, with confirmation still required for sensitive actions like close-window.'
    : 'Desktop actions remain constrained to Bonzi’s small allowlist. Approval prompts are disabled, so sensitive actions run when clicked.'

  return {
    stage: shellStageForRuntime(runtime),
    platform: process.platform,
    vrmAssetPath: VRM_ASSET_PATH,
    notes: [
      'Bonzi now runs an embedded Eliza runtime in the Electron main process.',
      'Assistant history is persisted locally through the runtime manager, while renderer UI behavior remains unchanged for now.',
      approvalNote
    ],
    assistant: {
      provider,
      availableActions,
      warnings,
      runtime,
      approvals
    }
  }
}

function shellStageForRuntime(
  runtime: AssistantRuntimeStatus
): ShellStateStage {
  switch (runtime.state) {
    case 'starting':
      return 'runtime-starting'
    case 'ready':
      return 'assistant-ready'
    case 'error':
      return 'runtime-error'
  }
}
