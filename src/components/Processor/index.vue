<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import {
  activateProcessorHardwareStore,
  deactivateProcessorHardwareStore,
  processorHardwareStore,
  refreshProcessorHardwareDynamicMetrics,
} from '../../composables/useProcessorHardwareData'
import { clampPercent, formatUptime, getDisplayCpuCurrentSpeedGHz } from '../../utils'
import { getSensorEnhancementActionLabel, getSensorEnhancementPlatform } from '../../utils/platform'
import { getProcessorAuxDisplayMode, getProcessorIdlePercent } from '../../utils/processor'

const props = defineProps<{
  active?: boolean
}>()

type MetricHistoryKey = 'load' | 'temp' | 'speed' | 'voltage' | 'power'

interface MonitorCard {
  id: string
  label: string
  value: string
  unit?: string
  accent: string
  percent: number
  trend: number[]
  footerLeft?: string
  footerRight?: string
  unsupported?: boolean
}

interface CoreRow {
  id: string
  label: string
  type: string
  speed: number | null
  load: number | null
  temperature: number | null
}

const stressState = ref<'idle' | 'pending'>('idle')
const {
  loading,
  lastSyncedAt,
  cpuData,
  cpuTemperature,
  cpuPower,
  cpuVoltage,
  cpuFanSpeed,
  cpuCurrentSpeed,
  cpuLoadData,
  boardData,
  biosData,
  osInfo,
  timeInfo,
} = processorHardwareStore

const metricHistory: Record<MetricHistoryKey, number[]> = {
  load: processorHardwareStore.metricHistory.cpuLoad,
  temp: processorHardwareStore.metricHistory.cpuTemp,
  speed: processorHardwareStore.metricHistory.cpuSpeed,
  voltage: processorHardwareStore.metricHistory.cpuVoltage,
  power: processorHardwareStore.metricHistory.cpuPower,
}

const subscribed = ref(false)
const showSensorEnhancementPanel = ref(false)
const sensorSettingsLoading = ref(false)
const sensorActionLoading = ref(false)
const macHelperActionMessage = ref('')
const sensorSettings = ref<HardwareSensorSettingsData>({
  enhancedSensorEnabled: false,
  openHardwareMonitorAutoStart: false,
  openHardwareMonitorPort: 18085,
})
const openHardwareMonitorStatus = ref<OpenHardwareMonitorStatusData | null>(null)
const macHelperStatus = ref<MacPowermetricsHelperStatusData | null>(null)

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function joinParts(parts: Array<string | number | null | undefined>, separator = ' ') {
  return parts
    .map((part) => (typeof part === 'number' ? String(part) : cleanText(part)))
    .filter(Boolean)
    .join(separator)
}

function safeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function getHistoryMin(values: number[]) {
  if (!values.length) return 0
  return Math.min(...values)
}

function getHistoryMax(values: number[], fallback = 0) {
  if (!values.length) return fallback
  return Math.max(fallback, ...values)
}

function ringStyle(percent: number, accent: string) {
  const bounded = Math.max(0, Math.min(100, percent))
  return {
    background: `conic-gradient(${accent} 0deg ${(bounded / 100) * 360}deg, rgba(255, 255, 255, 0.08) ${(bounded / 100) * 360}deg 360deg)`,
  }
}

function sparklinePoints(values: number[]) {
  const source = values.length ? values : [0, 0, 0, 0, 0, 0]
  const min = Math.min(...source)
  const max = Math.max(...source)
  const range = Math.max(1, max - min)
  const step = source.length > 1 ? 116 / (source.length - 1) : 116

  return source
    .map((value, index) => {
      const x = Number((index * step).toFixed(2))
      const y = Number((34 - ((value - min) / range) * 24).toFixed(2))
      return `${x},${y}`
    })
    .join(' ')
}

function formatSyncTime(value?: number) {
  if (!value) return '--:--:--'
  return new Date(value).toLocaleString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function formatCacheSize(value: number) {
  if (!value) return '--'
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  if (value >= 1024) return `${(value / 1024).toFixed(1)} MB`
  return `${value} KB`
}

function formatFrequency(value: number | null, digits = 2) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? `${value.toFixed(digits)} GHz` : '--'
}

function formatTemperature(value: number | null) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? `${Math.round(value)}°C` : '暂不支持'
}

function formatPower(value: number | null) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? `${Math.round(value)} W` : '暂不支持'
}

function formatVoltage(value: number | null) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? `${value.toFixed(2)} V` : '暂不支持'
}

function formatFanSpeed(value: number | null) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? `${Math.round(value)} RPM` : '暂不支持'
}

function formatSensorReason(reason?: string) {
  switch (reason) {
    case 'ENHANCED_SENSOR_DISABLED':
      return '增强模式未开启'
    case 'OHM_EXE_NOT_FOUND':
      return '组件不存在'
    case 'OHM_NOT_RUNNING':
      return '未运行'
    case 'OHM_AUTOSTART_DISABLED':
      return '自动启动未开启'
    case 'OHM_START_COOLDOWN':
      return '启动冷却中'
    case 'OHM_START_FAILED':
      return '启动失败'
    case 'OHM_START_PENDING':
      return '启动中'
    case 'OHM_HTTP_UNAVAILABLE':
      return '本地服务不可达'
    case 'OHM_HTTP_BAD_STATUS':
      return '本地服务状态异常'
    case 'OHM_NO_CPU_TEMP_SENSOR':
      return '没有可信 CPU 温度传感器'
    case 'OHM_DIRECTORY_OPENED':
      return '目录已打开'
    case 'OHM_OPEN_DIRECTORY_FAILED':
      return '打开目录失败'
    case 'OHM_USERDATA_UNAVAILABLE':
      return '本地数据目录不可用'
    case 'OHM_RUNTIME_COPY_FAILED':
      return '组件释放失败'
    case 'TEMPERATURE_UNAVAILABLE':
    case 'CPU_TEMPERATURE_UNAVAILABLE':
      return 'CPU 温度不可用'
    case 'MACOS_SMC_PERMISSION_REQUIRED':
      return 'AppleSMC 需要管理员权限'
    case 'MACOS_SMC_SENSOR_FAILED':
      return 'AppleSMC 读取失败'
    case 'MACOS_SMC_SENSOR_EMPTY':
      return 'AppleSMC 未返回温度'
    case 'CPU_TEMPERATURE_EXCEPTION':
      return '温度服务执行失败'
    default:
      return reason || '未检测'
  }
}

function formatTemperatureSource(source?: CpuTemperatureData['source']) {
  switch (source) {
    case 'systeminformation':
      return 'systeminformation'
    case 'apple-smc':
      return 'AppleSMC'
    case 'macos-temperature-sensor':
      return 'macOS 原生传感器'
    case 'LibreHardwareMonitor':
      return 'LibreHardwareMonitor WMI'
    case 'OpenHardwareMonitor':
      return 'OpenHardwareMonitor'
    case 'unsupported':
      return '不可用'
    default:
      return '--'
  }
}

function formatCpuSpeedSource(speed: CpuCurrentSpeedData) {
  if (speed.source === 'powermetrics' && speed.helper) return 'powermetrics helper'
  if (speed.source === 'powermetrics') return 'powermetrics native'
  if (speed.source === 'systeminformation' && speed.nativeErrorCode === 'MACOS_POWERMETRICS_HELPER_UNAVAILABLE') return 'systeminformation fallback / helper 未安装'
  if (speed.source === 'systeminformation' && speed.nativeErrorCode === 'MACOS_POWERMETRICS_PERMISSION_REQUIRED') {
    return 'systeminformation fallback / 需安装 helper'
  }
  if (speed.source === 'systeminformation') return 'systeminformation'
  if (speed.source === 'LibreHardwareMonitor') return 'LibreHardwareMonitor'
  if (speed.source === 'OpenHardwareMonitor') return 'OpenHardwareMonitor'
  return '未知来源'
}

