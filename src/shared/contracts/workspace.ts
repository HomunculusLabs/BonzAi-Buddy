export type BonziWorkspaceSettingsSource = 'default' | 'settings' | 'env'

export interface BonziWorkspaceSettings {
  workspaceDir: string
  defaultWorkspaceDir: string
  source: BonziWorkspaceSettingsSource
  envLocked: boolean
}

export interface SelectBonziWorkspaceFolderResult {
  ok: boolean
  cancelled: boolean
  settings: BonziWorkspaceSettings
  message: string
  error?: string
}

export interface ResetBonziWorkspaceFolderResult {
  ok: boolean
  settings: BonziWorkspaceSettings
  message: string
  error?: string
}
