declare module '@elizaos/plugin-pi-ai' {
  import type { Plugin } from '@elizaos/core/node'

  export interface PiAiModelOption {
    id: string
    name: string
    provider: string
    isDefault: boolean
  }

  export function listPiAiModelOptions(overrideAgentDir?: string): Promise<{
    defaultModelSpec: string | undefined
    models: PiAiModelOption[]
  }>

  const piAiPlugin: Plugin
  export default piAiPlugin
}