function formatCpuPowerSource(power?: CpuPowerData) {
  if (power?.source === 'powermetrics' && power.helper) return 'powermetrics helper'
  if (power?.source === 'powermetrics') return 'powermetrics'
  if (power?.source === 'LibreHardwareMonitor') return 'LibreHardwareMonitor'
  if (power?.source === 'OpenHardwareMonitor') return 'OpenHardwareMonitor'
  return '功耗来源未知'
}

function parseVoltageString(value?: string) {
  const normalized = Number.parseFloat(cleanText(value))
  return Number.isFinite(normalized) && normalized > 0 ? normalized : null
}

function parseFlagHighlights(flags?: string) {
  const list = cleanText(flags)
    .split(/\s+/)
    .map((item) => item.toUpperCase())
    .filter(Boolean)

  const preferred = ['SSE4.2', 'AVX2', 'AVX512F', 'AES', 'VT-X', 'VT-D', 'SMEP', 'SHA', 'FMA3']
  const picked = preferred.filter((item) => list.includes(item))
  const fallback = list.slice(0, 4)
  return (picked.length ? picked : fallback).join(', ') || '--'
}

function vendorBadgeData(brand: string) {
  const lower = brand.toLowerCase()

  const appleChipMatch = brand.match(/\b(M[1-9](?:\s+(?:Pro|Max|Ultra))?)\b/i)

  if (lower.includes('apple') || appleChipMatch) {
    return {
      top: 'apple',
      middle: appleChipMatch?.[1]?.toUpperCase() || 'APPLE',
      bottom: 'soc',
      variant: 'apple',
      compact: true,
    }
  }

  if (lower.includes('intel')) {
    const tierMatch = brand.match(/i[3579]/i)
    return {
      top: 'intel',
      middle: 'CORE',
      bottom: tierMatch ? tierMatch[0].toLowerCase() : 'cpu',
      variant: 'intel',
      compact: false,
    }
  }

  if (lower.includes('amd') || lower.includes('ryzen')) {
    const tierMatch = brand.match(/(ryzen\s+\d|ai\s+\d+)/i)
    return {
      top: 'amd',
      middle: 'RYZEN',
      bottom: tierMatch ? tierMatch[0].replace(/\s+/g, ' ').toLowerCase() : 'cpu',
      variant: 'amd',
      compact: false,
    }
  }

  return {
    top: 'cpu',
    middle: 'CHIP',
    bottom: 'info',
    variant: 'generic',
    compact: true,
  }
}

function coreTypeLabel(index: number, total: number, performanceCores?: number, efficiencyCores?: number) {
  const perf = performanceCores || 0
  const eff = efficiencyCores || 0

  if (perf > 0 && eff > 0 && perf + eff <= total) {
    if (index < perf) return 'P-Core'
    if (index < perf + eff) return 'E-Core'
  }

  return 'Core'
}

async function writeClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  document.body.removeChild(textarea)

  if (!copied) {
    throw new Error('execCommand copy failed')
  }
}

const cpuTemperatureValue = computed(() => {
  if (typeof cpuTemperature.value?.value === 'number') return cpuTemperature.value.value
  if (typeof cpuTemperature.value?.main === 'number') return cpuTemperature.value.main
  return null
})
const cpuTemperatureIssueLabel = computed(() => {
  const reason = cpuTemperature.value?.reason || cpuTemperature.value?.errorCode || ''
  if (reason === 'MACOS_SMC_PERMISSION_REQUIRED') return '需要管理员权限'
  if (reason.startsWith('MACOS_SMC_')) return 'AppleSMC 读取失败'
  if (cpuTemperature.value?.source === 'unsupported' && cpuTemperatureValue.value === null) return '暂不支持'
  return '--'
})

const cpuPowerValue = computed(() => safeNumber(cpuPower.value?.value))
const cpuVoltageValue = computed(() => safeNumber(cpuVoltage.value?.value) ?? parseVoltageString(cpuData.value?.voltage))
const cpuFanSpeedValue = computed(() => safeNumber(cpuFanSpeed.value?.value))
const cpuLoadPercent = computed(() => clampPercent(cpuLoadData.value.currentLoad || 0))
const cpuIdlePercent = computed(() => getProcessorIdlePercent(cpuLoadData.value))
const currentSpeedValue = computed(() => {
  const value = getDisplayCpuCurrentSpeedGHz(cpuCurrentSpeed.value)
  return value > 0 ? value : null
})
const currentSpeedMax = computed(() => safeNumber(cpuCurrentSpeed.value.max) || safeNumber(cpuData.value?.speedMax) || 0)
const currentSpeedSourceLabel = computed(() => formatCpuSpeedSource(cpuCurrentSpeed.value))
const sensorEnhancementPlatform = computed(() => getSensorEnhancementPlatform(osInfo.value))
const processorAuxDisplayMode = computed(() => getProcessorAuxDisplayMode(sensorEnhancementPlatform.value))
const isWindowsPlatform = computed(() => sensorEnhancementPlatform.value === 'windows')
const isMacPlatform = computed(() => sensorEnhancementPlatform.value === 'macos')
const sensorEnhancementActionLabel = computed(() =>
  getSensorEnhancementActionLabel(sensorEnhancementPlatform.value, showSensorEnhancementPanel.value)
)
const cpuTemperatureSourceLabel = computed(() => formatTemperatureSource(cpuTemperature.value?.source))
const cpuTemperatureReasonLabel = computed(() => formatSensorReason(cpuTemperature.value?.reason || cpuTemperature.value?.errorCode))
const openHardwareMonitorStatusLabel = computed(() => {
  if (!openHardwareMonitorStatus.value) return '未检测'
  if (openHardwareMonitorStatus.value.running) return '运行中'
  if (!openHardwareMonitorStatus.value.executableExists) return '组件缺失'
  return formatSensorReason(openHardwareMonitorStatus.value.reason)
})
const sensorEnhancementSummary = computed(() => {
  if (!sensorSettings.value.enhancedSensorEnabled) return '增强模式关闭'
  if (openHardwareMonitorStatus.value?.running) return '增强模式已启用，OHM 正在运行'
  return '增强模式已启用，将在温度缺失时自动尝试启动 OHM'
})
const sensorEnhancementSuggestion = computed(() => {
  if (cpuTemperature.value?.suggestion) return cpuTemperature.value.suggestion
  return openHardwareMonitorStatus.value?.suggestion || ''
})
const macHelperStatusLabel = computed(() => {
  if (!macHelperStatus.value) return '未检测'
  if (macHelperStatus.value.loaded && macHelperStatus.value.socketExists) return '运行中'
  if (macHelperStatus.value.installed) return '已安装未就绪'
  if (!macHelperStatus.value.bundledExists) return '组件缺失'
  return '未安装'
})
const macHelperSummary = computed(() => {
  if (!macHelperStatus.value) return '增强状态未检测'
  if (macHelperStatus.value.loaded && macHelperStatus.value.socketExists) return '增强模式已启用，频率与 GPU 遥测优先走 powermetrics'
  if (macHelperStatus.value.installed) return '增强组件已安装但还未就绪'
  return '安装增强组件后可免每次授权读取 CPU 频率，并补齐 Apple Silicon GPU 遥测'
})
const macHelperSuggestion = computed(() => macHelperStatus.value?.suggestion || cpuCurrentSpeed.value.nativeSuggestion || '')

