<script setup lang="ts">
import { Chip, Cpu, GraphicDesign, Memory } from '@icon-park/vue-next'
import { computed, onUnmounted, ref, watch } from 'vue'
import { graphicsHardwareStore } from '../../composables/useGraphicsHardwareData'
import { processorHardwareStore } from '../../composables/useProcessorHardwareData'
import {
  activateOverviewHardwareStore,
  deactivateOverviewHardwareStore,
  overviewHardwareStore,
  overviewLiteServiceLabels,
  refreshOverviewHardwareData,
  type OverviewLiteServiceKey,
} from '../../composables/useOverviewHardwareData'
import { hardwareStore } from '../../composables/useHardwareData'
import StateBlock from '../common/StateBlock.vue'
import {
  bytesToGB,
  clampPercent,
  formatBytes,
  formatDisplayResolution,
  formatUptime,
  getDisplayMemoryAvailableBytes,
  getDisplayMemoryAvailableLabel,
  getMemoryPressureLabel,
  getDisplayMemoryUsedBytes,
  getDisplayMemoryUsedLabel,
} from '../../utils'
import { splitItemsIntoColumns } from '../../utils/layout'
import { buildMonitoringDiagnosticsCards } from '../../utils/monitoringDebug'
import {
  formatOverviewGpuMemory,
  getOverviewAudioLines,
  getOverviewGpuLines,
  getOverviewNetworkLines,
  getOverviewStorageLines,
  normalizeOverviewGpuBus,
} from '../../utils/overview'

const props = defineProps<{
  active?: boolean
}>()

interface MetricCard {
  id: string
  label: string
  value: string
  accent: string
  percent: number
  trend: number[]
  footerStart?: string
  footerEnd?: string
  footerCenter?: string
}

interface DetailRow {
  id: string
  label: string
  lines: string[]
}

interface DebugSection {
  title: string
  items: string[]
}

const diagnosticsCards = computed(() =>
  buildMonitoringDiagnosticsCards([
    {
      id: 'overview-lite',
      label: '概览轻量',
      accent: 'var(--accent-blue)',
      currentMode: backgroundThrottled.value ? 'background' : 'foreground',
      diagnostics,
    },
    {
      id: 'shared-detail',
      label: '共享详情',
      accent: 'var(--accent-yellow)',
      currentMode: hardwareStore.backgroundThrottled.value ? 'background' : 'foreground',
      diagnostics: hardwareStore.diagnostics,
    },
    {
      id: 'processor',
      label: '处理器详情',
      accent: 'var(--accent-green)',
      currentMode: processorHardwareStore.backgroundThrottled.value ? 'background' : 'foreground',
      diagnostics: processorHardwareStore.diagnostics,
    },
    {
      id: 'graphics',
      label: '显卡详情',
      accent: 'var(--accent-purple)',
      currentMode: graphicsHardwareStore.backgroundThrottled.value ? 'background' : 'foreground',
      diagnostics: graphicsHardwareStore.diagnostics,
    },
  ])
)

const {
  loading,
  lastSyncedAt,
  cpuData,
  cpuTemperature,
  cpuLoad,
  memoData,
  memoLayoutData,
  boardData,
  biosData,
  diskData,
  displaysData,
  osInfo,
  timeInfo,
  audioDevices,
  networkInterfaces,
  metricHistory,
  fetchState,
  backgroundThrottled,
  diagnostics,
  primaryGpu,
  usedMemoPercent,
  storageUsage,
} = overviewHardwareStore

const serviceLabels = overviewLiteServiceLabels
const subscribed = ref(false)
const uptimeSeconds = ref(0)
const diagnosticsExpanded = ref(false)
const isDev = import.meta.env.DEV

let uptimeTimerId: number | undefined

const pageStateBlock = computed(() => {
  if (fetchState.cpuInfo.status === 'error' || fetchState.memInfo.status === 'error') {
    return {
      variant: 'error' as const,
      title: '系统概览读取失败',
      description: fetchState.cpuInfo.note || fetchState.memInfo.note || '读取处理器或内存摘要时发生异常，可以重试该模块。',
      actionLabel: '重试该模块',
    }
  }

  if (fetchState.cpuInfo.status === 'missing' && fetchState.memInfo.status === 'missing' && !cpuData.value && !memoData.value.total) {
    return {
      variant: 'empty' as const,
      title: '未识别到系统概览信息',
      description: '当前系统数据源没有返回处理器或内存摘要信息。',
      actionLabel: '重试该模块',
    }
  }

  return null
})

