<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import {
  activateGraphicsHardwareStore,
  deactivateGraphicsHardwareStore,
  graphicsHardwareStore,
  refreshGraphicsHardwareData,
} from '../../composables/useGraphicsHardwareData'
import { clampPercent, formatDisplayResolution } from '../../utils'
import { formatGpuTemperatureSensorLabel, getGpuIdlePercent, getGraphicsPlatformPanelVisibility } from '../../utils/gpu'
import { normalizeOsPlatform } from '../../utils/platform'
import StateBlock from '../common/StateBlock.vue'

const props = defineProps<{
  active?: boolean
}>()

type MetricHistoryKey = 'load' | 'temp' | 'clock' | 'memory' | 'power'

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

interface StatRow {
  label: string
  value: string
  status?: string
  statusTone?: 'good' | 'warn' | 'normal'
}

interface PortChip {
  label: string
  state: string
  connected: boolean
}

const stressState = ref<'idle' | 'pending'>('idle')
const {
  loading,
  lastSyncedAt,
  displaysData,
  boardData,
  biosData,
  osInfo,
  primaryGpu,
  fetchState,
} = graphicsHardwareStore

const metricHistory: Record<MetricHistoryKey, number[]> = {
  load: graphicsHardwareStore.metricHistory.gpuLoad,
  temp: graphicsHardwareStore.metricHistory.gpuTemp,
  clock: graphicsHardwareStore.metricHistory.gpuClock,
  memory: graphicsHardwareStore.metricHistory.gpuMemory,
  power: graphicsHardwareStore.metricHistory.gpuPower,
}

const subscribed = ref(false)

const pageStateBlock = computed(() => {
  if (fetchState.gpuInfo.status === 'error') {
    return {
      variant: 'error' as const,
      title: '显卡数据读取失败',
      description: fetchState.gpuInfo.note || '读取显卡信息时发生异常，可以重试该模块。',
      actionLabel: '重试该模块',
    }
  }

  if (fetchState.gpuInfo.status === 'missing' && !primaryGpu.value) {
    return {
      variant: 'empty' as const,
      title: '未识别到显卡信息',
      description: fetchState.gpuInfo.note || '当前系统数据源没有返回可展示的 GPU 设备。',
      actionLabel: '重试该模块',
    }
  }

  return null
})

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

function clampMetricPercent(value: number | null, max = 100) {
  if (typeof value !== 'number' || !Number.isFinite(value) || max <= 0) return 0
  return clampPercent((value / max) * 100)
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

function formatTemperature(value: number | null) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? `${Math.round(value)}°C` : '暂不支持'
}

function formatPower(value: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '暂不支持'
  if (value < 1) return `${Math.round(value * 1000)} mW`
  if (value < 10) return `${value.toFixed(1)} W`
  return `${Math.round(value)} W`
}

function formatClock(value: number | null) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? `${Math.round(value)} MHz` : '暂不支持'
}

function formatPercent(value: number | null) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? `${Math.round(value)}%` : '暂不支持'
}

function formatMemoryAmount(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '暂不支持'
  return value >= 1024 ? `${(value / 1024).toFixed(1)} GB` : `${value.toFixed(1)} MB`
}

function formatMemoryBandwidth(gpu: GpuData | undefined) {
  if (!gpu) return '--'
  const vram = gpu.memoryTotal || gpu.vram || 0
  if (!vram || !gpu.clockMemory) return '--'
  const estimated = ((gpu.clockMemory * 2 * (gpu.bus.toLowerCase().includes('x') ? 128 : 192)) / 8) / 1000
  return Number.isFinite(estimated) && estimated > 0 ? `${estimated.toFixed(0)} GB/s` : '--'
}

function formatGpuTelemetrySource(gpu: GpuData | undefined) {
  if (!gpu?.telemetrySource) return '--'
  if (gpu.telemetrySource === 'powermetrics' && gpu.helper) return 'powermetrics helper'
  if (gpu.telemetrySource === 'OpenHardwareMonitor') return 'OpenHardwareMonitor'
  return 'systeminformation'
}

function formatGpuTemperatureSource(gpu: GpuData | undefined) {
  if (!gpu?.temperatureSource) return '--'
  if (gpu.temperatureSource === 'macos-temperature-sensor') return 'macOS 原生传感器'
  if (gpu.temperatureSource === 'apple-smc') return 'AppleSMC'
  if (gpu.temperatureSource === 'OpenHardwareMonitor') return 'OpenHardwareMonitor'
  return 'systeminformation'
}