const healthState = computed(() => {
  const temperature = cpuTemperatureValue.value
  const load = cpuLoadPercent.value

  if (typeof temperature === 'number' && temperature >= 90) {
    return {
      title: '负载偏高',
      subtitle: 'CPU 当前温度接近上限，需要关注散热',
      accent: 'var(--accent-orange)',
    }
  }

  if (load >= 85) {
    return {
      title: '负载繁忙',
      subtitle: 'CPU 当前正在执行高负载任务',
      accent: 'var(--accent-yellow)',
    }
  }

  return {
    title: '运行良好',
    subtitle: 'CPU 当前状态正常',
    accent: 'var(--accent-green)',
  }
})

const vendorBadge = computed(() => vendorBadgeData(cpuData.value?.brand || ''))

const primarySpecs = computed(() => [
  {
    label: '核心 / 线程',
    value: joinParts([
      cpuData.value?.physicalCores ? `${cpuData.value.physicalCores} 核` : '',
      cpuData.value?.cores ? `${cpuData.value.cores} 线程` : '',
    ], ' / ') || '--',
  },
  {
    label: 'P-Core / E-Core',
    value:
      cpuData.value?.performanceCores || cpuData.value?.efficiencyCores
        ? joinParts([
            cpuData.value?.performanceCores ? `${cpuData.value.performanceCores}P` : '',
            cpuData.value?.efficiencyCores ? `${cpuData.value.efficiencyCores}E` : '',
          ], ' + ')
        : '--',
  },
  {
    label: '基础频率',
    value: formatFrequency(safeNumber(cpuData.value?.speed)),
  },
  {
    label: '最大频率',
    value: formatFrequency(safeNumber(cpuData.value?.speedMax)),
  },
  {
    label: '插槽',
    value: cleanText(cpuData.value?.socket) || '--',
  },
  {
    label: processorAuxDisplayMode.value === 'fan' ? '风扇 / 当前功耗' : '电压 / 当前功耗',
    value: joinParts([
      processorAuxDisplayMode.value === 'fan' ? formatFanSpeed(cpuFanSpeedValue.value) : formatVoltage(cpuVoltageValue.value),
      formatPower(cpuPowerValue.value),
    ], ' / '),
  },
])

const quickStats = computed(() => [
  {
    id: 'temp',
    label: '温度',
    value: cpuTemperatureValue.value === null ? cpuTemperatureIssueLabel.value : formatTemperature(cpuTemperatureValue.value),
    accent: 'var(--accent-blue)',
    trend: metricHistory.temp,
  },
  {
    id: 'power',
    label: '功耗',
    value: formatPower(cpuPowerValue.value),
    accent: 'var(--accent-orange)',
    trend: metricHistory.power,
  },
  {
    id: 'load',
    label: '使用率',
    value: `${Math.round(cpuLoadPercent.value)}%`,
    accent: 'var(--accent-blue)',
    trend: metricHistory.load,
  },
])

const monitorCards = computed<MonitorCard[]>(() => [
  {
    id: 'load',
    label: 'CPU 使用率',
    value: `${Math.round(cpuLoadPercent.value)}%`,
    accent: 'var(--accent-blue)',
    percent: cpuLoadPercent.value,
    trend: metricHistory.load,
    footerLeft: `最低 ${Math.round(getHistoryMin(metricHistory.load))}%`,
    footerRight: `最高 ${Math.round(getHistoryMax(metricHistory.load, cpuLoadPercent.value))}%`,
  },
  {
    id: 'temp',
    label: 'CPU 温度',
    value: cpuTemperatureValue.value === null ? cpuTemperatureIssueLabel.value : formatTemperature(cpuTemperatureValue.value),
    accent: 'var(--accent-green)',
    percent: clampPercent(((cpuTemperatureValue.value || 0) / 100) * 100),
    trend: metricHistory.temp,
    footerLeft: cpuTemperatureValue.value === null ? cpuTemperatureReasonLabel.value : `最低 ${Math.round(getHistoryMin(metricHistory.temp))}°C`,
    footerRight: `最高 ${Math.round(getHistoryMax(metricHistory.temp, cpuTemperatureValue.value || 0))}°C`,
    unsupported: cpuTemperature.value?.source === 'unsupported' && cpuTemperatureValue.value === null,
  },
  {
    id: 'speed',
    label: '当前频率',
    value: formatFrequency(currentSpeedValue.value),
    unit: currentSpeedValue.value ? 'GHz' : '',
    accent: 'var(--accent-blue)',
    percent: currentSpeedMax.value > 0 ? clampPercent(((currentSpeedValue.value || 0) / currentSpeedMax.value) * 100) : 0,
    trend: metricHistory.speed,
    footerLeft: `来源 ${currentSpeedSourceLabel.value}`,
    footerRight: `峰值 ${formatFrequency(getHistoryMax(metricHistory.speed, currentSpeedValue.value || 0))}`,
  },
  processorAuxDisplayMode.value === 'fan'
    ? {
        id: 'fan-primary',
        label: 'CPU 风扇',
        value: formatFanSpeed(cpuFanSpeedValue.value),
        unit: '',
        accent: 'var(--accent-purple)',
        percent: cpuFanSpeedValue.value ? clampPercent((cpuFanSpeedValue.value / Math.max(cpuFanSpeedValue.value, safeNumber(cpuFanSpeed.value?.max) || 4000)) * 100) : 0,
        trend: [],
        footerLeft: cpuFanSpeed.value?.sensorName || '风扇传感器',
        footerRight: cpuFanSpeed.value?.source === 'apple-smc' ? 'AppleSMC' : cpuFanSpeed.value?.source || '',
        unsupported: cpuFanSpeedValue.value === null,
      }
    : {
        id: 'voltage',
        label: '核心电压',
        value: formatVoltage(cpuVoltageValue.value),
        unit: cpuVoltageValue.value ? 'V' : '',
        accent: 'var(--accent-purple)',
        percent: cpuVoltageValue.value ? clampPercent((cpuVoltageValue.value / Math.max(cpuVoltageValue.value, safeNumber(cpuVoltage.value?.max) || 1.6)) * 100) : 0,
        trend: metricHistory.voltage,
        footerLeft: `最低 ${getHistoryMin(metricHistory.voltage).toFixed(2)} V`,
        footerRight: `最高 ${getHistoryMax(metricHistory.voltage, cpuVoltageValue.value || 0).toFixed(2)} V`,
        unsupported: cpuVoltageValue.value === null,
      },
  {
    id: 'power',
    label: '当前功耗',
    value: formatPower(cpuPowerValue.value),
    unit: cpuPowerValue.value ? 'W' : '',
    accent: 'var(--accent-orange)',
    percent: cpuPowerValue.value ? clampPercent((cpuPowerValue.value / Math.max(cpuPowerValue.value, 125)) * 100) : 0,
    trend: metricHistory.power,
    footerLeft: `来源 ${formatCpuPowerSource(cpuPower.value)}`,
    footerRight: `最高 ${Math.round(getHistoryMax(metricHistory.power, cpuPowerValue.value || 0))} W`,
    unsupported: cpuPowerValue.value === null,
  },
  ...(processorAuxDisplayMode.value === 'fan'
    ? []
    : [{
        id: 'fan',
        label: 'CPU 风扇',
        value: formatFanSpeed(cpuFanSpeedValue.value),
        unit: '',
        accent: 'var(--accent-blue)',
        percent: cpuFanSpeedValue.value ? clampPercent((cpuFanSpeedValue.value / Math.max(cpuFanSpeedValue.value, safeNumber(cpuFanSpeed.value?.max) || 4000)) * 100) : 0,
        trend: [],
        footerLeft: cpuFanSpeed.value?.sensorName || '风扇传感器',
        footerRight: cpuFanSpeed.value?.source === 'apple-smc' ? 'AppleSMC' : cpuFanSpeed.value?.source || '',
        unsupported: cpuFanSpeedValue.value === null,
      }]
    ),
])