function cleanText(value: unknown) {
  if (typeof value !== 'string') return ''
  return value.trim()
}

function joinParts(parts: Array<string | number | null | undefined>, separator = ' ') {
  return parts
    .map((part) => (typeof part === 'number' ? String(part) : cleanText(part)))
    .filter(Boolean)
    .join(separator)
}

function formatMemoryModule(item: MemoLayoutData) {
  return joinParts([
    item.size ? `${bytesToGB(item.size)} GB` : '',
    item.type,
    item.clockSpeed ? `${item.clockSpeed} MHz` : '',
  ])
}

function formatBoardTitle() {
  const boardName = joinParts([boardData.value?.manufacturer, boardData.value?.model])
  if (boardName) return boardName
  if (cleanText(biosData.value?.vendor)) return cleanText(biosData.value?.vendor)
  if (loading.value) return '读取中'
  if (isDarwinPlatform.value) return 'Apple 平台固件'
  return '未识别主板信息'
}

function formatMemoryKit() {
  const sizes = memoLayoutData.value
    .map((item) => (item.size > 0 ? Number(bytesToGB(item.size)) : 0))
    .filter((item) => item > 0)

  if (!sizes.length) return ''

  const [firstSize] = sizes
  if (sizes.every((item) => item === firstSize)) {
    return `${firstSize.toFixed(0)} GB × ${sizes.length}`
  }

  return sizes.map((item) => `${item.toFixed(0)} GB`).join(' + ')
}

function memoryOverviewLines() {
  if (memoData.value.normalizedPlatform === 'darwin') {
    return [
      `内存压力 ${getMemoryPressureLabel(memoData.value.pressure?.level)}`,
      memoData.value.swapused ? `已用交换 ${bytesToGB(memoData.value.swapused)} GB` : '已用交换 0 GB',
      memoData.value.total ? `${bytesToGB(getDisplayMemoryUsedBytes(memoData.value))} GB / ${bytesToGB(memoData.value.total)} GB` : '',
    ].filter(Boolean)
  }

  return [
    joinParts([memoLayoutData.value[0]?.type, memoLayoutData.value[0]?.clockSpeed ? `${memoLayoutData.value[0].clockSpeed} MHz` : '']),
    formatMemoryKit(),
  ].filter(Boolean)
}

function installedMemoryBytes() {
  return memoLayoutData.value.reduce((sum, item) => sum + (item.size || 0), 0)
}

function formatDisplayLine(item: DisplayData) {
  const resolutionText = formatDisplayResolution(item)
  const diagonalText = item.sizeX && item.sizeY ? `${(item.sizeX / 25.4).toFixed(1)}"` : ''
  return joinParts([item.model || item.deviceName, diagonalText, resolutionText === '--' ? '' : resolutionText], ' / ')
}