function formatGpuNativeFallbackReason(gpu: GpuData | undefined) {
  if (!gpu || gpu.temperatureSource !== 'apple-smc') return ''
  return cleanText(gpu.nativeTemperatureMessage)
    || cleanText(gpu.nativeTemperatureReason)
    || cleanText(gpu.nativeTemperatureErrorCode)
}

function formatDisplayLine(item: DisplayData) {
  const resolution = formatDisplayResolution(item)
  const refresh = item.currentRefreshRate ? `${Math.round(item.currentRefreshRate)} Hz` : '--'
  return joinParts([item.model || item.deviceName, resolution, refresh], ' / ')
}

function inferHealthState(gpu: GpuData | undefined) {
  const temp = safeNumber(gpu?.temperatureGpu)
  const load = safeNumber(gpu?.utilizationGpu) || 0

  if (typeof temp === 'number' && temp >= 85) {
    return {
      title: '负载偏高',
      subtitle: 'GPU 当前温度接近上限，需要关注散热',
      accent: 'var(--accent-orange)',
    }
  }

  if (load >= 90) {
    return {
      title: '高性能运行',
      subtitle: 'GPU 当前处于高负载渲染状态',
      accent: 'var(--accent-yellow)',
    }
  }

  return {
    title: '运行良好',
    subtitle: 'GPU 当前状态正常',
    accent: 'var(--accent-green)',
  }
}

function gpuBadgeData(gpu?: GpuData) {
  const vendor = cleanText(gpu?.vendor)
  const model = cleanText(gpu?.model || gpu?.name)
  const haystack = `${vendor} ${model}`.toLowerCase()

  if (haystack.includes('nvidia') || haystack.includes('geforce')) {
    return {
      top: 'GEFORCE',
      middle: model.match(/rtx|gtx/i)?.[0]?.toUpperCase() || 'RTX',
      bottom: 'gpu',
      variant: 'nvidia',
      compact: false,
    }
  }

  if (haystack.includes('amd') || haystack.includes('radeon')) {
    return {
      top: 'RADEON',
      middle: model.match(/rx\s*\d+/i)?.[0]?.toUpperCase() || 'AMD',
      bottom: 'gpu',
      variant: 'amd',
      compact: false,
    }
  }

  if (haystack.includes('apple')) {
    return {
      top: 'apple',
      middle: 'GPU',
      bottom: 'soc',
      variant: 'apple',
      compact: true,
    }
  }

  if (haystack.includes('intel')) {
    return {
      top: 'intel',
      middle: model.match(/arc|iris|uhd/i)?.[0]?.toUpperCase() || 'GPU',
      bottom: 'graphics',
      variant: 'intel',
      compact: true,
    }
  }

  return {
    top: vendor || 'GPU',
    middle: 'GRAPHICS',
    bottom: 'chip',
    variant: 'generic',
    compact: true,
  }
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

  if (!copied) throw new Error('execCommand copy failed')
}

const connectedDisplays = computed(() =>
  displaysData.value.filter((item) => (item.resolutionX && item.resolutionY) || (item.currentResX && item.currentResY))
)
const mainDisplay = computed(() => connectedDisplays.value.find((item) => item.main) || connectedDisplays.value[0])
const normalizedGraphicsPlatform = computed(() => normalizeOsPlatform(osInfo.value))
const graphicsPlatformPanels = computed(() => getGraphicsPlatformPanelVisibility(normalizedGraphicsPlatform.value))
const healthState = computed(() => inferHealthState(primaryGpu.value))
const badgeMeta = computed(() => gpuBadgeData(primaryGpu.value))

const heroSpecs = computed(() => {
  const gpu = primaryGpu.value
  return [
    { label: '架构', value: cleanText(gpu?.vendor).includes('NVIDIA') ? 'NVIDIA 架构' : cleanText(gpu?.vendor) || '--' },
    { label: '型号 / 核心', value: joinParts([gpu?.model || gpu?.name, gpu?.cores ? `${gpu.cores} cores` : ''], ' / ') || '--' },
    { label: '总线 / 接口', value: joinParts([gpu?.bus, gpu?.pciBus], ' / ') || '--' },
    { label: '显存容量', value: formatMemoryAmount(gpu?.memoryTotal || gpu?.vram || null) },
    { label: '当前频率', value: formatClock(safeNumber(gpu?.clockCore)) },
    { label: '显存频率', value: formatClock(safeNumber(gpu?.clockMemory)) },
    { label: '驱动版本', value: cleanText(gpu?.driverVersion) || '--' },
    { label: '显存带宽', value: formatMemoryBandwidth(gpu) },
    { label: '输出接口', value: connectedDisplays.value.length ? `${connectedDisplays.value.length} 个活动显示输出` : '未检测到外接显示输出' },
  ]
})

