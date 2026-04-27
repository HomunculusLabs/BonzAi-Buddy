import { normalizeOptionalString } from '../../shared/value-utils'
import type { NormalizedInstallRequest } from './plugin-installer-types'

const INSTALL_CONFIRMATION_TTL_MS = 5 * 60 * 1000

export class PluginInstallConfirmationStore {
  private readonly pendingInstallConfirmations = new Map<
    string,
    { request: NormalizedInstallRequest; expiresAt: number }
  >()

  preview(operationId: string, request: NormalizedInstallRequest): void {
    this.pendingInstallConfirmations.set(operationId, {
      request,
      expiresAt: Date.now() + INSTALL_CONFIRMATION_TTL_MS
    })
  }

  validateAndConsume(request: NormalizedInstallRequest): string | null {
    const confirmationId = normalizeOptionalString(request.confirmationOperationId)

    if (!confirmationId) {
      return 'Install confirmation requires confirmationOperationId from a prior preview operation.'
    }

    const pending = this.pendingInstallConfirmations.get(confirmationId)

    if (!pending) {
      return 'Install confirmation was not found or has already been used.'
    }

    this.pendingInstallConfirmations.delete(confirmationId)

    if (pending.expiresAt < Date.now()) {
      return 'Install confirmation expired. Preview the install again.'
    }

    if (
      pending.request.pluginId !== request.pluginId ||
      pending.request.packageName !== request.packageName ||
      pending.request.versionRange !== request.versionRange ||
      pending.request.registryRef !== request.registryRef
    ) {
      return 'Install confirmation does not match the previewed package request.'
    }

    return null
  }
}
