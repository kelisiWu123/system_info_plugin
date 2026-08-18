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

function formatSpeed(bytesPerSecond: number | null | undefined): string {
  return typeof bytesPerSecond === 'number' && Number.isFinite(bytesPerSecond) && bytesPerSecond >= 0
    ? `${formatBytes(bytesPerSecond)}/s`
    : '--'
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

function getInstalledMemoryBytes(layout?: Array<{ size?: number | null }> | null): number {
  if (!Array.isArray(layout)) return 0

  return layout.reduce((sum, item) => {
    const size = typeof item?.size === 'number' && Number.isFinite(item.size) ? item.size : 0
    return size > 0 ? sum + size : sum
  }, 0)
}

function getDisplayMemoryCapacityBytes(
  layout?: Array<{ size?: number | null }> | null,
  memory?: Pick<MemoData, 'total'> | null
): number {
  const installed = getInstalledMemoryBytes(layout)
  if (installed > 0) return installed

  return typeof memory?.total === 'number' && Number.isFinite(memory.total) && memory.total > 0
    ? memory.total
    : 0
}

function getDisplayMemoryCapacityLabel(layout?: Array<{ size?: number | null }> | null): string {
  return getInstalledMemoryBytes(layout) > 0 ? '已安装容量' : '系统可见总量'
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

function normalizeDiskProtocolText(disk: DiskLayoutData): string {
  const text = [
    cleanStorageText(disk.smartData?.device?.protocol),
    cleanStorageText(disk.smartData?.device?.type),
    cleanStorageText(disk.type),
    cleanStorageText(disk.interfaceType),
  ].join(' ').toLowerCase()

  if (text.includes('nvme')) return 'nvme'
  if (text.includes('sata')) return 'sata'
  if (text.includes('usb')) return 'usb'
  if (text.includes('pci')) return 'pcie'
  return text.trim()
}

function isNearSameDiskCapacity(first: DiskLayoutData, second: DiskLayoutData): boolean {
  const firstSize = first.size || 0
  const secondSize = second.size || 0
  if (firstSize <= 0 || secondSize <= 0) return false

  const largest = Math.max(firstSize, secondSize)
  const difference = Math.abs(firstSize - secondSize)
  return difference <= Math.max(512 * 1024 * 1024, largest * 0.005)
}

function isSparsePcieMirrorEntry(disk: DiskLayoutData): boolean {
  const serial = cleanStorageText(disk.serialNum)
  const firmware = cleanStorageText(disk.firmwareRevision)
  const type = cleanStorageText(disk.type).toLowerCase()
  const interfaceType = cleanStorageText(disk.interfaceType).toLowerCase()
  const genericPcie = type.includes('pci') && interfaceType.includes('pci') && !type.includes('nvme') && !interfaceType.includes('nvme')
  return !serial && !firmware && genericPcie
}

function isLikelyPhysicalDiskMirror(first: DiskLayoutData, second: DiskLayoutData): boolean {
  const firstName = cleanStorageText(first.name).toLowerCase()
  const secondName = cleanStorageText(second.name).toLowerCase()
  if (!firstName || firstName !== secondName || !isNearSameDiskCapacity(first, second)) return false

  const firstSerial = cleanStorageText(first.serialNum).toLowerCase()
  const secondSerial = cleanStorageText(second.serialNum).toLowerCase()
  if (firstSerial && secondSerial) return firstSerial === secondSerial

  const firstProtocol = normalizeDiskProtocolText(first)
  const secondProtocol = normalizeDiskProtocolText(second)
  if (firstProtocol && secondProtocol && firstProtocol !== secondProtocol) return false

  return (isSparsePcieMirrorEntry(first) && Boolean(secondSerial))
    || (isSparsePcieMirrorEntry(second) && Boolean(firstSerial))
}

function getDiskIdentityScore(disk: DiskLayoutData): number {
  let score = 0
  if (cleanStorageText(disk.serialNum)) score += 8
  if (cleanStorageText(disk.firmwareRevision)) score += 4
  if (disk.smartData?.device) score += 3
  if (cleanStorageText(disk.type).toLowerCase().includes('nvme')) score += 2
  if (cleanStorageText(disk.interfaceType).toLowerCase().includes('nvme')) score += 1
  return score
}

function collapsePhysicalDiskMirrorEntries(disks: DiskLayoutData[]): DiskLayoutData[] {
  const result: DiskLayoutData[] = []

  disks.forEach((disk) => {
    const duplicateIndex = result.findIndex((candidate) => isLikelyPhysicalDiskMirror(candidate, disk))
    if (duplicateIndex < 0) {
      result.push(disk)
      return
    }

    if (getDiskIdentityScore(disk) > getDiskIdentityScore(result[duplicateIndex])) {
      result[duplicateIndex] = disk
    }
  })

  return result
}

function getPhysicalDiskLayout(disks: DiskLayoutData[]): DiskLayoutData[] {
  const candidates = disks
    .filter((disk) => (disk.size || 0) > 0)
    .filter((disk) => !isLikelyVirtualDisk(disk))
    .filter((disk) => hasHardwareIdentity(disk))

  return Array.from(
    new Map(
      collapsePhysicalDiskMirrorEntries(candidates)
        .map((disk, index) => [getPhysicalDiskKey(disk, index), disk] as const)
    ).values()
  )
}

function getPhysicalDiskTotalBytes(disks: DiskLayoutData[]): number {
  return getPhysicalDiskLayout(disks).reduce((sum, disk) => sum + (disk.size || 0), 0)
}

const DISK_HEALTH_PLACEHOLDER_VALUES = new Set([
  'unknown',
  'unsupported',
  'unavailable',
  'not available',
  'n/a',
  'na',
  'none',
  '-',
  '--',
])

function isMeaningfulDiskHealthStatus(value: unknown): boolean {
  const normalized = cleanStorageText(value).toLowerCase()
  return Boolean(normalized) && !DISK_HEALTH_PLACEHOLDER_VALUES.has(normalized)
}

function hasDiskHealthTelemetry(disk: DiskLayoutData | undefined): boolean {
  if (!disk) return false

  const smartPassed = disk.smartData?.smart_status?.passed
  if (typeof smartPassed === 'boolean') return true

  if (isMeaningfulDiskHealthStatus(disk.smartStatus)) return true

  const nvmeHealth = disk.smartData?.nvme_smart_health_information_log
  if (nvmeHealth && (
    typeof nvmeHealth.critical_warning === 'number'
    || typeof nvmeHealth.percentage_used === 'number'
    || typeof nvmeHealth.media_errors === 'number'
  )) return true

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
  const physicalTotal = getPhysicalDiskTotalBytes(disks)
  const mountedTotal = list.reduce((sum, item) => sum + (item.size || 0), 0)
  const total = physicalTotal > 0 ? physicalTotal : mountedTotal
  const rawUsed = list.reduce((sum, item) => sum + (item.used || 0), 0)
  const used = total > 0 ? Math.min(rawUsed, total) : rawUsed
  const percent = total > 0 ? Math.round(clampPercent((used / total) * 100) * 10) / 10 : 0
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
  getInstalledMemoryBytes,
  getDisplayMemoryCapacityBytes,
  getDisplayMemoryCapacityLabel,
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