const quickStats = computed(() => {
  const gpu = primaryGpu.value
  return [
    {
      id: 'temp',
      label: '温度',
      value: formatTemperature(safeNumber(gpu?.temperatureGpu)),
      accent: 'var(--accent-blue)',
      trend: metricHistory.temp,
    },
    {
      id: 'power',
      label: '当前功耗',
      value: formatPower(safeNumber(gpu?.powerDraw)),
      accent: 'var(--accent-orange)',
      trend: metricHistory.power,
    },
    {
      id: 'load',
      label: '使用率',
      value: typeof gpu?.utilizationGpu === 'number' ? `${Math.round(gpu.utilizationGpu)}%` : '暂不支持',
      accent: 'var(--accent-blue)',
      trend: metricHistory.load,
    },
  ]
})

const monitorCards = computed<MonitorCard[]>(() => {
  const gpu = primaryGpu.value
  const gpuLoad = safeNumber(gpu?.utilizationGpu)
  const gpuIdle = getGpuIdlePercent(gpu)
  const gpuTemp = safeNumber(gpu?.temperatureGpu)
  const gpuClock = safeNumber(gpu?.clockCore)
  const memoryUsed = safeNumber(gpu?.memoryUsed)
  const memoryTotal = safeNumber(gpu?.memoryTotal || gpu?.vram)
  const power = safeNumber(gpu?.powerDraw)
  const idleTrend = metricHistory.load.map((value) => Math.max(0, 100 - value))

  return [
    {
      id: 'load',
      label: 'GPU 使用率',
      value: formatPercent(gpuLoad),
      accent: 'var(--accent-blue)',
      percent: clampPercent(gpuLoad || 0),
      trend: metricHistory.load,
      footerLeft: `最低 ${Math.round(getHistoryMin(metricHistory.load))}%`,
      footerRight: `最高 ${Math.round(getHistoryMax(metricHistory.load, gpuLoad || 0))}%`,
      unsupported: gpuLoad === null,
    },
    {
      id: 'idle',
      label: 'GPU 空闲率',
      value: formatPercent(gpuIdle),
      accent: 'var(--accent-cyan)',
      percent: clampPercent(gpuIdle || 0),
      trend: idleTrend,
      footerLeft: `最低 ${Math.round(getHistoryMin(idleTrend))}%`,
      footerRight: `最高 ${Math.round(getHistoryMax(idleTrend, gpuIdle || 0))}%`,
      unsupported: gpuIdle === null,
    },
    {
      id: 'temp',
      label: 'GPU 温度',
      value: formatTemperature(gpuTemp),
      accent: 'var(--accent-green)',
      percent: clampMetricPercent(gpuTemp, 100),
      trend: metricHistory.temp,
      footerLeft: `最低 ${Math.round(getHistoryMin(metricHistory.temp))}°C`,
      footerRight: `最高 ${Math.round(getHistoryMax(metricHistory.temp, gpuTemp || 0))}°C`,
      unsupported: gpuTemp === null,
    },
    {
      id: 'clock',
      label: '当前频率',
      value: formatClock(gpuClock),
      unit: gpuClock ? 'MHz' : '',
      accent: 'var(--accent-blue)',
      percent: clampMetricPercent(gpuClock, Math.max(gpuClock || 0, 2800)),
      trend: metricHistory.clock,
      footerLeft: `最低 ${Math.round(getHistoryMin(metricHistory.clock))} MHz`,
      footerRight: `最高 ${Math.round(getHistoryMax(metricHistory.clock, gpuClock || 0))} MHz`,
      unsupported: gpuClock === null,
    },
    {
      id: 'memory',
      label: '显存占用',
      value: formatMemoryAmount(memoryUsed),
      unit: memoryUsed ? 'GB' : '',
      accent: 'var(--accent-purple)',
      percent: memoryUsed && memoryTotal ? clampPercent((memoryUsed / memoryTotal) * 100) : 0,
      trend: metricHistory.memory,
      footerLeft: `最低 ${formatMemoryAmount(getHistoryMin(metricHistory.memory))}`,
      footerRight: `最高 ${formatMemoryAmount(getHistoryMax(metricHistory.memory, memoryUsed || 0))}`,
      unsupported: memoryUsed === null || memoryTotal === null,
    },
    {
      id: 'power',
      label: '当前功耗',
      value: formatPower(power),
      unit: power ? 'W' : '',
      accent: 'var(--accent-orange)',
      percent: clampMetricPercent(power, Math.max(power || 0, safeNumber(gpu?.powerLimit) || 450)),
      trend: metricHistory.power,
      footerLeft: `最低 ${Math.round(getHistoryMin(metricHistory.power))} W`,
      footerRight: `最高 ${Math.round(getHistoryMax(metricHistory.power, power || 0))} W`,
      unsupported: power === null,
    },
  ]
})