const allCoreRows = computed<CoreRow[]>(() => {
  const speedCores = cpuCurrentSpeed.value.cores || []
  const loadCores = cpuLoadData.value.cpus || []
  const temperatureCores = cpuTemperature.value?.cores || []
  const architectureCoreCount = (cpuData.value?.performanceCores || 0) + (cpuData.value?.efficiencyCores || 0)
  const knownCoreCount = architectureCoreCount || cpuData.value?.physicalCores || 0
  const total = Math.max(
    knownCoreCount,
    knownCoreCount ? Math.min(speedCores.length, knownCoreCount) : speedCores.length,
    knownCoreCount ? Math.min(loadCores.length, knownCoreCount) : loadCores.length,
    0
  )

  return Array.from({ length: total }, (_, index) => ({
    id: `core-${index}`,
    label: `${coreTypeLabel(index, total, cpuData.value?.performanceCores, cpuData.value?.efficiencyCores)} ${index}`,
    type: coreTypeLabel(index, total, cpuData.value?.performanceCores, cpuData.value?.efficiencyCores),
    speed: safeNumber(speedCores[index]) ?? currentSpeedValue.value,
    load: safeNumber(loadCores[index]?.load),
    temperature: safeNumber(temperatureCores[index]) ?? cpuTemperatureValue.value,
  }))
})

const performanceCoreRows = computed(() => allCoreRows.value.filter((item) => item.type === 'P-Core'))
const efficiencyCoreRows = computed(() => allCoreRows.value.filter((item) => item.type === 'E-Core'))
const genericCoreRows = computed(() => allCoreRows.value.filter((item) => item.type === 'Core'))

const detailSpecs = computed(() => [
  ...(isWindowsPlatform.value
    ? [{
        label: '空闲率',
        value: `${Math.round(cpuIdlePercent.value)}%`,
      }]
    : []),
  {
    label: 'L1 缓存',
    value: formatCacheSize((cpuData.value?.cache?.l1d || 0) + (cpuData.value?.cache?.l1i || 0)),
  },
  {
    label: 'L2 缓存',
    value: formatCacheSize(cpuData.value?.cache?.l2 || 0),
  },
  {
    label: 'L3 缓存',
    value: formatCacheSize(cpuData.value?.cache?.l3 || 0),
  },
  {
    label: '指令集',
    value: parseFlagHighlights(cpuData.value?.flags),
  },
  {
    label: '虚拟化',
    value: cpuData.value?.virtualization ? '已启用' : '未启用',
  },
  {
    label: '处理器组',
    value: cpuData.value?.processors ? `${cpuData.value.processors} 个` : '--',
  },
  {
    label: '核心架构',
    value:
      cpuData.value?.performanceCores || cpuData.value?.efficiencyCores
        ? joinParts([
            cpuData.value?.performanceCores ? 'P-Core' : '',
            cpuData.value?.efficiencyCores ? 'E-Core' : '',
            '混合架构',
          ])
        : '统一架构',
  },
  {
    label: '微架构',
    value: cleanText(cpuData.value?.family) || cleanText(cpuData.value?.vendor) || '--',
  },
  {
    label: '制造商',
    value: cleanText(cpuData.value?.manufacturer) || '--',
  },
])

const platformSpecs = computed(() => [
  {
    label: '主板',
    value: joinParts([boardData.value?.manufacturer, boardData.value?.model]) || '--',
  },
  {
    label: 'BIOS 版本',
    value: joinParts([biosData.value?.version, biosData.value?.releaseDate ? `(${biosData.value.releaseDate})` : '']) || '--',
  },
  {
    label: '处理器插槽',
    value: cleanText(cpuData.value?.socket) || '--',
  },
  {
    label: '制造商 / Vendor',
    value: joinParts([cpuData.value?.manufacturer, cpuData.value?.vendor], ' / ') || '--',
  },
  {
    label: '操作系统',
    value: joinParts([osInfo.value?.distro || osInfo.value?.platform, osInfo.value?.release, osInfo.value?.arch]) || '--',
  },
  {
    label: '运行时间',
    value: formatUptime(timeInfo.value?.uptime || 0),
  },
])

const processorReportText = computed(() => {
  const lines = [
    '处理器页面报告',
    `导出时间：${new Date().toLocaleString('zh-CN')}`,
    '',
    `处理器：${cpuData.value?.brand || '--'}`,
    `家族信息：${joinParts([cpuData.value?.family, cpuData.value?.vendor], ' / ') || '--'}`,
    `核心 / 线程：${joinParts([cpuData.value?.physicalCores ? `${cpuData.value.physicalCores} 核` : '', cpuData.value?.cores ? `${cpuData.value.cores} 线程` : ''], ' / ') || '--'}`,
    `当前温度：${formatTemperature(cpuTemperatureValue.value)}`,
    `当前功耗：${formatPower(cpuPowerValue.value)}`,
    `${processorAuxDisplayMode.value === 'fan' ? '当前风扇' : '当前电压'}：${processorAuxDisplayMode.value === 'fan' ? formatFanSpeed(cpuFanSpeedValue.value) : formatVoltage(cpuVoltageValue.value)}`,
    `当前频率：${formatFrequency(currentSpeedValue.value)}`,
    `当前负载：${Math.round(cpuLoadPercent.value)}%`,
    '',
    ...detailSpecs.value.map((item) => `${item.label}：${item.value}`),
    '',
    ...platformSpecs.value.map((item) => `${item.label}：${item.value}`),
  ]

  return lines.join('\n')
})

