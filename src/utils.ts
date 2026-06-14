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

function getDisplayCpuCurrentSpeedGHz(speed?: CpuCurrentSpeedData | null): number {
  if (!speed) return 0

  const validCoreSpeeds = Array.isArray(speed.cores)
    ? speed.cores.filter((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)
    : []

  if (validCoreSpeeds.length) {
    return Math.max(...validCoreSpeeds)
  }

  return typeof speed.avg === 'number' && Number.isFinite(speed.avg) && speed.avg > 0 ? speed.avg : 0
}

function cleanStorageText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function hasHardwareIdentity(disk: DiskLayoutData): boolean {
  const serial = cleanStorageText(disk.serialNum)
  const firmware = cleanStorageText(disk.firmwareRevision)
  const interfaceType = cleanStorageText(disk.interfaceType)
  const type = cleanStorageText(disk.type).toLowerCase()
  const name = cleanStorageText(disk.name).toLowerCase()
  const device = cleanStorageText(disk.device).toLowerCase()

  if (serial || firmware) return true
  if (interfaceType && interfaceType !== '--') return true
  if (/(ssd|hdd|nvme|flash|usb|sata|sas|scsi)/.test(type)) return true
  if (/(ssd|hdd|nvme|flash|usb)/.test(name)) return true
  if (/(physicaldrive|nvme|disk\d+$)/.test(device)) return true
  return false
}

function isLikelyVirtualDisk(disk: DiskLayoutData): boolean {
  const text = [
    cleanStorageText(disk.device),
    cleanStorageText(disk.name),
    cleanStorageText(disk.type),
    cleanStorageText(disk.vendor),
    cleanStorageText(disk.interfaceType),
  ]
    .join(' ')
    .toLowerCase()

  return /(virtual|vmware|vbox|hyper-v|parallels|qemu|loop|ram disk|ramdisk|disk image|dmg|sparsebundle|sparse image|synthesized|container|apfs volume|logical volume|mapper)/.test(text)
}

function getPhysicalDiskKey(disk: DiskLayoutData, index: number): string {
  const serial = cleanStorageText(disk.serialNum)
  if (serial) return `serial:${serial.toLowerCase()}`

  const device = cleanStorageText(disk.device)
  if (device) return `device:${device.toLowerCase()}`

  const name = cleanStorageText(disk.name)
  if (name) return `name:${name.toLowerCase()}:${disk.size || 0}`

  return `disk:${index}:${disk.size || 0}`
}

function getPhysicalDiskLayout(disks: DiskLayoutData[]): DiskLayoutData[] {
  return Array.from(
    new Map(
      disks
        .filter((disk) => (disk.size || 0) > 0)
        .filter((disk) => !isLikelyVirtualDisk(disk))
        .filter((disk) => hasHardwareIdentity(disk))
        .map((disk, index) => [getPhysicalDiskKey(disk, index), disk] as const)
    ).values()
  )
}

function getPhysicalDiskTotalBytes(disks: DiskLayoutData[]): number {
  return getPhysicalDiskLayout(disks).reduce((sum, disk) => sum + (disk.size || 0), 0)
}

function hasDiskHealthTelemetry(disk: DiskLayoutData | undefined): boolean {
  if (!disk) return false

  const smartPassed = disk.smartData?.smart_status?.passed
  if (typeof smartPassed === 'boolean') return true

  if (cleanStorageText(disk.smartStatus)) return true

  if (disk.smartData?.nvme_smart_health_information_log) return true

  const smartRows = disk.smartData?.ata_smart_attributes?.table
  if (Array.isArray(smartRows) && smartRows.length > 0) return true

  return false
}

function getMacStorageVolumeMount(volume: Pick<DiskData, 'mount'>): string {
  return cleanStorageText(volume.mount)
}

function getMacStorageVolumeFs(volume: Pick<DiskData, 'fs'>): string {
  return cleanStorageText(volume.fs)
}

function isMacSystemDataVolume(volume: Pick<DiskData, 'mount'>): boolean {
  return getMacStorageVolumeMount(volume) === '/System/Volumes/Data'
}

function isMacSystemRootVolume(volume: Pick<DiskData, 'mount'>): boolean {
  return getMacStorageVolumeMount(volume) === '/'
}

function isMacRecoveryVolume(volume: Pick<DiskData, 'mount'>): boolean {
  return getMacStorageVolumeMount(volume).toLowerCase() === '/volumes/recovery'
}

function isMacUserMountedVolume(volume: Pick<DiskData, 'mount'>): boolean {
  const mount = getMacStorageVolumeMount(volume)
  return mount.startsWith('/Volumes/') && !isMacRecoveryVolume(volume)
}

function getMacStorageVolumeGroupKey(volume: Pick<DiskData, 'fs' | 'size' | 'available' | 'mount'>): string {
  const fs = getMacStorageVolumeFs(volume)
  const diskMatch = fs.match(/^\/dev\/(disk\d+)/i)
  if (diskMatch?.[1]) return `device:${diskMatch[1].toLowerCase()}`

  return `size:${volume.size || 0}:available:${volume.available || 0}:mount:${getMacStorageVolumeMount(volume).toLowerCase()}`
}

function scoreMacStorageVolume(volume: Pick<DiskData, 'mount' | 'used'>): number {
  if (isMacSystemDataVolume(volume)) return 400
  if (isMacSystemRootVolume(volume)) return 300
  if (isMacUserMountedVolume(volume)) return 200
  return 100
}

function pickPreferredMacStorageVolume(current: DiskData | undefined, next: DiskData): DiskData {
  if (!current) return next

  const currentScore = scoreMacStorageVolume(current)
  const nextScore = scoreMacStorageVolume(next)

  if (nextScore !== currentScore) {
    return nextScore > currentScore ? next : current
  }

  return (next.used || 0) > (current.used || 0) ? next : current
}

function dedupeMacStorageVolumes(volumes: DiskData[]): DiskData[] {
  const grouped = new Map<string, DiskData>()

  volumes.forEach((volume) => {
    const key = getMacStorageVolumeGroupKey(volume)
    grouped.set(key, pickPreferredMacStorageVolume(grouped.get(key), volume))
  })

  return [...grouped.values()]
}

function getDisplayStorageVolumes(volumes: DiskData[], platform?: string): DiskData[] {
  const list = volumes.filter((volume) => (volume.size || 0) > 0)
  if (platform !== 'darwin') return list

  const primarySystemVolume = list.find(isMacSystemDataVolume) || list.find(isMacSystemRootVolume)
  const visible = dedupeMacStorageVolumes([
    ...(primarySystemVolume ? [primarySystemVolume] : []),
    ...list.filter(isMacUserMountedVolume),
  ])

  return visible.length ? visible : list
}

function getStorageUsageSummary(volumes: DiskData[], disks: DiskLayoutData[], platform?: string) {
  const list = getDisplayStorageVolumes(volumes, platform)

  if (platform === 'darwin') {
    const total = list.reduce((sum, item) => sum + (item.size || 0), 0)
    const used = list.reduce((sum, item) => sum + (item.used || 0), 0)
    const percent = total > 0 ? Math.round(clampPercent((used / total) * 100) * 10) / 10 : 0
    return { total, used, percent }
  }

  const physicalTotal = getPhysicalDiskTotalBytes(disks)
  const total = physicalTotal > 0 ? physicalTotal : list.reduce((sum, item) => sum + (item.size || 0), 0)
  const rawUsed = list.reduce((sum, item) => sum + (item.used || 0), 0)
  const used = total > 0 ? Math.min(rawUsed, total) : rawUsed
  const percent = total > 0 ? clampPercent((used / total) * 100) : 0
  return { total, used, percent }
}

function isDarwinMemoryData(memory?: MemoData): boolean {
  return memory?.normalizedPlatform === 'darwin'
}

function getDisplayMemoryUsedBytes(memory?: MemoData): number {
  if (!memory) return 0
  if (isDarwinMemoryData(memory)) {
    return Number.isFinite(memory.used) && (memory.used || 0) > 0 ? (memory.used || 0) : (memory.active || 0)
  }
  return Number.isFinite(memory.active) && (memory.active || 0) > 0 ? (memory.active || 0) : (memory.used || 0)
}

function getDisplayMemoryAvailableBytes(memory?: MemoData): number {
  if (!memory) return 0
  if (isDarwinMemoryData(memory)) {
    return Number.isFinite(memory.free) && (memory.free || 0) > 0 ? (memory.free || 0) : (memory.available || 0)
  }
  return Number.isFinite(memory.available) && (memory.available || 0) > 0 ? (memory.available || 0) : (memory.free || 0)
}

function getDisplayMemoryUsagePercent(memory?: MemoData): number {
  if (!memory?.total) return 0
  return clampPercent((getDisplayMemoryUsedBytes(memory) / memory.total) * 100)
}

function getDisplayMemoryUsedLabel(memory?: MemoData): string {
  return isDarwinMemoryData(memory) ? '已占用内存' : '已用内存'
}

function getDisplayMemoryAvailableLabel(memory?: MemoData): string {
  return isDarwinMemoryData(memory) ? '空闲内存' : '可用内存'
}

type MemoryPressureLevel = NonNullable<MemoData['pressure']>['level']

const MEMORY_PRESSURE_ACCENTS: Record<MemoryPressureLevel, string> = {
  normal: '#79d84f',
  warning: '#ffb14d',
  critical: '#ff7f87',
  unknown: '#79d84f',
}

function getMemoryPressureLabel(level?: MemoryPressureLevel): string {
  switch (level) {
    case 'normal':
      return '正常'
    case 'warning':
      return '偏高'
    case 'critical':
      return '严重'
    default:
      return '未知'
  }
}

function getMemoryPressureDescription(level?: MemoryPressureLevel): string {
  switch (level) {
    case 'normal':
      return '系统内存压力正常。'
    case 'warning':
      return '系统正在承受一定内存压力，可能更积极地压缩内存或使用交换空间。'
    case 'critical':
      return '系统内存压力严重，应用可能卡顿，系统可能频繁压缩内存或使用交换空间。'
    default:
      return '无法读取 macOS 内存压力状态。'
  }
}

function getMemoryPressureAccent(level?: MemoryPressureLevel): string {
  return MEMORY_PRESSURE_ACCENTS[level || 'unknown']
}

export {
  bytesToGB,
  mbToGB,
  bytesToMB,
  bytesToKB,
  formatBytes,
  formatSpeed,
  formatUptime,
  clampPercent,
  formatDisplayResolution,
  getDisplayCpuCurrentSpeedGHz,
  getPhysicalDiskLayout,
  getPhysicalDiskTotalBytes,
  hasDiskHealthTelemetry,
  getDisplayStorageVolumes,
  getStorageUsageSummary,
  getDisplayMemoryUsedBytes,
  getDisplayMemoryAvailableBytes,
  getDisplayMemoryUsagePercent,
  getDisplayMemoryUsedLabel,
  getDisplayMemoryAvailableLabel,
  getMemoryPressureLabel,
  getMemoryPressureDescription,
  getMemoryPressureAccent,
}