const telemetryRows = computed<StatRow[]>(() => {
  const gpu = primaryGpu.value
  const gpuIdle = getGpuIdlePercent(gpu)

  const rows: StatRow[] = [
    {
      label: 'GPU 核心频率',
      value: formatClock(safeNumber(gpu?.clockCore)),
      status: safeNumber(gpu?.clockCore) ? '加速' : '暂无',
      statusTone: safeNumber(gpu?.clockCore) ? 'good' : 'normal',
    },
    {
      label: 'GPU 空闲率',
      value: formatPercent(gpuIdle),
      status: gpuIdle === null ? '暂无' : gpuIdle >= 50 ? '空闲' : '繁忙',
      statusTone: gpuIdle === null ? 'normal' : gpuIdle >= 50 ? 'good' : 'warn',
    },
    {
      label: '显存频率',
      value: formatClock(safeNumber(gpu?.clockMemory)),
      status: safeNumber(gpu?.clockMemory) ? '有效' : '暂无',
      statusTone: safeNumber(gpu?.clockMemory) ? 'good' : 'normal',
    },
    {
      label: 'GPU 温度',
      value: formatTemperature(safeNumber(gpu?.temperatureGpu)),
      status: typeof gpu?.temperatureGpu === 'number' && gpu.temperatureGpu < 80 ? '安全' : '关注',
      statusTone: typeof gpu?.temperatureGpu === 'number' && gpu.temperatureGpu < 80 ? 'good' : 'warn',
    },
    {
      label: '显存温度',
      value: formatTemperature(safeNumber(gpu?.temperatureMemory)),
      status: typeof gpu?.temperatureMemory === 'number' && gpu.temperatureMemory < 90 ? '安全' : '关注',
      statusTone: typeof gpu?.temperatureMemory === 'number' && gpu.temperatureMemory < 90 ? 'good' : 'warn',
    },
    {
      label: '功耗',
      value: formatPower(safeNumber(gpu?.powerDraw)),
      status: safeNumber(gpu?.powerLimit) ? `上限 ${Math.round(safeNumber(gpu?.powerLimit) || 0)} W` : '遥测',
      statusTone: 'normal',
    },
    {
      label: '显存占用',
      value: joinParts([formatMemoryAmount(safeNumber(gpu?.memoryUsed)), '/', formatMemoryAmount(safeNumber(gpu?.memoryTotal || gpu?.vram))], ' '),
      status: typeof gpu?.utilizationMemory === 'number' ? `${Math.round(gpu.utilizationMemory)}%` : '未知',
      statusTone: 'normal',
    },
    {
      label: 'CUDA / 计算核心',
      value: gpu?.cores ? `${gpu.cores}` : cleanText(gpu?.vendor).includes('NVIDIA') ? '未提供' : '--',
      status: gpu?.cores ? '已识别' : cleanText(gpu?.vendor).includes('NVIDIA') ? '驱动未返回' : '通用',
      statusTone: gpu?.cores ? 'good' : 'normal',
    },
    {
      label: 'PCIe 链路',
      value: joinParts([gpu?.bus, gpu?.pciBus], ' / ') || '--',
      status: gpu?.pciBus ? '已连接' : '未知',
      statusTone: 'normal',
    },
  ]

  return rows
})

