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

export function getSensorEnhancementActionLabel(_platform: SensorEnhancementPlatform, expanded: boolean): string {
  return expanded ? '收起增强模式' : '传感器增强'
}
