import type { AssistantProviderInfo } from '../../shared/contracts'
import { dedupeStrings } from '../../shared/value-utils'
import {
  loadBonziElizaConfig,
  type BonziElizaResolvedConfig
} from './config'

export class BonziRuntimeConfigState {
  private providerInfo: AssistantProviderInfo = {
    kind: 'eliza-classic',
    label: 'Eliza Classic'
  }
  private startupWarnings: string[] = []
  private runtimeStartupWarnings: string[] = []

  sync(): BonziElizaResolvedConfig {
    const config = loadBonziElizaConfig()
    this.applyConfig(config)
    return config
  }

  getProviderInfo(): AssistantProviderInfo {
    return { ...this.providerInfo }
  }

  getStartupWarnings(): string[] {
    return [...this.startupWarnings]
  }

  addRuntimeStartupWarnings(warnings: string[]): void {
    const additions = warnings.filter(
      (warning) => !this.runtimeStartupWarnings.includes(warning)
    )

    if (additions.length === 0) {
      return
    }

    this.runtimeStartupWarnings = [...this.runtimeStartupWarnings, ...additions]
    this.startupWarnings = dedupeStrings([...this.startupWarnings, ...additions])
  }

  clearRuntimeStartupWarnings(config?: BonziElizaResolvedConfig): void {
    this.runtimeStartupWarnings = []

    if (config) {
      this.applyConfig(config)
      return
    }

    this.sync()
  }

  resetRuntimeStartupWarnings(): void {
    this.runtimeStartupWarnings = []
  }

  private applyConfig(config: BonziElizaResolvedConfig): void {
    this.providerInfo = config.provider
    this.startupWarnings = dedupeStrings([
      ...config.startupWarnings,
      ...this.runtimeStartupWarnings
    ])
  }
}
