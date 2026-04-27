import { isRecord } from '../shared/value-utils'
import { truncate } from './assistant-action-param-utils'

export function normalizeCommandRequest(request: unknown): {
  command: string
  error?: string
} {
  if (!isRecord(request)) {
    return {
      command: '',
      error: 'Malformed assistant request.'
    }
  }

  const command = typeof request.command === 'string' ? request.command.trim() : ''

  if (!command) {
    return {
      command: '',
      error: 'Enter a command before sending it to the assistant.'
    }
  }

  return {
    command: truncate(command, 2_000)
  }
}

export function normalizeActionExecutionRequest(request: unknown): {
  actionId: string
  confirmed: boolean
  error?: string
} {
  if (!isRecord(request)) {
    return {
      actionId: '',
      confirmed: false,
      error: 'Malformed assistant action request.'
    }
  }

  if (typeof request.actionId !== 'string' || !request.actionId.trim()) {
    return {
      actionId: '',
      confirmed: false,
      error: 'Assistant action requests must include a valid actionId.'
    }
  }

  if (typeof request.confirmed !== 'boolean') {
    return {
      actionId: '',
      confirmed: false,
      error: 'Assistant action requests must include a boolean confirmed flag.'
    }
  }

  return {
    actionId: request.actionId,
    confirmed: request.confirmed
  }
}

export function normalizeWorkflowApprovalRequest(request: unknown): {
  runId: string
  stepId: string
  approved: boolean
  error?: string
} {
  if (!isRecord(request)) {
    return {
      runId: '',
      stepId: '',
      approved: false,
      error: 'Malformed workflow approval request.'
    }
  }

  const runId = typeof request.runId === 'string' ? request.runId.trim() : ''
  const stepId = typeof request.stepId === 'string' ? request.stepId.trim() : ''

  if (!runId) {
    return {
      runId: '',
      stepId: '',
      approved: false,
      error: 'Workflow approval requests must include a runId.'
    }
  }

  if (!stepId) {
    return {
      runId: '',
      stepId: '',
      approved: false,
      error: 'Workflow approval requests must include a stepId.'
    }
  }

  if (typeof request.approved !== 'boolean') {
    return {
      runId: '',
      stepId: '',
      approved: false,
      error: 'Workflow approval requests must include a boolean approved flag.'
    }
  }

  return {
    runId,
    stepId,
    approved: request.approved
  }
}

export function normalizeCancelWorkflowRequest(request: unknown): {
  runId: string
  error?: string
} {
  if (!isRecord(request)) {
    return {
      runId: '',
      error: 'Malformed cancel workflow request.'
    }
  }

  const runId = typeof request.runId === 'string' ? request.runId.trim() : ''

  if (!runId) {
    return {
      runId: '',
      error: 'Cancel workflow requests must include a runId.'
    }
  }

  return {
    runId
  }
}