function formatSyncTime(value?: number) {
  if (!value) return '--:--:--'
  return new Date(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
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

function getHistoryMin(values: number[]) {
  if (!values.length) return 0
  return Math.round(Math.min(...values))
}

function getHistoryMax(values: number[], fallback = 0) {
  if (!values.length) return Math.round(fallback)
  return Math.round(Math.max(fallback, ...values))
}

function formatTemperatureRange(values: number[], fallbackHigh = 0) {
  return {
    low: `↓ ${getHistoryMin(values)}°C`,
    high: `↑ ${getHistoryMax(values, fallbackHigh)}°C`,
  }
}

function ringStyle(percent: number, accent: string) {
  return {
    background: `conic-gradient(${accent} 0deg ${Math.max(0, Math.min(360, (percent / 100) * 360))}deg, rgba(255, 255, 255, 0.08) ${Math.max(0, Math.min(360, (percent / 100) * 360))}deg 360deg)`,
  }
}

function sparklinePoints(values: number[]) {
  const source = values.length ? values : [0, 0, 0, 0, 0, 0]
  const max = Math.max(100, ...source)
  const step = source.length > 1 ? 116 / (source.length - 1) : 116

  return source
    .map((value, index) => {
      const x = Number((index * step).toFixed(2))
      const y = Number((36 - (value / max) * 30).toFixed(2))
      return `${x},${y}`
    })
    .join(' ')
}

function startUptimeTicker() {
  if (uptimeTimerId) {
    window.clearInterval(uptimeTimerId)
  }

  if (uptimeSeconds.value <= 0) return

  uptimeTimerId = window.setInterval(() => {
    uptimeSeconds.value += 1
  }, 1000)
}

const displayList = computed(() => displaysData.value || [])
const isDarwinPlatform = computed(() => cleanText(osInfo.value?.platform).toLowerCase() === 'darwin')
const overviewAudioLines = computed(() => getOverviewAudioLines(audioDevices.value || []))
const overviewNetworkLines = computed(() => getOverviewNetworkLines(networkInterfaces.value || []))
const boardCardLines = computed(() => {
  const versionPrefix = isDarwinPlatform.value ? '固件' : 'BIOS'
  const versionLine = biosData.value?.version ? `${versionPrefix} ${biosData.value.version}` : ''
  const secondaryLine = cleanText(isDarwinPlatform.value ? biosData.value?.releaseDate : biosData.value?.releaseDate || biosData.value?.vendor)

  return [versionLine, secondaryLine]
    .filter(Boolean)
    .filter((line, index, list) => list.indexOf(line) === index && line !== formatBoardTitle())
})
const memoryStatusLabel = computed(() => (memoData.value.normalizedPlatform === 'darwin' ? '内存压力' : '内存使用率'))
const memoryStatusValue = computed(() =>
  memoData.value.normalizedPlatform === 'darwin'
    ? getMemoryPressureLabel(memoData.value.pressure?.level)
    : `${Math.round(usedMemoPercent.value)}%`
)
const memoryStatusFoot = computed(() => {
  const usageLine = memoData.value.total
    ? `${bytesToGB(getDisplayMemoryUsedBytes(memoData.value))} GB / ${bytesToGB(memoData.value.total)} GB`
    : '等待内存数据'

  if (memoData.value.normalizedPlatform !== 'darwin') return usageLine

  return joinParts([usageLine, `交换 ${bytesToGB(memoData.value.swapused || 0)} GB`], ' · ')
})
const gpuLoadPercent = computed(() => clampPercent(primaryGpu.value?.utilizationGpu || 0))
const cpuTemperatureValue = computed(() => {
  if (typeof cpuTemperature.value?.value === 'number') return cpuTemperature.value.value
  if (typeof cpuTemperature.value?.main === 'number') return cpuTemperature.value.main
  return null
})
const cpuTemperatureUnsupported = computed(() => cpuTemperature.value?.source === 'unsupported' && cpuTemperatureValue.value === null)
const cpuTemperatureIssueLabel = computed(() => {
  const reason = cpuTemperature.value?.reason || cpuTemperature.value?.errorCode || ''
  if (reason === 'MACOS_SMC_PERMISSION_REQUIRED') return '需要管理员权限'
  if (reason.startsWith('MACOS_SMC_')) return 'AppleSMC 读取失败'
  return cpuTemperatureUnsupported.value ? '暂不支持' : '--'
})
const cpuTemperatureIssueDetail = computed(() => {
  const reason = cpuTemperature.value?.reason || cpuTemperature.value?.errorCode || ''
  if (reason === 'MACOS_SMC_PERMISSION_REQUIRED') return 'AppleSMC 需要授权'
  if (reason.startsWith('MACOS_SMC_')) return 'AppleSMC 探针不可用'
  return cpuTemperatureUnsupported.value ? '当前机器暂不支持' : undefined
})

const summaryCards = computed(() => [
  {
    id: 'processor',
    label: '处理器',
    accent: 'var(--accent-blue)',
    icon: Cpu,
    title: cpuData.value?.brand || '读取中',
    lines: [
      joinParts([cpuData.value?.physicalCores ? `${cpuData.value.physicalCores} 核` : '', cpuData.value?.cores ? `${cpuData.value.cores} 线程` : '']),
      cpuData.value?.speed ? `${cpuData.value.speed} GHz` : '',
    ].filter(Boolean),
  },
  {
    id: 'graphics',
    label: '显卡',
    accent: 'var(--accent-green)',
    icon: GraphicDesign,
    title: primaryGpu.value?.model || primaryGpu.value?.name || '读取中',
    lines: [
      formatOverviewGpuMemory(primaryGpu.value),
      normalizeOverviewGpuBus(primaryGpu.value?.bus),
    ].filter(Boolean),
  },
  {
    id: 'memory',
    label: '内存',
    accent: 'var(--accent-purple)',
    icon: Memory,
    title: installedMemoryBytes() > 0 ? `${bytesToGB(installedMemoryBytes())} GB` : memoData.value.total ? `${bytesToGB(memoData.value.total)} GB` : '读取中',
    lines: memoryOverviewLines(),
  },
  {
    id: 'board',
    label: '主板',
    accent: 'var(--accent-yellow)',
    icon: Chip,
    title: formatBoardTitle(),
    lines: boardCardLines.value,
  },
])

const statusCards = computed<MetricCard[]>(() => [
  {
    id: 'cpu-temperature',
    label: 'CPU 温度',
    value: typeof cpuTemperatureValue.value === 'number' ? `${Math.round(cpuTemperatureValue.value)}°C` : cpuTemperatureIssueLabel.value,
    accent: 'var(--accent-blue)',
    percent: clampPercent(cpuTemperatureValue.value || 0),
    trend: metricHistory.cpuTemp,
    footerStart: cpuTemperatureUnsupported.value ? '' : formatTemperatureRange(metricHistory.cpuTemp, cpuTemperature.value?.max || 0).low,
    footerEnd: cpuTemperatureUnsupported.value ? '' : formatTemperatureRange(metricHistory.cpuTemp, cpuTemperature.value?.max || 0).high,
    footerCenter: cpuTemperatureValue.value === null ? cpuTemperatureIssueDetail.value : undefined,
  },
  {
    id: 'gpu-temperature',
    label: 'GPU 温度',
    value: typeof primaryGpu.value?.temperatureGpu === 'number' ? `${Math.round(primaryGpu.value.temperatureGpu)}°C` : '--',
    accent: 'var(--accent-green)',
    percent: clampPercent(primaryGpu.value?.temperatureGpu || 0),
    trend: metricHistory.gpuTemp,
    footerStart: formatTemperatureRange(metricHistory.gpuTemp, primaryGpu.value?.temperatureGpu || 0).low,
    footerEnd: formatTemperatureRange(metricHistory.gpuTemp, primaryGpu.value?.temperatureGpu || 0).high,
  },
  {
    id: 'cpu-usage',
    label: 'CPU 使用率',
    value: `${Math.round(cpuLoad.value)}%`,
    accent: 'var(--accent-blue)',
    percent: cpuLoad.value,
    trend: metricHistory.cpuLoad,
    footerCenter: `${Math.round(cpuLoad.value)}%`,
  },
  {
    id: 'gpu-usage',
    label: 'GPU 使用率',
    value: `${Math.round(gpuLoadPercent.value)}%`,
    accent: 'var(--accent-green)',
    percent: gpuLoadPercent.value,
    trend: metricHistory.gpuLoad,
    footerCenter: `${Math.round(gpuLoadPercent.value)}%`,
  },
  {
    id: 'memory-usage',
    label: memoryStatusLabel.value,
    value: memoryStatusValue.value,
    accent: 'var(--accent-purple)',
    percent: usedMemoPercent.value,
    trend: metricHistory.memoryLoad,
    footerCenter: memoryStatusFoot.value,
  },
  {
    id: 'storage-usage',
    label: '存储使用率',
    value: `${Math.round(storageUsage.value.percent)}%`,
    accent: 'var(--accent-yellow)',
    percent: storageUsage.value.percent,
    trend: metricHistory.storageLoad,
    footerCenter: storageUsage.value.total
      ? `${formatBytes(storageUsage.value.used)} / ${formatBytes(storageUsage.value.total)}`
      : '等待磁盘数据',
  },
])

const detailRows = computed<DetailRow[]>(() => {
  const boardLine = joinParts([boardData.value?.manufacturer, boardData.value?.model])
  const rows: DetailRow[] = [
  {
    id: 'system',
    label: '操作系统',
    lines: [joinParts([osInfo.value?.distro || osInfo.value?.platform, osInfo.value?.release, osInfo.value?.arch])],
  },
  {
    id: 'power',
    label: '运行时间',
    lines: [formatUptime(uptimeSeconds.value || timeInfo.value?.uptime || 0)],
  },
  ...(boardLine
    ? [{
        id: 'board',
        label: '主板',
        lines: [boardLine],
      }]
    : []),
  {
    id: 'display',
    label: '显示器',
    lines: displayList.value.map(formatDisplayLine),
  },
  {
    id: 'processor',
    label: '处理器',
    lines: [joinParts([cpuData.value?.brand, cpuData.value?.physicalCores ? `${cpuData.value.physicalCores} 核` : '', cpuData.value?.cores ? `${cpuData.value.cores} 线程` : ''])],
  },
    {
      id: 'memory',
      label: '内存',
      lines: [
      installedMemoryBytes() > 0 ? `已安装 ${bytesToGB(installedMemoryBytes())} GB` : '',
      memoData.value.total ? `系统总量 ${bytesToGB(memoData.value.total)} GB` : '',
      memoData.value.total ? `${getDisplayMemoryUsedLabel(memoData.value)} ${bytesToGB(getDisplayMemoryUsedBytes(memoData.value))} GB` : '',
      memoData.value.total ? `${getDisplayMemoryAvailableLabel(memoData.value)} ${bytesToGB(getDisplayMemoryAvailableBytes(memoData.value))} GB` : '',
      memoData.value.normalizedPlatform === 'darwin' ? `内存压力 ${getMemoryPressureLabel(memoData.value.pressure?.level)}` : '',
      memoData.value.normalizedPlatform === 'darwin' ? `已用交换 ${bytesToGB(memoData.value.swapused || 0)} GB` : '',
      ...memoLayoutData.value.slice(0, 2).map(formatMemoryModule),
      ].filter(Boolean),
    },
  {
    id: 'graphics',
    label: '显卡',
    lines: getOverviewGpuLines(primaryGpu.value),
  },
  {
    id: 'storage',
    label: '存储',
    lines: getOverviewStorageLines(storageUsage.value),
  },
  {
    id: 'audio',
    label: '音频',
    lines: overviewAudioLines.value,
  },
  {
    id: 'network',
    label: '网络',
    lines: overviewNetworkLines.value,
  },
  ]

  return rows.map((item) => ({
    ...item,
    lines: item.lines.length ? item.lines : ['未获取到相关信息'],
  }))
})

const detailRowColumns = computed(() => splitItemsIntoColumns(detailRows.value, 3))

const missingDebugSections = computed<DebugSection[]>(() => {
  const sections: DebugSection[] = []

  const serviceItems = (Object.keys(serviceLabels) as OverviewLiteServiceKey[])
    .filter((key) => fetchState[key].status !== 'ok')
    .map((key) => {
      const state = fetchState[key]
      const statusText =
        state.status === 'pending'
          ? '未请求'
          : state.status === 'missing'
            ? '未拿到数据'
            : '请求失败'

      return `${serviceLabels[key]}: ${statusText}${state.note ? ` (${state.note})` : ''}`
    })

  if (serviceItems.length) {
    sections.push({
      title: '服务返回异常',
      items: serviceItems,
    })
  }

  const fieldItems: string[] = []

  if (!cpuData.value?.brand) fieldItems.push('CPU 型号')
  if (!cpuData.value?.speed) fieldItems.push('CPU 当前频率')
  if (!cpuTemperatureUnsupported.value && cpuTemperature.value && cpuTemperatureValue.value === null) fieldItems.push('CPU 主温度')
  if (!primaryGpu.value) fieldItems.push('主显卡')
  if (primaryGpu.value && typeof primaryGpu.value.temperatureGpu !== 'number') fieldItems.push('GPU 温度')
  if (primaryGpu.value && typeof primaryGpu.value.utilizationGpu !== 'number') fieldItems.push('GPU 使用率')
  if (primaryGpu.value && !primaryGpu.value.bus) fieldItems.push('GPU 总线信息')
  if (!memoData.value.total) fieldItems.push('内存总容量')
  if (!memoLayoutData.value.length) fieldItems.push('内存插槽布局')
  if (memoLayoutData.value.length && !memoLayoutData.value.some((item) => item.clockSpeed)) fieldItems.push('内存频率')
  if (!boardData.value?.model) fieldItems.push('主板型号')
  if (!biosData.value?.version) fieldItems.push('BIOS 版本')
  if (!displayList.value.length) fieldItems.push('显示器信息')
  if (!diskData.value.length) fieldItems.push('磁盘占用信息')
  if (!audioDevices.value.length) fieldItems.push('音频设备')
  if (!networkInterfaces.value.some((item) => !item.internal)) fieldItems.push('外部网络接口')
  if (!osInfo.value?.distro && !osInfo.value?.platform) fieldItems.push('操作系统名称')
  if (!timeInfo.value?.uptime) fieldItems.push('系统运行时间')

  if (fieldItems.length) {
    sections.push({
      title: '关键字段缺失',
      items: fieldItems,
    })
  }

  return sections
})

const missingDebugText = computed(() => {
  const header = [
    '系统概览缺失参数调试报告',
    `生成时间: ${new Date().toLocaleString('zh-CN')}`,
    `最近同步: ${formatSyncTime(lastSyncedAt.value)}`,
    '',
  ]

  if (!missingDebugSections.value.length) {
    return [...header, '关键参数全部已拿到。'].join('\n')
  }

  const body = missingDebugSections.value.flatMap((section) => [
    `[${section.title}]`,
    ...section.items.map((item) => `- ${item}`),
    '',
  ])

  return [...header, ...body].join('\n').trim()
})

const monitoringDiagnosticsText = computed(() => {
  return [
    '监控刷新诊断报告',
    `生成时间: ${new Date().toLocaleString('zh-CN')}`,
    '',
    ...diagnosticsCards.value.flatMap((card) => [
      `[${card.label}]`,
      `状态: ${card.statusLabel}`,
      card.currentModeLabel,
      card.lastRefreshModeLabel,
      card.summaryLine,
      card.subscriberLine,
      card.trafficLine,
      card.lastSkipLine,
      card.lastRefreshLine,
      '',
    ]),
  ].join('\n').trim()
})

const syncLabel = computed(() => {
  if (loading.value) return '同步中'
  return `已同步 ${formatSyncTime(lastSyncedAt.value)}`
})

const overviewReportText = computed(() => {
  const reportLines = [
    '系统概览报告',
    `导出时间：${new Date().toLocaleString('zh-CN')}`,
    '',
    ...summaryCards.value.map((card) => `${card.label}：${card.title}${card.lines.length ? ` / ${card.lines.join(' / ')}` : ''}`),
    '',
    ...statusCards.value.map((card) => `${card.label}：${card.value}`),
    '',
    ...detailRows.value.map((row) => `${row.label}：${row.lines.join('；')}`),
  ]

  return reportLines.join('\n')
})

function exportReport() {
  const blob = new Blob([overviewReportText.value], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `hardware-report-${new Date().toISOString().slice(0, 10)}.txt`
  anchor.click()
  URL.revokeObjectURL(url)
}

async function copyMissingParams() {
  try {
    await writeClipboard(missingDebugText.value)
    return true
  } catch (error) {
    console.error('复制缺失参数失败:', error)
    return false
  }
}

async function copyMonitoringDiagnostics() {
  try {
    await writeClipboard(monitoringDiagnosticsText.value)
    return true
  } catch (error) {
    console.error('复制监控诊断失败:', error)
    return false
  }
}

async function copyOverviewInfo() {
  try {
    await writeClipboard(overviewReportText.value)
    return true
  } catch (error) {
    console.error('复制系统概览失败:', error)
    return false
  }
}

async function retryOverviewPage() {
  await refreshOverviewHardwareData()
}

defineExpose({
  exportReport,
  copyOverviewInfo,
  copyMissingParams,
  copyMonitoringDiagnostics,
})

function stopUptimeTicker() {
  if (uptimeTimerId) {
    window.clearInterval(uptimeTimerId)
    uptimeTimerId = undefined
  }
}

async function ensureStoreActive() {
  if (subscribed.value) return

  subscribed.value = true
  await activateOverviewHardwareStore()
}

function releaseStore() {
  if (subscribed.value) {
    deactivateOverviewHardwareStore()
    subscribed.value = false
  }

  stopUptimeTicker()
}

watch(
  () => timeInfo.value?.uptime,
  (uptime) => {
    uptimeSeconds.value = Math.floor(uptime || 0)
    if (props.active !== false) {
      startUptimeTicker()
    }
  },
  { immediate: true }
)

watch(
  () => props.active,
  async (active) => {
    if (active === false) {
      releaseStore()
      return
    }

    await ensureStoreActive()
    uptimeSeconds.value = Math.floor(timeInfo.value?.uptime || 0)
    startUptimeTicker()
  },
  { immediate: true }
)

onUnmounted(() => {
  releaseStore()
})
</script>

<template>
  <div class="dashboard-page">
    <StateBlock
      v-if="loading"
      variant="loading"
      title="正在同步系统概览"
      description="正在优先读取处理器、内存、主板和系统摘要。"
      action-label="重新同步"
      @retry="retryOverviewPage"
    />

    <StateBlock
      v-else-if="pageStateBlock"
      :variant="pageStateBlock.variant"
      :title="pageStateBlock.title"
      :description="pageStateBlock.description"
      :action-label="pageStateBlock.actionLabel"
      @retry="retryOverviewPage"
    />

    <div v-else class="dashboard-scroll">
      <div class="dashboard-shell">
        <section id="section-overview" class="summary-grid">
          <article v-for="card in summaryCards" :id="`section-${card.id}`" :key="card.id" class="summary-card">
            <div class="summary-card__icon" :style="{ color: card.accent }">
              <component :is="card.icon" theme="outline" size="22" fill="currentColor" :strokeWidth="3" />
            </div>
            <div class="summary-card__label">{{ card.label }}</div>
            <h2 class="summary-card__title">{{ card.title }}</h2>
            <p v-for="line in card.lines" :key="line" class="summary-card__line">{{ line }}</p>
          </article>
        </section>

        <section class="status-panel">
          <div class="panel-heading">
            <h3>硬件状态</h3>
            <span>{{ syncLabel }}</span>
          </div>

          <div class="status-grid">
            <article v-for="card in statusCards" :key="card.id" class="status-card">
              <div class="status-card__label">{{ card.label }}</div>

              <div class="status-card__ring" :style="ringStyle(card.percent, card.accent)">
                <div class="status-card__ring-inner">{{ card.value }}</div>
              </div>

              <svg class="status-card__sparkline" viewBox="0 0 116 36" preserveAspectRatio="none" aria-hidden="true">
                <polyline :points="sparklinePoints(card.trend)" :stroke="card.accent" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>

              <div class="status-card__footer" :class="{ 'status-card__footer--center': card.footerCenter }">
                <span v-if="card.footerStart">{{ card.footerStart }}</span>
                <strong v-if="card.footerCenter">{{ card.footerCenter }}</strong>
                <span v-if="card.footerEnd">{{ card.footerEnd }}</span>
              </div>
            </article>
          </div>
        </section>

        <section v-if="isDev" class="diagnostics-panel">
          <div class="panel-heading panel-heading--actions">
            <div>
              <h3>开发态刷新诊断</h3>
              <span>仅开发环境显示，默认折叠</span>
            </div>

            <div class="diagnostics-actions">
              <button type="button" class="diagnostics-action" @click="copyMonitoringDiagnostics()">
                复制报告
              </button>
              <button
                type="button"
                :class="['diagnostics-action', { 'diagnostics-action--active': diagnosticsExpanded }]"
                @click="diagnosticsExpanded = !diagnosticsExpanded"
              >
                {{ diagnosticsExpanded ? '收起' : '展开' }}
              </button>
            </div>
          </div>

          <div v-if="diagnosticsExpanded" class="diagnostics-grid">
            <article v-for="card in diagnosticsCards" :key="card.id" class="diagnostics-card">
              <div class="diagnostics-card__header">
                <div class="diagnostics-card__title">
                  <strong>{{ card.label }}</strong>
                  <span>{{ card.statusLabel }}</span>
                </div>
                <i :style="{ background: card.accent }"></i>
              </div>

              <div class="diagnostics-card__summary">{{ card.summaryLine }}</div>
              <div class="diagnostics-card__line">{{ card.currentModeLabel }}</div>
              <div class="diagnostics-card__line">{{ card.lastRefreshModeLabel }}</div>
              <div class="diagnostics-card__line">{{ card.subscriberLine }}</div>
              <div class="diagnostics-card__line">{{ card.trafficLine }}</div>
              <div class="diagnostics-card__line">{{ card.lastSkipLine }}</div>
              <div class="diagnostics-card__line">{{ card.lastRefreshLine }}</div>
            </article>
          </div>
        </section>

        <section class="detail-panel">
          <div class="panel-heading">
            <h3>详细信息</h3>
            <span>首屏优先展示常用摘要</span>
          </div>

          <div class="detail-grid">
            <div v-for="(column, columnIndex) in detailRowColumns" :key="`detail-column-${columnIndex}`" class="detail-column">
              <div v-for="row in column" :id="`section-${row.id}`" :key="row.label" class="detail-row">
                <div class="detail-row__label">{{ row.label }}</div>
                <div class="detail-row__value">
                  <div v-for="line in row.lines" :key="line" class="detail-row__line">{{ line }}</div>
                </div>
              </div>
            </div>
          </div>
        </section>

      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
.dashboard-page {
  height: 100%;
  min-height: 0;
}

.dashboard-scroll {
  height: 100%;
  min-height: 0;
  overflow: auto;
  padding-right: 6px;
}

.dashboard-shell {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

:deep([id^='section-']) {
  scroll-margin-top: 18px;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.summary-card,
.status-panel,
.diagnostics-panel,
.detail-panel {
  border: 1px solid var(--panel-border);
  border-radius: var(--surface-radius);
  background:
    linear-gradient(180deg, rgba(21, 31, 44, 0.98), rgba(17, 25, 35, 0.98)),
    radial-gradient(circle at top left, rgba(66, 128, 240, 0.08), transparent 28%);
  box-shadow: var(--panel-shadow);
}

.summary-card {
  min-height: 172px;
  padding: var(--surface-padding);
}

.summary-card__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  margin-bottom: 10px;
  border-radius: 12px;
  background: rgba(14, 22, 34, 0.5);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.04);
}

.summary-card__label {
  color: var(--text-subtle);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.summary-card__title {
  margin: 8px 0 8px;
  color: var(--text-primary);
  font-size: 18px;
  font-weight: 700;
  line-height: 1.3;
}

.summary-card__line {
  margin: 0 0 4px;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.5;
}

.status-panel,
.diagnostics-panel,
.detail-panel {
  padding: var(--surface-padding);
}

.panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--surface-heading-gap);
  margin-bottom: var(--surface-heading-margin);

  h3 {
    margin: 0;
    color: var(--text-primary);
    font-size: var(--surface-title-size);
    font-weight: 700;
  }

  span {
    color: var(--text-subtle);
    font-size: 13px;
  }
}

.panel-heading--actions {
  align-items: flex-start;
}

.diagnostics-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.diagnostics-action {
  min-height: var(--control-height);
  border: 1px solid var(--control-border);
  border-radius: var(--control-radius);
  padding: 0 14px;
  background: var(--control-bg-soft);
  color: var(--control-fg);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.18s ease, background 0.18s ease, color 0.18s ease, transform 0.18s ease;
}

.diagnostics-action:hover {
  border-color: var(--control-border-strong);
  color: var(--control-fg-strong);
  transform: translateY(-1px);
}

.diagnostics-action--active {
  border-color: var(--control-active-border);
  background: var(--control-active-bg);
  color: var(--control-fg-strong);
  box-shadow: var(--control-active-shadow);
}

.diagnostics-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.diagnostics-card {
  border: 1px solid var(--panel-border-soft);
  border-radius: 14px;
  padding: 14px 16px;
  background: rgba(255, 255, 255, 0.025);
}

.diagnostics-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;

  i {
    display: block;
    width: 10px;
    height: 10px;
    margin-top: 5px;
    border-radius: 50%;
    box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.04);
  }
}

