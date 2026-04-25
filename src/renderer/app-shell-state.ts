import {
  type AssistantRuntimeStatus,
  type ShellState
} from '../shared/contracts'

export function shellStateMarkup(state: ShellState): string {
  return JSON.stringify(state, null, 2)
}

export function shellStageForRuntimeStatus(
  status: AssistantRuntimeStatus
): ShellState['stage'] {
  switch (status.state) {
    case 'starting':
      return 'runtime-starting'
    case 'ready':
      return 'assistant-ready'
    case 'error':
      return 'runtime-error'
  }
}
