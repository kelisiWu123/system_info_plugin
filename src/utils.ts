function bytesToGB(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0.00'
  return (bytes / (1024 * 1024 * 1024)).toFixed(2)
}

function mbToGB(megabytes: number): string {
  if (!Number.isFinite(megabytes) || megabytes <= 0) return '0.00'
  return (megabytes / 1024).toFixed(2)
}

function bytesToMB(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0
  return bytes / (1024 * 1024)
}

function bytesToKB(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0
  return bytes / 1024
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const digits = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(digits)} ${units[unitIndex]}`
}

function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`
}

function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '--'

  const totalSeconds = Math.floor(seconds)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const remainingSeconds = totalSeconds % 60

  return `${days}天${hours}小时${minutes}分钟${remainingSeconds}秒`
}

function clampPercent(value: number, max = 100): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(max, value))
}

function formatDisplayResolution(display?: DisplayData): string {
  if (!display) return '--'

  if (display.resolutionX && display.resolutionY) {
    return `${display.resolutionX} × ${display.resolutionY}`
  }

  if (display.currentResX && display.currentResY) {
    return `${display.currentResX} × ${display.currentResY}`
  }

  return '--'
}

export { bytesToGB, mbToGB, bytesToMB, bytesToKB, formatBytes, formatSpeed, formatUptime, clampPercent, formatDisplayResolution }
