export interface OsPlatformLike {
  platform?: string | null
  distro?: string | null
}

export type NormalizedOsPlatform = 'win32' | 'darwin' | 'other'
export type SensorEnhancementPlatform = 'windows' | 'macos' | 'unsupported'

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

export function getSensorEnhancementControlLabel(platform: SensorEnhancementPlatform): string {
  return platform === 'windows' ? 'OpenHardwareMonitor' : '传感器增强'
}

export function getSensorEnhancementMenuAriaLabel(platform: SensorEnhancementPlatform): string {
  return platform === 'windows' ? '打开 OpenHardwareMonitor 菜单' : '打开传感器增强菜单'
}

export function getSensorEnhancementActionLabel(platform: SensorEnhancementPlatform, expanded: boolean): string {
  if (platform === 'windows') return expanded ? '收起 OHM 菜单' : getSensorEnhancementControlLabel(platform)
  return expanded ? '收起增强模式' : '传感器增强'
}

export function isSensorEnhancementDefaultEnabled(platform: SensorEnhancementPlatform): boolean {
  return platform === 'windows' || platform === 'macos'
}

export function getSensorEnhancementPrimaryActionLabel(platform: SensorEnhancementPlatform, enabled: boolean): string {
  if (platform === 'windows') return enabled ? '关闭 OHM 支持' : '启用 OHM 支持'
  return enabled ? '关闭增强模式' : '启用增强模式'
}

export function shouldAutoPrepareSensorEnhancement(
  platform: SensorEnhancementPlatform,
  enabled: boolean,
  ready: boolean
): boolean {
  return isSensorEnhancementDefaultEnabled(platform) && enabled && !ready
}
