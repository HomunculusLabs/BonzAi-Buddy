export interface RuntimeApprovalSettings {
  approvalsEnabled: boolean
}

export interface UpdateRuntimeApprovalSettingsRequest {
  approvalsEnabled: boolean
  confirmedDisable?: boolean
}