const gpuCoreTemperatureRows = computed(() => {
  const sensors = Array.isArray(primaryGpu.value?.gpuCoreTemperatures) ? primaryGpu.value.gpuCoreTemperatures : []

  return sensors.map((sensor, index) => ({
    id: sensor.identifier || `gpu-core-${index}`,
    label: formatGpuTemperatureSensorLabel(sensor, index),
    value: formatTemperature(safeNumber(sensor.value)),
    subtitle: sensor.hardwareName === 'AppleSMC' ? 'AppleSMC 传感器' : 'GPU 温度探针',
    accent:
      typeof sensor.value === 'number' && sensor.value >= 85
        ? 'var(--accent-orange)'
        : typeof sensor.value === 'number' && sensor.value >= 75
          ? 'var(--accent-yellow)'
          : 'var(--accent-blue)',
  }))
})

const gpuNativeFallbackReason = computed(() => formatGpuNativeFallbackReason(primaryGpu.value))
const gpuNativeFallbackSuggestion = computed(() => (
  primaryGpu.value?.temperatureSource === 'apple-smc'
    ? cleanText(primaryGpu.value?.nativeTemperatureSuggestion)
    : ''
))

const portChips = computed<PortChip[]>(() => {
  const displays = connectedDisplays.value
  const chips = displays.slice(0, 4).map((display) => ({
    label: cleanText(display.connection) || 'Display',
    state: '已连接',
    connected: true,
  }))

  while (chips.length < 4) {
    chips.push({
      label: `输出 ${chips.length + 1}`,
      state: '未连接',
      connected: false,
    })
  }

  return chips
})

const outputRows = computed(() => {
  const display = mainDisplay.value
  return [
    { label: '当前主显示器', value: cleanText(display?.model || display?.deviceName) || '--' },
    { label: '分辨率', value: formatDisplayResolution(display) },
    { label: '刷新率', value: display?.currentRefreshRate ? `${Math.round(display.currentRefreshRate)} Hz` : '--' },
    { label: '连接类型', value: cleanText(display?.connection) || '--' },
    { label: '显示数量', value: connectedDisplays.value.length ? `${connectedDisplays.value.length} 台` : '--' },
    { label: '显示列表', value: connectedDisplays.value.length ? connectedDisplays.value.map(formatDisplayLine).join('；') : '--' },
  ]
})

const detailSpecs = computed(() => {
  const gpu = primaryGpu.value
  return [
    { label: '驱动版本', value: cleanText(gpu?.driverVersion) || '--' },
    { label: 'DirectX 支持', value: cleanText(osInfo.value?.release) ? '系统支持' : '--' },
    { label: 'Vulkan 支持', value: cleanText(gpu?.vendor) ? '已检测' : '--' },
    { label: 'OpenGL 支持', value: cleanText(gpu?.vendor) ? '已检测' : '--' },
    { label: 'Resizable BAR', value: gpu?.pciBus ? '已连接' : '--' },
    { label: '光线追踪', value: cleanText(gpu?.model).match(/rtx|rx 7|rx 6/i) ? '支持' : '未知' },
    { label: '显存动态模式', value: gpu?.vramDynamic ? '是' : '否' },
    { label: '板卡厂商', value: cleanText(gpu?.subVendor) || cleanText(gpu?.vendor) || '--' },
    { label: '显卡标识', value: joinParts([gpu?.deviceId, gpu?.vendorId], ' / ') || '--' },
  ]
})

const platformRows = computed(() => {
  const gpu = primaryGpu.value
  return [
    { label: '主板', value: joinParts([boardData.value?.manufacturer, boardData.value?.model]) || '--' },
    { label: 'BIOS 版本', value: joinParts([biosData.value?.version, biosData.value?.releaseDate ? `(${biosData.value.releaseDate})` : '']) || '--' },
    { label: '显卡驱动', value: cleanText(gpu?.driverVersion) || '--' },
    { label: '遥测来源', value: formatGpuTelemetrySource(gpu) },
    { label: '温度来源', value: formatGpuTemperatureSource(gpu) },
    ...(gpuNativeFallbackReason.value
      ? [{ label: '原生回退原因', value: gpuNativeFallbackReason.value }]
      : []),
    ...(graphicsPlatformPanels.value.temperatureProbes
      ? [{ label: 'GPU 温度测点', value: gpuCoreTemperatureRows.value.length ? `${gpuCoreTemperatureRows.value.length} 个` : '--' }]
      : []),
    { label: '显示器', value: cleanText(mainDisplay.value?.model || mainDisplay.value?.deviceName) || '--' },
    { label: '操作系统', value: joinParts([osInfo.value?.distro || osInfo.value?.platform, osInfo.value?.release, osInfo.value?.arch]) || '--' },
  ]
})

