export interface OsPlatformLike {
  platform?: string | null
  distro?: string | null
}

export type NormalizedOsPlatform = 'win32' | 'darwin' | 'other'
export type SensorEnhancementPlatform = 'windows' | 'macos' | 'unsupported'
export type WindowsSensorEnhancementReadiness = 'running' | 'error' | 'pending'

interface WindowsSensorEnhancementStatusLike {
  running?: boolean
  started?: boolean
  reason?: string
  suggestion?: string
}

function normalizePlatformText(value?: string | null): string {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/[_-]+/g, ' ') : ''
}

function isWindowsText(value: string): boolean {
  return /\b(win32|windows|windows nt)\b/.test(value)
}

function isMacText(value: string): boolean {
  return /\b(darwin|macos|mac os|os x)\b/.test(value)
}

export function normalizeOsPlatform(osInfo?: OsPlatformLike): NormalizedOsPlatform {
  const platform = normalizePlatformText(osInfo?.platform)
  const distro = normalizePlatformText(osInfo?.distro)

  if (isWindowsText(platform) || isWindowsText(distro)) return 'win32'
  if (isMacText(platform) || isMacText(distro)) return 'darwin'
  return 'other'
}

export function getSensorEnhancementPlatform(osInfo?: OsPlatformLike): SensorEnhancementPlatform {
  const platform = normalizeOsPlatform(osInfo)
  if (platform === 'win32') return 'windows'
  if (platform === 'darwin') return 'macos'
  return 'unsupported'
}

export function getSensorEnhancementControlLabel(_platform: SensorEnhancementPlatform): string {
  return '传感器增强'
}

export function getSensorEnhancementMenuAriaLabel(_platform: SensorEnhancementPlatform): string {
  return '打开传感器增强菜单'
}

export function getSensorEnhancementActionLabel(_platform: SensorEnhancementPlatform, expanded: boolean): string {
  return expanded ? '收起增强模式' : '传感器增强'
}

export function isSensorEnhancementDefaultEnabled(platform: SensorEnhancementPlatform): boolean {
  return platform === 'windows' || platform === 'macos'
}

export function getSensorEnhancementPrimaryActionLabel(_platform: SensorEnhancementPlatform, enabled: boolean): string {
  return enabled ? '关闭增强模式' : '启用增强模式'
}

export function shouldAutoPrepareSensorEnhancement(
  platform: SensorEnhancementPlatform,
  enabled: boolean,
  ready: boolean
): boolean {
  return isSensorEnhancementDefaultEnabled(platform) && enabled && !ready
}

export function getWindowsSensorEnhancementReadiness(
  status?: WindowsSensorEnhancementStatusLike | null
): WindowsSensorEnhancementReadiness {
  if (status?.running) return 'running'

  const reason = status?.reason || ''
  if (
    reason.startsWith('WINDOWS_SENSOR_')
    || reason === 'OHM_START_FAILED'
    || reason === 'OHM_EXE_NOT_FOUND'
    || reason === 'OHM_RUNTIME_COPY_FAILED'
    || reason === 'OHM_USERDATA_UNAVAILABLE'
    || reason === 'OHM_AUTOSTART_DISABLED'
  ) return 'error'

  return 'pending'
}

export function reconcileWindowsSensorStartStatus<T extends WindowsSensorEnhancementStatusLike>(
  startStatus: T,
  observedStatus: T
): T {
  if (observedStatus.running) {
    return {
      ...observedStatus,
      started: Boolean(startStatus.started || observedStatus.started),
    }
  }

  if (!startStatus.running && startStatus.reason) {
    return {
      ...observedStatus,
      started: Boolean(startStatus.started),
      reason: startStatus.reason,
      suggestion: startStatus.suggestion || observedStatus.suggestion,
    }
  }

  return {
    ...observedStatus,
    started: Boolean(startStatus.started || observedStatus.started),
  }
}