.diagnostics-card__title {
  display: flex;
  flex-direction: column;
  gap: 4px;

  strong {
    color: var(--text-primary);
    font-size: 15px;
    font-weight: 700;
  }

  span {
    color: var(--text-muted);
    font-size: 12px;
  }
}

.diagnostics-card__summary {
  margin-bottom: 10px;
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 700;
}

.diagnostics-card__line {
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.65;
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 0;
}

.status-card {
  padding: 8px 12px 2px;
  border-right: 1px solid var(--panel-border-soft);
}

.status-card:last-child {
  border-right: 0;
}

.status-card__label {
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
  text-align: center;
}

.status-card__ring {
  position: relative;
  width: 82px;
  height: 82px;
  margin: 12px auto 10px;
  border-radius: 50%;
  padding: 6px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.04);
}

.status-card__ring-inner {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: rgba(26, 35, 48, 0.96);
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 700;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.04);
}

.status-card__sparkline {
  display: block;
  width: 100px;
  height: 28px;
  margin: 0 auto 8px;
  opacity: 0.94;
}

.status-card__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
  white-space: nowrap;

  strong {
    color: var(--text-secondary);
    font-weight: 600;
  }
}

.status-card__footer--center {
  justify-content: center;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.detail-column {
  display: flex;
  flex-direction: column;
}

.detail-row {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr);
  gap: 12px;
  padding: 8px 0;
  border-top: 1px solid var(--panel-border-soft);
}

.detail-row:first-child {
  border-top: 0;
  padding-top: 0;
}

.detail-row__label {
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.55;
}

.detail-row__value {
  color: var(--text-secondary);
  font-size: 13px;
  word-break: break-word;
}

.detail-row__line {
  line-height: 1.55;
}

@media (max-width: 1480px) {
  .detail-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 1280px) {
  .summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .status-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px 0;
  }

  .diagnostics-grid {
    grid-template-columns: 1fr;
  }

  .status-card:nth-child(3n) {
    border-right: 0;
  }
}
</style>
