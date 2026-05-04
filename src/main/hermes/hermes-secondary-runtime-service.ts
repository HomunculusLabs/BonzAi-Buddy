import type {
  HermesConsultationRequest,
  HermesConsultationResult,
  HermesHealthCheckRequest,
  HermesHealthCheckResult,
  HermesModelAuthCheckResult,
  HermesModelAuthSettingsResponse,
  HermesRuntimeSettingsResponse,
  HermesSecondaryRuntimeStatus,
  HermesSecondaryRuntimeSummary,
  UpdateHermesModelAuthSettingsRequest,
  UpdateHermesRuntimeSettingsRequest
} from '../../shared/contracts/hermes'
import { normalizeError } from '../../shared/value-utils'
import {
  HermesCliAgentClient,
  type HermesAgentClient,
  type HermesMessageOutput
} from './hermes-agent-client'
import {
  checkHermesCron,
  checkHermesGateway,
  checkHermesStatus,
  getHermesRuntimeSettingsResponse,
  loadHermesConfig,
  updateHermesRuntimeSettings
} from './hermes-config'
import { inspectHermesCronJobs } from './hermes-cron-inspector'
import { HermesLifecycle } from './hermes-lifecycle'
import {
  checkHermesModelAuthStatus,
  getHermesModelAuthSettingsResponse,
  updateHermesModelAuthSettings
} from './hermes-native-settings'

const MAX_CONSULTATION_PROMPT_LENGTH = 24_000
const MAX_CONSULTATION_TEXT_LENGTH = 4_000

export interface HermesSecondaryRuntimeServiceOptions {
  client?: HermesAgentClient
  onRuntimeStatus?: (status: HermesSecondaryRuntimeStatus) => void
}

export class HermesSecondaryRuntimeService {
  private readonly client: HermesAgentClient
  private readonly lifecycle: HermesLifecycle

  constructor(options: HermesSecondaryRuntimeServiceOptions = {}) {
    this.client = options.client ?? new HermesCliAgentClient()
    this.lifecycle = new HermesLifecycle({
      client: this.client,
      onRuntimeStatus: options.onRuntimeStatus
    })
  }

  getSummary(): HermesSecondaryRuntimeSummary {
    const config = loadHermesConfig()
    return {
      enabled: true,
      status: this.lifecycle.getRuntimeStatus(),
      warnings: config.startupWarnings
    }
  }

  getRuntimeStatus(): HermesSecondaryRuntimeStatus {
    return this.lifecycle.getRuntimeStatus()
  }

  async reloadRuntime(): Promise<HermesSecondaryRuntimeStatus> {
    return this.lifecycle.reloadRuntime()
  }

  async dispose(): Promise<void> {
    await this.lifecycle.dispose()
  }

  async runConsultation(
    request: HermesConsultationRequest
  ): Promise<HermesConsultationResult> {
    const userPrompt = normalizeConsultationPrompt(request.prompt)
    if (!userPrompt) {
      throw new Error('Hermes consultation requires a non-empty prompt.')
    }

    try {
      await this.lifecycle.ensureInitialized()
      const config = this.lifecycle.getConfig()
      const output = await this.client.sendMessage({
        prompt: composeSecondaryConsultationPrompt({
          userPrompt,
          systemPrompt: config.systemPrompt,
          workflowRunId: request.workflowRunId,
          actionId: request.actionId
        })
      })

      return formatConsultationResult(output)
    } catch (error) {
      const message = normalizeError(error)
      const timedOut = message.toLowerCase().includes('timed out')
      return {
        ok: false,
        text: truncateForObservation(
          [
            timedOut
              ? 'Hermes secondary consultation timed out before returning a response.'
              : 'Hermes secondary consultation failed.',
            `Eliza remains the primary orchestrator and should continue without treating Hermes output as authoritative.`,
            `Failure: ${message}`
          ].join('\n')
        ),
        warnings: [message]
      }
    }
  }

