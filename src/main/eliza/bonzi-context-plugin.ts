import type { Plugin } from '@elizaos/core/node'
import type { ShellState } from '../../shared/contracts'

interface BonziContextPluginOptions {
  getShellState: () => ShellState
}

export function createBonziContextPlugin(
  options: BonziContextPluginOptions
): Plugin {
  return {
    name: 'bonzi-context',
    description:
      'Injects live Bonzi shell, platform, runtime, and allowlisted desktop-action context into prompt assembly.',
    providers: [
      {
        name: 'bonzi_shell_state',
        description:
          'Provides the current Bonzi shell state, assistant runtime status, and available confirmation-aware desktop actions.',
        dynamic: true,
        position: -10,
        get: async () => {
          const shellState = options.getShellState()

          return {
            text: formatShellState(shellState),
            values: {
              bonziStage: shellState.stage,
              bonziPlatform: shellState.platform,
              bonziVrmAssetPath: shellState.vrmAssetPath,
              bonziAvailableActions: shellState.assistant.availableActions,
              bonziAssistantProvider: shellState.assistant.provider.label,
              bonziAssistantWarnings: shellState.assistant.warnings,
              bonziRuntimeState: shellState.assistant.runtime?.state
            },
            data: {
              shellState
            }
          }
        }
      }
    ]
  }
}

function formatShellState(shellState: ShellState): string {
  const runtime = shellState.assistant.runtime

  return [
    'Bonzi shell state:',
    `- Stage: ${shellState.stage}`,
    `- Platform: ${shellState.platform}`,
    `- VRM asset path: ${shellState.vrmAssetPath}`,
    `- Assistant provider: ${shellState.assistant.provider.label}`,
    `- Available actions: ${shellState.assistant.availableActions.join(', ') || 'none'}`,
    runtime
      ? `- Runtime: ${runtime.backend} / ${runtime.state} / ${runtime.persistence}`
      : '- Runtime: not published by the shell state yet',
    shellState.assistant.warnings.length > 0
      ? `- Warnings: ${shellState.assistant.warnings.join(' | ')}`
      : '- Warnings: none',
    shellState.notes.length > 0
      ? `- Notes: ${shellState.notes.join(' | ')}`
      : '- Notes: none'
  ].join('\n')
}
