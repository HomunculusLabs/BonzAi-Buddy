export interface PluginCommandRunOptions {
  command: string
  args: string[]
  cwd: string
  timeoutMs: number
  outputLimitChars: number
}

export interface CommandRunResult {
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
}

export type PluginInstallerCommandRunner = (
  options: PluginCommandRunOptions
) => Promise<CommandRunResult>

export interface NormalizedInstallRequest {
  pluginId: string
  packageName: string
  versionRange?: string
  registryRef?: string
  confirmed: boolean
  confirmationOperationId?: string
  ignoreScripts: boolean
}

export interface NormalizedUninstallRequest {
  pluginId?: string
  packageName?: string
  confirmed: boolean
}
