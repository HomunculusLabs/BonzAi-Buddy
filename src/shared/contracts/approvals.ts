export interface RuntimeContinuationSettings {
  maxSteps: number
  maxRuntimeMs: number
  postActionDelayMs: number
}

export interface RuntimeApprovalSettings {
  approvalsEnabled: boolean
  continuation: RuntimeContinuationSettings
}

export interface UpdateRuntimeApprovalSettingsRequest {
  approvalsEnabled?: boolean
  confirmedDisable?: boolean
  continuation?: Partial<RuntimeContinuationSettings>
}