  async inspectCronJobs(query?: string): Promise<string> {
    return truncateForObservation(await inspectHermesCronJobs(query))
  }

  getHermesRuntimeSettings(): HermesRuntimeSettingsResponse {
    return getHermesRuntimeSettingsResponse()
  }

  async updateHermesRuntimeSettings(
    request: UpdateHermesRuntimeSettingsRequest
  ): Promise<HermesRuntimeSettingsResponse> {
    const response = updateHermesRuntimeSettings(request)
    await this.reloadRuntime()
    return response
  }

  getHermesModelAuthSettings(): HermesModelAuthSettingsResponse {
    return getHermesModelAuthSettingsResponse()
  }

  async updateHermesModelAuthSettings(
    request: UpdateHermesModelAuthSettingsRequest
  ): Promise<HermesModelAuthSettingsResponse> {
    const response = updateHermesModelAuthSettings(request)
    await this.reloadRuntime()
    return response
  }

  checkHermesModelAuthStatus(): HermesModelAuthCheckResult {
    return checkHermesModelAuthStatus()
  }

  async checkHermesHealth(
    request: HermesHealthCheckRequest
  ): Promise<HermesHealthCheckResult> {
    switch (request.kind) {
      case 'status':
        return checkHermesStatus()
      case 'cron':
        return checkHermesCron()
      case 'gateway':
        return checkHermesGateway()
    }
  }
}

function composeSecondaryConsultationPrompt(input: {
  userPrompt: string
  systemPrompt?: string
  workflowRunId?: string
  actionId?: string
}): string {
  return [
    'You are Hermes, a secondary specialist consulted by Bonzi Desktop.',
    'Eliza is the primary orchestrator, owns persistent memory, decides user-facing responses, and decides all Bonzi desktop actions.',
    'Provide concise advisory observations only. Do not claim that you executed desktop side effects. Do not produce Bonzi action JSON, tool calls, or instructions that assume Hermes controls the workflow.',
    'If action-like follow-up seems useful, describe it as a suggestion for Eliza to evaluate in prose.',
    input.systemPrompt ? `<hermes_secondary_runtime_prompt>\n${input.systemPrompt.trim()}\n</hermes_secondary_runtime_prompt>` : '',
    input.workflowRunId ? `Workflow run id: ${input.workflowRunId}` : '',
    input.actionId ? `Bonzi action id: ${input.actionId}` : '',
    'Consultation request:',
    input.userPrompt
  ].filter(Boolean).join('\n\n')
}

function formatConsultationResult(output: HermesMessageOutput): HermesConsultationResult {
  const ignoredActionCount = (output.actions?.length ?? 0) + (output.toolCalls?.length ?? 0)
  const responseText = output.text?.trim() || output.rawText?.trim() || 'Hermes returned an empty consultation response.'
  const ignoredText = ignoredActionCount > 0
    ? `\n\nIgnored ${ignoredActionCount} Hermes action/tool suggestion${ignoredActionCount === 1 ? '' : 's'} because Hermes is secondary; Eliza must decide any real Bonzi follow-up.`
    : ''

  return {
    ok: true,
    text: truncateForObservation(`Hermes secondary consultation:\n${responseText}${ignoredText}`),
    warnings: output.warnings ?? [],
    ...(output.rawText ? { rawText: truncateForObservation(output.rawText) } : {}),
    ...(ignoredActionCount > 0 ? { ignoredActionCount } : {})
  }
}

function normalizeConsultationPrompt(prompt: string): string {
  return prompt.trim().slice(0, MAX_CONSULTATION_PROMPT_LENGTH)
}

function truncateForObservation(text: string): string {
  if (text.length <= MAX_CONSULTATION_TEXT_LENGTH) {
    return text
  }

  return `${text.slice(0, MAX_CONSULTATION_TEXT_LENGTH - 1)}…`
}
