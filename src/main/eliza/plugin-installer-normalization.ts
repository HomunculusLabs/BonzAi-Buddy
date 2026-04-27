import type { ElizaPluginInstallRequest, ElizaPluginUninstallRequest } from '../../shared/contracts'
import { normalizeOptionalString } from '../../shared/value-utils'
import type {
  NormalizedInstallRequest,
  NormalizedUninstallRequest
} from './plugin-installer-types'

export function normalizeInstallRequest(
  request: ElizaPluginInstallRequest
): NormalizedInstallRequest {
  const packageName = normalizeOptionalString(request.packageName)

  if (!packageName) {
    throw new Error('Install request must include a packageName.')
  }

  return {
    pluginId:
      normalizePluginId(request.pluginId ?? request.id) ??
      derivePluginIdFromPackageName(packageName),
    packageName,
    versionRange: normalizeOptionalString(request.versionRange),
    registryRef: normalizeOptionalString(request.registryRef),
    confirmed: request.confirmed === true,
    confirmationOperationId: normalizeOptionalString(request.confirmationOperationId),
    ignoreScripts: request.ignoreScripts !== false
  }
}

export function normalizeUninstallRequest(
  request: ElizaPluginUninstallRequest
): NormalizedUninstallRequest {
  return {
    pluginId: normalizePluginId(request.pluginId ?? request.id),
    packageName: normalizeOptionalString(request.packageName),
    confirmed: request.confirmed === true
  }
}

export function derivePluginIdFromPackageName(packageName: string): string {
  const lastSegment = packageName.split('/').at(-1) ?? packageName
  const stripped = lastSegment.replace(/^plugin-/, '').trim()

  if (!stripped) {
    throw new Error(`Could not derive plugin id from package name "${packageName}".`)
  }

  return stripped
}

export function buildAddCommandPreview(request: NormalizedInstallRequest): string {
  const spec = request.versionRange
    ? `${request.packageName}@${request.versionRange}`
    : request.packageName
  const suffix = request.ignoreScripts ? ' --ignore-scripts' : ' --allow-scripts'
  return `bun add ${spec}${suffix}`
}

export function normalizePluginId(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}