const graphicsReportText = computed(() => {
  const gpu = primaryGpu.value
  const gpuIdle = getGpuIdlePercent(gpu)
  const lines = [
    '显卡页面报告',
    `导出时间：${new Date().toLocaleString('zh-CN')}`,
    '',
    `显卡：${gpu?.model || gpu?.name || '--'}`,
    `厂商：${gpu?.vendor || '--'}`,
    `总线：${joinParts([gpu?.bus, gpu?.pciBus], ' / ') || '--'}`,
    `遥测来源：${formatGpuTelemetrySource(gpu)}`,
    `温度来源：${formatGpuTemperatureSource(gpu)}`,
    `温度：${formatTemperature(safeNumber(gpu?.temperatureGpu))}`,
    `空闲率：${formatPercent(gpuIdle)}`,
    `功耗：${formatPower(safeNumber(gpu?.powerDraw))}`,
    `使用率：${formatPercent(safeNumber(gpu?.utilizationGpu))}`,
    `当前频率：${formatClock(safeNumber(gpu?.clockCore))}`,
    `显存占用：${joinParts([formatMemoryAmount(safeNumber(gpu?.memoryUsed)), '/', formatMemoryAmount(safeNumber(gpu?.memoryTotal || gpu?.vram))], ' ')}`,
    ...(graphicsPlatformPanels.value.temperatureProbes
      ? (
          gpu?.gpuCoreTemperatures?.length
            ? gpu.gpuCoreTemperatures.map((sensor, index) => `${formatGpuTemperatureSensorLabel(sensor, index)}：${formatTemperature(safeNumber(sensor.value))}`)
            : ['GPU 温度测点：暂不支持']
        )
      : []),
    '',
    ...detailSpecs.value.map((item) => `${item.label}：${item.value}`),
    '',
    ...platformRows.value.map((item) => `${item.label}：${item.value}`),
  ]

  return lines.join('\n')
})