function exportReport() {
  const blob = new Blob([processorReportText.value], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `processor-report-${new Date().toISOString().slice(0, 10)}.txt`
  anchor.click()
  URL.revokeObjectURL(url)
}

async function copyProcessorInfo() {
  try {
    await writeClipboard(processorReportText.value)
    return true
  } catch (error) {
    console.error('复制处理器信息失败:', error)
    return false
  }
}

async function refreshHardwareSensorState() {
  if (!isWindowsPlatform.value) return

  sensorSettingsLoading.value = true

  try {
    openHardwareMonitorStatus.value = {
      ...openHardwareMonitorStatus.value,
      reason: '检测中...',
      suggestion: '正在读取 OpenHardwareMonitor 当前状态',
    } as OpenHardwareMonitorStatusData
    const [settings, status] = await Promise.all([
      window.services.getHardwareSensorSettings(),
      window.services.getOpenHardwareMonitorStatus(),
    ])
    sensorSettings.value = settings
    openHardwareMonitorStatus.value = status
  } catch (error) {
    console.error('读取硬件传感器增强状态失败:', error)
  } finally {
    sensorSettingsLoading.value = false
  }
}

async function refreshMacPowermetricsHelperState() {
  if (!isMacPlatform.value) return

  sensorSettingsLoading.value = true

  try {
    macHelperStatus.value = await window.services.getMacPowermetricsHelperStatus()
    macHelperActionMessage.value = ''
  } catch (error) {
    console.error('读取 macOS powermetrics helper 状态失败:', error)
  } finally {
    sensorSettingsLoading.value = false
  }
}

async function installMacPowermetricsHelper() {
  if (!isMacPlatform.value) return

  sensorActionLoading.value = true

  try {
    macHelperActionMessage.value = '正在安装 helper，并等待 LaunchDaemon 就绪...'
    macHelperStatus.value = await window.services.installMacPowermetricsHelper()
    macHelperActionMessage.value = macHelperStatus.value.loaded && macHelperStatus.value.socketExists
      ? 'helper 已就绪，正在刷新频率来源...'
      : 'helper 已安装，仍在等待系统服务就绪'
    await refreshProcessorHardwareDynamicMetrics()
    macHelperStatus.value = await window.services.getMacPowermetricsHelperStatus()
  } catch (error) {
    console.error('安装 macOS powermetrics helper 失败:', error)
    macHelperActionMessage.value = 'helper 安装失败'
  } finally {
    sensorActionLoading.value = false
  }
}

async function uninstallMacPowermetricsHelper() {
  if (!isMacPlatform.value) return

  sensorActionLoading.value = true

  try {
    macHelperActionMessage.value = '正在卸载 helper...'
    macHelperStatus.value = await window.services.uninstallMacPowermetricsHelper()
    await refreshProcessorHardwareDynamicMetrics()
    macHelperActionMessage.value = 'helper 已卸载'
  } catch (error) {
    console.error('卸载 macOS powermetrics helper 失败:', error)
    macHelperActionMessage.value = 'helper 卸载失败'
  } finally {
    sensorActionLoading.value = false
  }
}

async function updateHardwareSensorSetting(patch: Partial<HardwareSensorSettingsData>) {
  if (!isWindowsPlatform.value) return

  sensorActionLoading.value = true

  try {
    sensorSettings.value = await window.services.updateHardwareSensorSettings(patch)
    openHardwareMonitorStatus.value = await window.services.getOpenHardwareMonitorStatus()
  } catch (error) {
    console.error('更新硬件传感器增强设置失败:', error)
  } finally {
    sensorActionLoading.value = false
  }
}

async function toggleEnhancedSensorMode() {
  const nextEnabled = !sensorSettings.value.enhancedSensorEnabled
  await updateHardwareSensorSetting({
    enhancedSensorEnabled: nextEnabled,
    openHardwareMonitorAutoStart: nextEnabled,
  })
}

async function startOpenHardwareMonitor() {
  if (!isWindowsPlatform.value) return

  sensorActionLoading.value = true

  try {
    openHardwareMonitorStatus.value = {
      ...openHardwareMonitorStatus.value,
      reason: 'OHM_START_PENDING',
      suggestion: '正在尝试启动 OpenHardwareMonitor',
    } as OpenHardwareMonitorStatusData
    openHardwareMonitorStatus.value = await window.services.startOpenHardwareMonitor()
    const latestStatus = await window.services.getOpenHardwareMonitorStatus()
    openHardwareMonitorStatus.value = {
      ...latestStatus,
      started: openHardwareMonitorStatus.value?.started || latestStatus.started,
    }
  } catch (error) {
    console.error('启动 OpenHardwareMonitor 失败:', error)
  } finally {
    sensorActionLoading.value = false
  }
}

async function openHardwareSensorComponentDirectory() {
  if (!isWindowsPlatform.value) return

  try {
    const result = await window.services.openOpenHardwareMonitorDirectory()
    if (result?.ok) {
      openHardwareMonitorStatus.value = {
        ...(openHardwareMonitorStatus.value || {}),
        executableDirectory: result.directoryPath || openHardwareMonitorStatus.value?.executableDirectory,
        reason: 'OHM_DIRECTORY_OPENED',
        suggestion: result.directoryPath ? `已打开目录：${result.directoryPath}` : '已打开 OpenHardwareMonitor 目录',
      } as OpenHardwareMonitorStatusData
      return
    }

    openHardwareMonitorStatus.value = {
      ...(openHardwareMonitorStatus.value || {}),
      executableDirectory: result?.directoryPath || openHardwareMonitorStatus.value?.executableDirectory,
      reason: result?.reason || 'OHM_OPEN_DIRECTORY_FAILED',
      suggestion: result?.suggestion || '打开 OpenHardwareMonitor 目录失败',
    } as OpenHardwareMonitorStatusData
  } catch (error) {
    console.error('打开 OpenHardwareMonitor 目录失败:', error)
    openHardwareMonitorStatus.value = {
      ...(openHardwareMonitorStatus.value || {}),
      reason: 'OHM_OPEN_DIRECTORY_FAILED',
      suggestion: error instanceof Error ? error.message : String(error),
    } as OpenHardwareMonitorStatusData
  }
}

function startStressTest() {
  stressState.value = 'pending'
  window.setTimeout(() => {
    stressState.value = 'idle'
  }, 1800)
  return false
}

defineExpose({
  exportReport,
  copyProcessorInfo,
  startStressTest,
})

async function ensureStoreActive() {
  if (subscribed.value) return

  subscribed.value = true
  await activateProcessorHardwareStore()
  await Promise.all([
    refreshHardwareSensorState(),
    refreshMacPowermetricsHelperState(),
  ])
}

function releaseStore() {
  if (!subscribed.value) return

  deactivateProcessorHardwareStore()
  subscribed.value = false
}

watch(
  () => props.active,
  async (active) => {
    if (active === false) {
      releaseStore()
      return
    }

    await ensureStoreActive()
  },
  { immediate: true }
)

onUnmounted(() => {
  releaseStore()
})
</script>

<template>
  <div class="processor-page">
    <div v-if="loading" class="processor-empty">正在同步处理器数据...</div>

    <template v-else>
      <section class="processor-hero">
        <article class="hero-card">
          <div class="hero-card__head">
            <div :class="['cpu-badge', `cpu-badge--${vendorBadge.variant}`, { 'cpu-badge--compact': vendorBadge.compact }]">
              <span>{{ vendorBadge.top }}</span>
              <strong>{{ vendorBadge.middle }}</strong>
              <em>{{ vendorBadge.bottom }}</em>
            </div>

            <div class="hero-card__title">
              <h2>{{ cpuData?.brand || '读取中' }}</h2>
              <p>{{ joinParts([cpuData?.family, cpuData?.vendor], ' | ') || '等待处理器识别' }}</p>
            </div>
          </div>

          <div class="hero-specs">
            <div v-for="item in primarySpecs" :key="item.label" class="hero-spec">
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
            </div>
          </div>
        </article>

        <article class="health-card">
          <div class="health-card__badge" :style="{ color: healthState.accent }">●</div>
          <div class="health-card__copy">
            <h3>{{ healthState.title }}</h3>
            <p>{{ healthState.subtitle }}</p>
          </div>

          <div class="quick-stats">
            <div v-for="item in quickStats" :key="item.id" class="quick-stat">
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
              <svg class="quick-stat__sparkline" viewBox="0 0 116 34" preserveAspectRatio="none" aria-hidden="true">
                <polyline :points="sparklinePoints(item.trend)" :stroke="item.accent" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </div>
          </div>

          <div class="health-card__footer">更新时间：{{ formatSyncTime(lastSyncedAt) }}</div>
        </article>
      </section>

      <section class="monitor-panel">
        <div class="panel-title">
          <div>
            <h3>实时监控</h3>
            <p>{{ processorAuxDisplayMode === 'fan' ? '聚焦 CPU 负载、温度、频率、风扇和功耗' : '聚焦 CPU 负载、温度、频率、电压和功耗' }}</p>
          </div>
          <button
            v-if="sensorEnhancementPlatform !== 'unsupported'"
            type="button"
            class="panel-action"
            @click="showSensorEnhancementPanel = !showSensorEnhancementPanel"
          >
            {{ sensorEnhancementActionLabel }}
          </button>
        </div>

        <div v-if="sensorEnhancementPlatform === 'windows' && showSensorEnhancementPanel" class="sensor-enhancement-panel">
          <div class="sensor-enhancement-panel__summary">
            <div>
              <h4>硬件传感器增强模式</h4>
              <p>Windows 下 CPU 温度没有统一可靠接口。开启后，仅在当前链路拿不到可信温度时，才会尝试使用 OpenHardwareMonitor 本地服务。</p>
            </div>
            <span :class="['sensor-enhancement-panel__status', { 'sensor-enhancement-panel__status--active': sensorSettings.enhancedSensorEnabled }]">
              {{ sensorEnhancementSummary }}
            </span>
          </div>

          <div class="sensor-enhancement-grid">
            <div class="sensor-enhancement-item">
              <span>增强模式</span>
              <strong>{{ sensorSettings.enhancedSensorEnabled ? '已开启' : '未开启' }}</strong>
            </div>
            <div class="sensor-enhancement-item">
              <span>OHM 状态</span>
              <strong>{{ sensorSettingsLoading ? '检测中...' : openHardwareMonitorStatusLabel }}</strong>
            </div>
            <div class="sensor-enhancement-item">
              <span>当前温度来源</span>
              <strong>{{ cpuTemperatureSourceLabel }}</strong>
            </div>
            <div class="sensor-enhancement-item">
              <span>工作方式</span>
              <strong>{{ sensorSettings.enhancedSensorEnabled ? '自动尝试启动 OHM' : '仅使用当前内置链路' }}</strong>
            </div>
          </div>

          <div class="sensor-enhancement-actions">
            <button type="button" class="sensor-button" :disabled="sensorActionLoading" @click="toggleEnhancedSensorMode">
              {{ sensorSettings.enhancedSensorEnabled ? '关闭增强模式' : '开启增强模式' }}
            </button>
            <button type="button" class="sensor-button" :disabled="sensorSettingsLoading" @click="refreshHardwareSensorState">
              检测状态
            </button>
            <button
              type="button"
              class="sensor-button"
              :disabled="sensorActionLoading || !sensorSettings.enhancedSensorEnabled"
              @click="startOpenHardwareMonitor"
            >
              尝试启动 OHM
            </button>
            <button type="button" class="sensor-button" @click="openHardwareSensorComponentDirectory">
              打开组件目录
            </button>
          </div>

          <div class="sensor-enhancement-meta">
            <span>端口：{{ sensorSettings.openHardwareMonitorPort }}</span>
            <span>原因：{{ cpuTemperatureReasonLabel }}</span>
          </div>
          <p v-if="sensorEnhancementSuggestion" class="sensor-enhancement-hint">建议：{{ sensorEnhancementSuggestion }}</p>
        </div>

        <div v-if="sensorEnhancementPlatform === 'macos' && showSensorEnhancementPanel" class="sensor-enhancement-panel">
          <div class="sensor-enhancement-panel__summary">
            <div>
              <h4>硬件传感器增强模式</h4>
              <p>CPU 实时频率和 Apple Silicon GPU 遥测需要 root 权限读取 powermetrics。安装 helper 后，插件通过本地白名单服务读取这些指标，不再为每次采样弹授权。</p>
            </div>
            <span :class="['sensor-enhancement-panel__status', { 'sensor-enhancement-panel__status--active': macHelperStatus?.loaded && macHelperStatus?.socketExists }]">
              {{ macHelperSummary }}
            </span>
          </div>

          <div class="sensor-enhancement-grid">
            <div class="sensor-enhancement-item">
              <span>增强组件状态</span>
              <strong>{{ sensorSettingsLoading ? '检测中...' : macHelperStatusLabel }}</strong>
            </div>
            <div class="sensor-enhancement-item">
              <span>当前频率来源</span>
              <strong>{{ currentSpeedSourceLabel }}</strong>
            </div>
            <div class="sensor-enhancement-item">
              <span>LaunchDaemon</span>
              <strong>{{ macHelperStatus?.loaded ? '已加载' : '未加载' }}</strong>
            </div>
            <div class="sensor-enhancement-item">
              <span>Socket</span>
              <strong>{{ macHelperStatus?.socketExists ? '可用' : '不可用' }}</strong>
            </div>
          </div>

          <div class="sensor-enhancement-actions">
            <button type="button" class="sensor-button" :disabled="sensorActionLoading || !macHelperStatus?.bundledExists" @click="installMacPowermetricsHelper">
              {{ macHelperStatus?.installed ? '重新安装增强组件' : '安装增强组件' }}
            </button>
            <button type="button" class="sensor-button" :disabled="sensorSettingsLoading" @click="refreshMacPowermetricsHelperState">
              检测状态
            </button>
            <button type="button" class="sensor-button" :disabled="sensorActionLoading || !macHelperStatus?.installed" @click="uninstallMacPowermetricsHelper">
              卸载增强组件
            </button>
          </div>

          <div class="sensor-enhancement-meta">
            <span>服务：{{ macHelperStatus?.label || 'com.hwinfox.powermetrics-helper' }}</span>
            <span>来源：{{ macHelperStatus?.runtimePath || macHelperStatus?.bundledPath || '--' }}</span>
          </div>
          <p v-if="macHelperActionMessage" class="sensor-enhancement-hint">状态：{{ macHelperActionMessage }}</p>
          <p v-if="macHelperSuggestion" class="sensor-enhancement-hint">建议：{{ macHelperSuggestion }}</p>
        </div>

        <div class="monitor-grid">
          <article v-for="card in monitorCards" :key="card.id" class="monitor-card">
            <div class="monitor-card__label">{{ card.label }}</div>
            <div class="monitor-card__ring" :style="ringStyle(card.percent, card.accent)">
              <div class="monitor-card__ring-inner">
                <strong>{{ card.value }}</strong>
                <span v-if="card.unit">{{ card.unit }}</span>
              </div>
            </div>
            <svg class="monitor-card__sparkline" viewBox="0 0 116 34" preserveAspectRatio="none" aria-hidden="true">
              <polyline :points="sparklinePoints(card.trend)" :stroke="card.accent" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <div class="monitor-card__foot" :class="{ 'monitor-card__foot--single': card.unsupported }">
              <span>{{ card.footerLeft }}</span>
              <span v-if="!card.unsupported">{{ card.footerRight }}</span>
            </div>
          </article>
        </div>
      </section>

      <section class="processor-grid">
        <article class="processor-panel">
          <div class="processor-panel__title">
            <h3>核心频率详情</h3>
            <p>{{ allCoreRows.length }} 个核心行</p>
          </div>

          <div class="core-table">
            <div class="core-table__head">
              <span>核心</span>
              <span>类型</span>
              <span>频率</span>
              <span>使用率</span>
              <span>温度</span>
            </div>

            <div class="core-table__body">
              <div v-for="row in allCoreRows" :key="row.id" class="core-table__row">
                <span>{{ row.label }}</span>
                <span>
                  <em :class="['core-badge', `core-badge--${row.type.toLowerCase().replace(/[^a-z]/g, '')}`]">{{ row.type }}</em>
                </span>
                <span>{{ formatFrequency(row.speed) }}</span>
                <span>{{ typeof row.load === 'number' ? `${Math.round(row.load)}%` : '--' }}</span>
                <span>{{ formatTemperature(row.temperature) }}</span>
              </div>
            </div>
          </div>
        </article>

        <article class="processor-panel">
          <div class="processor-panel__title">
            <h3>核心状态总览</h3>
            <p>按核心类型查看瞬时频率与负载</p>
          </div>

          <div class="processor-panel__body processor-panel__body--stack">
            <div v-if="performanceCoreRows.length" class="core-group">
              <div class="core-group__label">P-Core ({{ performanceCoreRows.length }})</div>
              <div class="core-chip-grid">
                <article v-for="row in performanceCoreRows" :key="row.id" class="core-chip core-chip--performance">
                  <strong>{{ row.label.replace('P-Core ', 'P') }}</strong>
                  <span>{{ formatFrequency(row.speed) }}</span>
                  <em>{{ typeof row.load === 'number' ? `${Math.round(row.load)}%` : '--' }}</em>
                </article>
              </div>
            </div>

            <div v-if="efficiencyCoreRows.length" class="core-group">
              <div class="core-group__label core-group__label--green">E-Core ({{ efficiencyCoreRows.length }})</div>
              <div class="core-chip-grid">
                <article v-for="row in efficiencyCoreRows" :key="row.id" class="core-chip core-chip--efficiency">
                  <strong>{{ row.label.replace('E-Core ', 'E') }}</strong>
                  <span>{{ formatFrequency(row.speed) }}</span>
                  <em>{{ typeof row.load === 'number' ? `${Math.round(row.load)}%` : '--' }}</em>
                </article>
              </div>
            </div>

            <div v-if="genericCoreRows.length" class="core-group">
              <div class="core-group__label">CPU Core ({{ genericCoreRows.length }})</div>
              <div class="core-chip-grid">
                <article v-for="row in genericCoreRows" :key="row.id" class="core-chip">
                  <strong>{{ row.label.replace('Core ', 'C') }}</strong>
                  <span>{{ formatFrequency(row.speed) }}</span>
                  <em>{{ typeof row.load === 'number' ? `${Math.round(row.load)}%` : '--' }}</em>
                </article>
              </div>
            </div>
          </div>
        </article>

        <article class="processor-panel">
          <div class="processor-panel__title">
            <h3>详细规格</h3>
            <p>静态规格与指令能力</p>
          </div>

          <div class="processor-panel__body">
            <div class="detail-specs">
              <div v-for="item in detailSpecs" :key="item.label" class="detail-spec">
                <span>{{ item.label }}</span>
                <strong>{{ item.value }}</strong>
              </div>
            </div>
          </div>
        </article>
      </section>

      <section class="platform-panel">
        <div class="processor-panel__title">
          <h3>平台信息</h3>
          <p>当前主板、BIOS、插槽与系统信息</p>
        </div>

        <div class="platform-grid">
          <div v-for="item in platformSpecs" :key="item.label" class="platform-spec">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped lang="less">
.processor-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
  min-height: 0;
  overflow: auto;
  padding-right: 6px;
}

