import { getMemoryPressureAccent } from '../utils'

type WatchMemoryPressureLevel = 'normal' | 'warning' | 'critical' | 'unknown'
type WatchMode = 'overview' | 'cpu' | 'gpu'

export interface WatchPalette {
  icon: string
  fill: string
  stroke: string
  progress: string
  border: string
}

export function formatWatchRuntime(seconds?: number) {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return '--:--:--'

  const whole = Math.floor(seconds)
  const days = Math.floor(whole / 86400)
  const hours = Math.floor((whole % 86400) / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const remainingSeconds = whole % 60
  const clock = [hours, minutes, remainingSeconds].map((value) => String(value).padStart(2, '0')).join(':')

  return days > 0 ? `${days}天 ${clock}` : clock
}

export interface WatchCpuSpeedSourceLike {
  source?: 'powermetrics' | 'systeminformation' | 'LibreHardwareMonitor' | 'OpenHardwareMonitor'
  helper?: boolean
  nativeErrorCode?: string
}

export interface WatchOverviewSideItem {
  id: 'temperature' | 'power'
  icon: 'temperature' | 'dashboard'
  label: string
  value: string
}

export type WatchCpuAuxMetricId = 'voltage' | 'fan'

export function getWatchOverviewSideColumnCount(itemCount: number): 1 | 2 {
  return itemCount >= 3 ? 2 : 1
}

export const WATCH_MODE_POLL_PROFILES: Record<WatchMode, {
  fast: number
  slow: number
  cpuTemp: number
  cpuPower: number
  cpuAux: number
  gpu: number
}> = {
  overview: {
    fast: 2500,
    slow: 7000,
    cpuTemp: 4500,
    cpuPower: 10000,
    cpuAux: 0,
    gpu: 7000,
  },
  cpu: {
    fast: 2200,
    slow: 12000,
    cpuTemp: 4500,
    cpuPower: 10000,
    cpuAux: 10000,
    gpu: 12000,
  },
  gpu: {
    fast: 2200,
    slow: 2500,
    cpuTemp: 0,
    cpuPower: 0,
    cpuAux: 0,
    gpu: 2500,
  },
} as const

const CPU_WATCH_PALETTE: WatchPalette = {
  icon: '#a775ff',
  fill: 'rgba(167, 117, 255, 0.22)',
  stroke: '#a775ff',
  progress: 'linear-gradient(90deg, #9568ff, #b98dff)',
  border: 'rgba(167, 117, 255, 0.34)',
}

const GPU_WATCH_PALETTE: WatchPalette = {
  icon: '#8ff4ff',
  fill: 'rgba(143, 244, 255, 0.42)',
  stroke: '#8ff4ff',
  progress: 'linear-gradient(90deg, #2fd8ff, #b7fbff)',
  border: 'rgba(143, 244, 255, 0.56)',
}

const MEMORY_NORMAL_PALETTE: WatchPalette = {
  icon: getMemoryPressureAccent('normal'),
  fill: 'rgba(121, 216, 79, 0.22)',
  stroke: getMemoryPressureAccent('normal'),
  progress: 'linear-gradient(90deg, #67c93f, #8de061)',
  border: 'rgba(121, 216, 79, 0.34)',
}

const MEMORY_WARNING_PALETTE: WatchPalette = {
  icon: getMemoryPressureAccent('warning'),
  fill: 'rgba(255, 177, 77, 0.22)',
  stroke: getMemoryPressureAccent('warning'),
  progress: 'linear-gradient(90deg, #ff9f36, #ffc164)',
  border: 'rgba(255, 177, 77, 0.34)',
}

const MEMORY_CRITICAL_PALETTE: WatchPalette = {
  icon: getMemoryPressureAccent('critical'),
  fill: 'rgba(255, 127, 135, 0.22)',
  stroke: getMemoryPressureAccent('critical'),
  progress: 'linear-gradient(90deg, #ff6b75, #ff9299)',
  border: 'rgba(255, 127, 135, 0.34)',
}

export function getWatchCpuPalette(): WatchPalette {
  return CPU_WATCH_PALETTE
}

export function getWatchGpuPalette(): WatchPalette {
  return GPU_WATCH_PALETTE
}

export function getWatchMemoryPalette(platform?: string, level?: WatchMemoryPressureLevel): WatchPalette {
  if (platform !== 'darwin') return MEMORY_NORMAL_PALETTE
  if (level === 'warning') return MEMORY_WARNING_PALETTE
  if (level === 'critical') return MEMORY_CRITICAL_PALETTE
  return MEMORY_NORMAL_PALETTE
}

export function formatWatchCpuSpeedSourceLabel(speed: WatchCpuSpeedSourceLike | undefined) {
  if (speed?.source === 'powermetrics' && speed.helper) return '传感器增强'
  if (speed?.source === 'powermetrics') return '增强采样'
  if (speed?.source === 'systeminformation' && speed.nativeErrorCode === 'MACOS_POWERMETRICS_HELPER_UNAVAILABLE') return '内置采集'
  if (speed?.source === 'systeminformation' && speed.nativeErrorCode === 'MACOS_POWERMETRICS_PERMISSION_REQUIRED') {
    return '可启用传感器增强'
  }
  if (speed?.source === 'systeminformation') return '内置采集'
  if (speed?.source === 'LibreHardwareMonitor') return 'LibreHardwareMonitor'
  if (speed?.source === 'OpenHardwareMonitor') return 'OpenHardwareMonitor'
  return '未知来源'
}

export function buildWatchCpuOverviewSideItems(input: {
  temperatureValue: string
  powerValue: string
}): WatchOverviewSideItem[] {
  return [
    {
      id: 'temperature',
      icon: 'temperature',
      label: '温度',
      value: input.temperatureValue,
    },
    {
      id: 'power',
      icon: 'dashboard',
      label: '功耗',
      value: input.powerValue,
    },
  ]
}

export function getWatchCpuAuxMetricIds(platform?: string): WatchCpuAuxMetricId[] {
  return platform === 'darwin' ? ['fan'] : ['voltage']
}