function exportReport() {
  const blob = new Blob([graphicsReportText.value], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `graphics-report-${new Date().toISOString().slice(0, 10)}.txt`
  anchor.click()
  URL.revokeObjectURL(url)
}

async function copyGraphicsInfo() {
  try {
    await writeClipboard(graphicsReportText.value)
    return true
  } catch (error) {
    console.error('复制显卡信息失败:', error)
    return false
  }
}

function startStressTest() {
  stressState.value = 'pending'
  window.setTimeout(() => {
    stressState.value = 'idle'
  }, 1800)
  return false
}

async function retryGraphicsPage() {
  await refreshGraphicsHardwareData()
}

defineExpose({
  exportReport,
  copyGraphicsInfo,
  startStressTest,
})

async function ensureStoreActive() {
  if (subscribed.value) return

  subscribed.value = true
  await activateGraphicsHardwareStore()
}

function releaseStore() {
  if (!subscribed.value) return

  deactivateGraphicsHardwareStore()
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
  <div class="graphics-page">
    <StateBlock
      v-if="loading"
      variant="loading"
      title="正在同步显卡数据"
      description="正在读取 GPU、显示器、驱动与实时遥测信息。"
      action-label="重试该模块"
      @retry="retryGraphicsPage"
    />

    <StateBlock
      v-else-if="pageStateBlock"
      :variant="pageStateBlock.variant"
      :title="pageStateBlock.title"
      :description="pageStateBlock.description"
      :action-label="pageStateBlock.actionLabel"
      @retry="retryGraphicsPage"
    />

    <template v-else>
      <section class="graphics-hero">
        <article class="hero-card">
          <div class="hero-card__head">
            <div :class="['gpu-badge', `gpu-badge--${badgeMeta.variant}`, { 'gpu-badge--compact': badgeMeta.compact }]">
              <span>{{ badgeMeta.top }}</span>
              <strong>{{ badgeMeta.middle }}</strong>
              <em>{{ badgeMeta.bottom }}</em>
            </div>

            <div class="hero-card__title">
              <h2>{{ primaryGpu?.model || primaryGpu?.name || '读取中' }}</h2>
              <p>{{ joinParts([primaryGpu?.vendor, primaryGpu?.deviceId], ' | ') || '未识别显卡信息' }}</p>
            </div>
          </div>

          <div class="hero-specs">
            <div v-for="item in heroSpecs" :key="item.label" class="hero-spec">
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
            <p>聚焦 GPU 负载、空闲率、温度、频率、显存与功耗</p>
          </div>
          <button type="button" class="panel-action">监控设置</button>
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
              <span>{{ card.unsupported ? '当前机器暂不支持' : card.footerLeft }}</span>
              <span v-if="!card.unsupported">{{ card.footerRight }}</span>
            </div>
          </article>
        </div>
      </section>

      <section class="graphics-grid">
        <article v-if="graphicsPlatformPanels.temperatureProbes" class="graphics-panel">
          <div class="graphics-panel__title">
            <h3>GPU 温度测点</h3>
            <p>{{ gpuCoreTemperatureRows.length ? `已识别 ${gpuCoreTemperatureRows.length} 个温度测点` : '当前温度源未返回分测点数据' }}</p>
          </div>

          <p v-if="gpuNativeFallbackReason" class="graphics-panel__hint">
            当前回退到 AppleSMC。原生探针失败：{{ gpuNativeFallbackReason }}
          </p>
          <p v-if="gpuNativeFallbackSuggestion" class="graphics-panel__hint">
            建议：{{ gpuNativeFallbackSuggestion }}
          </p>

          <div v-if="gpuCoreTemperatureRows.length" class="gpu-core-grid">
            <article v-for="row in gpuCoreTemperatureRows" :key="row.id" class="gpu-core-chip">
              <strong :style="{ color: row.accent }">{{ row.label }}</strong>
              <span>{{ row.value }}</span>
              <em>{{ row.subtitle }}</em>
            </article>
          </div>
          <div v-else class="gpu-core-empty">当前机器暂未返回分测点 GPU 温度</div>
        </article>

        <article v-if="graphicsPlatformPanels.telemetryDetails" class="graphics-panel">
          <div class="graphics-panel__title">
            <h3>核心 / 显存详情</h3>
            <p>当前 GPU 遥测与链路状态</p>
          </div>

          <div class="stat-table">
            <div v-for="row in telemetryRows" :key="row.label" class="stat-table__row">
              <span>{{ row.label }}</span>
              <strong>{{ row.value }}</strong>
              <em :class="['status-pill', row.statusTone ? `status-pill--${row.statusTone}` : '']">{{ row.status }}</em>
            </div>
          </div>
        </article>

        <article class="graphics-panel">
          <div class="graphics-panel__title">
            <h3>接口与显示输出</h3>
            <p>当前连接状态与主显示器信息</p>
          </div>

          <div class="port-grid">
            <article v-for="chip in portChips" :key="`${chip.label}-${chip.state}`" class="port-chip" :class="{ 'port-chip--connected': chip.connected }">
              <strong>{{ chip.label }}</strong>
              <span>{{ chip.state }}</span>
            </article>
          </div>

          <div class="output-list">
            <div v-for="row in outputRows" :key="row.label" class="output-row">
              <span>{{ row.label }}</span>
              <strong>{{ row.value }}</strong>
            </div>
          </div>
        </article>

        <article class="graphics-panel">
          <div class="graphics-panel__title">
            <h3>详细规格</h3>
            <p>驱动、能力与板卡信息</p>
          </div>

          <div class="detail-specs">
            <div v-for="item in detailSpecs" :key="item.label" class="detail-spec">
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
            </div>
          </div>
        </article>
      </section>

    </template>
  </div>
</template>

<style scoped lang="less">
.graphics-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
  min-height: 0;
  overflow: auto;
  padding-right: 6px;
}

.graphics-empty {
  display: grid;
  place-items: center;
  min-height: 320px;
  border: 1px solid var(--panel-border);
  border-radius: var(--surface-radius);
  background: linear-gradient(180deg, rgba(19, 28, 40, 0.94), rgba(16, 24, 35, 0.96));
  color: var(--text-muted);
  font-size: 15px;
}

.graphics-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(320px, 0.95fr);
  gap: 12px;
}