.processor-empty {
  display: grid;
  place-items: center;
  min-height: 320px;
  border: 1px solid var(--panel-border);
  border-radius: var(--surface-radius);
  background: linear-gradient(180deg, rgba(19, 28, 40, 0.94), rgba(16, 24, 35, 0.96));
  color: var(--text-muted);
  font-size: 15px;
}

.processor-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(320px, 0.95fr);
  gap: 12px;
}

.hero-card,
.health-card,
.monitor-panel,
.processor-panel,
.platform-panel {
  border: 1px solid var(--panel-border);
  border-radius: var(--surface-radius);
  background:
    linear-gradient(180deg, rgba(21, 31, 44, 0.98), rgba(17, 25, 35, 0.98)),
    radial-gradient(circle at top left, rgba(66, 128, 240, 0.08), transparent 28%);
  box-shadow: var(--panel-shadow);
}

.hero-card {
  padding: var(--surface-padding);
}

.hero-card__head {
  display: flex;
  gap: 18px;
  align-items: flex-start;
}

.cpu-badge {
  display: grid;
  gap: 3px;
  align-content: space-between;
  width: 88px;
  min-height: 82px;
  padding: 10px;
  border-radius: 14px;
  background: linear-gradient(160deg, rgba(45, 106, 255, 0.96), rgba(34, 63, 164, 0.88));
  color: #f5f8ff;
  box-shadow: 0 18px 36px rgba(10, 30, 78, 0.34);
  overflow: hidden;

  span {
    display: block;
    min-width: 0;
    font-size: 12px;
    text-transform: lowercase;
    letter-spacing: 0.06em;
    line-height: 1;
    opacity: 0.88;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  strong {
    display: block;
    min-width: 0;
    font-size: 17px;
    line-height: 1.05;
    letter-spacing: 0.03em;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  em {
    justify-self: end;
    font-style: normal;
    font-size: 15px;
    font-weight: 700;
    line-height: 1;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.cpu-badge--compact {
  gap: 4px;

  strong {
    font-size: 15px;
    letter-spacing: 0.01em;
  }

  em {
    justify-self: start;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    opacity: 0.86;
  }
}

.cpu-badge--apple {
  background: linear-gradient(160deg, rgba(76, 112, 255, 0.96), rgba(42, 61, 154, 0.9));

  strong {
    font-size: 18px;
    letter-spacing: 0;
  }
}

.cpu-badge--generic {
  background: linear-gradient(160deg, rgba(49, 92, 180, 0.92), rgba(35, 55, 120, 0.88));
}

.hero-card__title {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;

  h2 {
    margin: 0;
    color: #f5f7fb;
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.03em;
    overflow-wrap: anywhere;
  }

  p {
    margin: 0;
    color: var(--text-muted);
    font-size: 14px;
    overflow-wrap: anywhere;
  }
}

.hero-specs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0;
  margin-top: 18px;
  border-top: 1px solid rgba(86, 101, 126, 0.18);
}

.hero-spec {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 12px 10px 0;
  border-bottom: 1px solid rgba(86, 101, 126, 0.12);

  span {
    color: var(--text-subtle);
    font-size: 13px;
  }

  strong {
    color: var(--text-primary);
    font-size: 15px;
    font-weight: 700;
  }
}

.health-card {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 12px 14px;
  padding: var(--surface-padding);
}

.health-card__badge {
  font-size: 22px;
  line-height: 1;
}

.health-card__copy {
  h3 {
    margin: 0;
    color: var(--text-primary);
    font-size: 18px;
    font-weight: 700;
  }

  p {
    margin: 6px 0 0;
    color: var(--text-muted);
    font-size: 14px;
  }
}

.quick-stats {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin-top: 6px;
  padding-top: 12px;
  border-top: 1px solid rgba(86, 101, 126, 0.16);
}

.quick-stat {
  display: flex;
  flex-direction: column;
  gap: 8px;

  span {
    color: var(--text-subtle);
    font-size: 13px;
  }

  strong {
    color: var(--text-primary);
    font-size: 18px;
    font-weight: 700;
  }
}

.quick-stat__sparkline {
  width: 100%;
  height: 30px;
}

.health-card__footer {
  grid-column: 1 / -1;
  color: var(--text-subtle);
  font-size: 13px;
}

.monitor-panel,
.platform-panel {
  padding: var(--surface-padding);
}

.panel-title,
.processor-panel__title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--surface-heading-gap);
  margin-bottom: var(--surface-heading-margin);

  h3 {
    margin: 0;
    color: var(--text-primary);
    font-size: var(--surface-title-size);
    font-weight: 700;
  }

  p {
    margin: 6px 0 0;
    color: var(--text-subtle);
    font-size: 13px;
  }
}

.panel-action {
  min-height: var(--control-height);
  padding: 0 14px;
  border: 1px solid var(--control-border);
  border-radius: var(--control-radius);
  background: var(--control-bg);
  color: var(--control-fg);
  font-size: 13px;
  font-weight: 600;
}

.sensor-enhancement-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-bottom: 14px;
  padding: 14px;
  border: 1px solid rgba(66, 128, 240, 0.18);
  border-radius: 14px;
  background: linear-gradient(180deg, rgba(17, 27, 40, 0.88), rgba(14, 21, 31, 0.92));
}

