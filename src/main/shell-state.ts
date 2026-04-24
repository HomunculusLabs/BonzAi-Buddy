import { ASSISTANT_ACTION_TYPES, type AssistantProviderInfo, type ShellState } from '../shared/contracts'

export const VRM_ASSET_PATH = './static/7120171664031727876.vrm'

export function buildShellState(
  provider: AssistantProviderInfo,
  warnings: string[]
): ShellState {
  return {
    stage: 'item-3-assistant-ready',
    platform: process.platform,
    vrmAssetPath: VRM_ASSET_PATH,
    notes: [
      'Item 2 remains live: the renderer still loads the bundled VRM onto the transparent Three.js stage.',
      'Item 3 is now wired: renderer commands cross a typed IPC bridge into a provider-pluggable assistant service.',
      'Task execution is intentionally constrained to a small allowlist with confirmation gates for sensitive actions.'
    ],
    assistant: {
      provider,
      availableActions: [...ASSISTANT_ACTION_TYPES],
      warnings
    }
  }
}