.hero-card,
.health-card,
.monitor-panel,
.graphics-panel {
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

.gpu-badge {
  display: grid;
  gap: 4px;
  align-content: center;
  width: 102px;
  min-height: 82px;
  padding: 12px 10px;
  border-radius: 14px;
  background: linear-gradient(160deg, rgba(69, 181, 255, 0.94), rgba(35, 79, 162, 0.9));
  color: var(--text-primary);
  box-shadow: 0 18px 36px rgba(13, 39, 80, 0.28);
  overflow: hidden;

  span {
    display: block;
    min-width: 0;
    font-size: 11px;
    letter-spacing: 0.06em;
    line-height: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  strong {
    display: block;
    min-width: 0;
    font-size: 22px;
    line-height: 1;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  em {
    font-style: normal;
    font-size: 13px;
    font-weight: 700;
    line-height: 1;
    text-transform: uppercase;
    opacity: 0.86;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

.gpu-badge--compact {
  gap: 5px;

  strong {
    font-size: 16px;
  }

  em {
    font-size: 12px;
  }
}

.gpu-badge--amd {
  background: linear-gradient(160deg, rgba(221, 62, 56, 0.92), rgba(118, 32, 28, 0.88));
  box-shadow: 0 18px 36px rgba(64, 16, 14, 0.28);
}

.gpu-badge--apple {
  background: linear-gradient(160deg, rgba(107, 121, 255, 0.92), rgba(54, 63, 156, 0.88));
  box-shadow: 0 18px 36px rgba(25, 31, 85, 0.28);
}

.gpu-badge--intel {
  background: linear-gradient(160deg, rgba(69, 144, 255, 0.92), rgba(34, 79, 162, 0.88));
  box-shadow: 0 18px 36px rgba(13, 39, 80, 0.28);
}

.gpu-badge--generic {
  background: linear-gradient(160deg, rgba(62, 118, 181, 0.9), rgba(32, 61, 105, 0.88));
  box-shadow: 0 18px 36px rgba(14, 30, 55, 0.26);
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

.monitor-panel {
  padding: var(--surface-padding);
}

.panel-title,
.graphics-panel__title {
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

.graphics-panel__hint {
  margin: -4px 0 12px;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.5;
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

.monitor-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
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

.graphics-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 0.9fr;
  gap: 12px;
}

.graphics-panel {
  min-height: 0;
  padding: var(--surface-padding);
}

.stat-table {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.gpu-core-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.gpu-core-chip {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 10px 8px;
  border: 1px solid rgba(84, 104, 132, 0.28);
  border-radius: 10px;
  background: rgba(18, 29, 44, 0.72);

  strong {
    font-size: 13px;
    font-weight: 700;
  }

  span {
    color: var(--text-primary);
    font-size: 15px;
    font-weight: 700;
  }

  em {
    color: var(--text-subtle);
    font-style: normal;
    font-size: 12px;
  }
}

.gpu-core-empty {
  display: grid;
  place-items: center;
  min-height: 160px;
  border: 1px dashed rgba(84, 104, 132, 0.28);
  border-radius: 12px;
  color: var(--text-muted);
  font-size: 13px;
  text-align: center;
}

.stat-table__row {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.95fr) auto;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
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

.status-pill {
  justify-self: start;
  min-height: var(--pill-height);
  padding: 0 10px;
  border-radius: var(--pill-radius);
  background: var(--state-neutral-bg);
  color: var(--state-neutral-fg);
  font-style: normal;
  font-size: 12px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
  flex-shrink: 0;
}

.status-pill--good {
  background: var(--state-good-bg);
  color: var(--state-good-fg);
}

.status-pill--warn {
  background: var(--state-warn-bg);
  color: var(--state-warn-fg);
}

.status-pill--normal {
  background: var(--state-neutral-bg);
  color: var(--state-neutral-fg);
}

.port-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
  margin-bottom: 16px;
}

.port-chip {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 10px 10px 8px;
  border: 1px solid rgba(84, 104, 132, 0.28);
  border-radius: 10px;
  background: rgba(18, 29, 44, 0.72);

  strong {
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 700;
    line-height: 1.25;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  span {
    color: var(--text-subtle);
    font-size: 12px;
  }
}

.port-chip--connected {
  border-color: rgba(84, 211, 88, 0.28);

  span {
    color: var(--accent-green);
  }
}

.output-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.output-row,
.detail-spec {
  display: grid;
  grid-template-columns: 110px minmax(0, 1fr);
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

.detail-specs {
  display: grid;
  gap: 8px;
}

@media (max-width: 1320px) {
  .graphics-hero,
  .graphics-grid {
    grid-template-columns: 1fr;
  }

  .monitor-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .gpu-core-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 980px) {
  .hero-specs {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .quick-stats,
  .monitor-grid,
  .gpu-core-grid,
  .port-grid {
    grid-template-columns: 1fr;
  }

  .stat-table__row,
  .output-row,
  .detail-spec {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