.sensor-enhancement-panel__summary {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;

  h4 {
    margin: 0;
    color: var(--text-primary);
    font-size: 15px;
    font-weight: 700;
  }

  p {
    margin: 6px 0 0;
    color: var(--text-muted);
    font-size: 13px;
    line-height: 1.55;
  }
}

.sensor-enhancement-panel__status {
  flex-shrink: 0;
  min-height: var(--pill-height);
  padding: 0 10px;
  border-radius: var(--pill-radius);
  background: var(--state-neutral-bg);
  color: var(--state-neutral-fg);
  font-size: 12px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
}

.sensor-enhancement-panel__status--active {
  background: var(--state-info-bg);
  color: var(--state-info-fg);
}

.sensor-enhancement-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.sensor-enhancement-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid rgba(84, 104, 132, 0.2);
  border-radius: 12px;
  background: rgba(19, 29, 42, 0.72);

  span {
    color: var(--text-subtle);
    font-size: 12px;
  }

  strong {
    color: var(--text-primary);
    font-size: 14px;
    font-weight: 700;
  }
}

.sensor-enhancement-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.sensor-button {
  min-height: var(--control-height);
  padding: 0 14px;
  border: 1px solid var(--control-border);
  border-radius: var(--control-radius);
  background: var(--control-bg);
  color: var(--control-fg);
  font-size: 13px;
  font-weight: 600;
}

.sensor-button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.sensor-enhancement-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  color: var(--text-subtle);
  font-size: 12px;
}

.sensor-enhancement-hint {
  margin: 0;
  color: var(--accent-cyan);
  font-size: 13px;
  line-height: 1.5;
}

.monitor-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
}

.monitor-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding: 8px 10px 10px;
  border-left: 1px solid rgba(86, 101, 126, 0.18);
}

.monitor-card:first-child {
  border-left: 0;
}

.monitor-card__label {
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
  text-align: center;
}

.monitor-card__ring {
  display: grid;
  place-items: center;
  width: 106px;
  height: 106px;
  margin: 0 auto;
  border-radius: 50%;
}

.monitor-card__ring-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 84px;
  height: 84px;
  border-radius: 50%;
  background: rgba(17, 25, 36, 0.96);

  strong {
    color: var(--text-primary);
    font-size: 16px;
    font-weight: 700;
  }

  span {
    color: var(--text-muted);
    font-size: 12px;
  }
}

.monitor-card__sparkline {
  width: 100%;
  height: 34px;
}

.monitor-card__foot {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  color: var(--text-muted);
  font-size: 12px;
}

.monitor-card__foot--single {
  justify-content: center;
  text-align: center;
}

.processor-grid {
  display: grid;
  grid-template-columns: 1.2fr 0.9fr 0.8fr;
  gap: 12px;
  align-items: stretch;
}

.processor-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 420px;
  padding: var(--surface-padding);
}

.processor-panel__body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-right: 4px;
}

.processor-panel__body--stack {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.core-table {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.core-table__head,
.core-table__row {
  display: grid;
  grid-template-columns: 1.35fr 0.9fr 0.9fr 0.8fr 0.8fr;
  gap: 10px;
  align-items: center;
}

.core-table__head {
  padding: 0 2px 12px;
  color: var(--text-subtle);
  font-size: 12px;
  border-bottom: 1px solid rgba(86, 101, 126, 0.18);
}

.core-table__body {
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: 8px;
  overflow: auto;
  padding-top: 12px;
}

.core-table__row {
  padding: 8px 2px;
  color: var(--text-secondary);
  font-size: 13px;
  border-bottom: 1px solid rgba(86, 101, 126, 0.08);
}

.core-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 62px;
  min-height: 24px;
  padding: 0 8px;
  border-radius: 8px;
  font-style: normal;
  font-size: 12px;
  font-weight: 700;
}

.core-badge--pcore {
  border: 1px solid rgba(68, 150, 255, 0.34);
  background: rgba(31, 60, 105, 0.34);
  color: var(--accent-blue);
}

.core-badge--ecore {
  border: 1px solid rgba(132, 219, 97, 0.3);
  background: rgba(41, 80, 30, 0.34);
  color: var(--accent-green);
}

.core-badge--core {
  border: 1px solid rgba(120, 138, 171, 0.26);
  background: rgba(32, 44, 61, 0.4);
  color: var(--text-secondary);
}

.core-group {
  display: flex;
  flex-direction: column;
  gap: 10px;

  & + .core-group {
    margin-top: 14px;
  }
}

.core-group__label {
  color: var(--accent-blue);
  font-size: 14px;
  font-weight: 700;
}

.core-group__label--green {
  color: var(--accent-green);
}

.core-chip-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.core-chip {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 10px 8px;
  border: 1px solid rgba(84, 104, 132, 0.28);
  border-radius: 10px;
  background: rgba(18, 29, 44, 0.72);

  strong {
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 700;
  }

  span {
    color: var(--text-secondary);
    font-size: 12px;
  }

  em {
    color: var(--text-subtle);
    font-style: normal;
    font-size: 12px;
  }
}

.core-chip--performance {
  border-color: rgba(68, 150, 255, 0.32);
}

.core-chip--efficiency {
  border-color: rgba(132, 219, 97, 0.28);
}

.detail-specs {
  display: grid;
  gap: 10px;
}

.detail-spec,
.platform-spec {
  display: grid;
  grid-template-columns: 122px minmax(0, 1fr);
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px solid rgba(86, 101, 126, 0.08);

  span {
    color: var(--text-subtle);
    font-size: 13px;
  }

  strong {
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 600;
  }
}

.platform-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px 22px;
}

.platform-spec {
  grid-template-columns: 106px minmax(0, 1fr);
}

@media (max-width: 1320px) {
  .processor-hero,
  .processor-grid {
    grid-template-columns: 1fr;
  }

   .sensor-enhancement-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .processor-panel {
    height: auto;
  }

  .processor-panel__body,
  .core-table__body {
    overflow: visible;
    padding-right: 0;
  }

  .monitor-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .platform-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 980px) {
  .hero-specs {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .sensor-enhancement-grid,
  .quick-stats,
  .monitor-grid,
  .core-chip-grid,
  .platform-grid {
    grid-template-columns: 1fr;
  }

  .sensor-enhancement-panel__summary {
    flex-direction: column;
  }

  .core-table__head,
  .core-table__row,
  .detail-spec,
  .platform-spec {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
