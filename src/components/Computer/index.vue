<script setup lang="ts">
import { Chip, Cpu, GraphicDesign, HardDisk, Memory, Wifi } from '@icon-park/vue-next'
import { computed, ref, watch } from 'vue'
import { useActivePageLifecycle } from '../../composables/useActivePageLifecycle'
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
  formatBytes,
  formatDisplayResolution,
  formatUptime,
  getDisplayMemoryAvailableBytes,
  getDisplayMemoryCapacityBytes,
  getDisplayMemoryCapacityLabel,
  getDisplayMemoryAvailableLabel,
  getMemoryPressureLabel,
  getDisplayMemoryUsedBytes,
  getDisplayMemoryUsedLabel,
  getInstalledMemoryBytes,
  getPhysicalDiskLayout,
} from '../../utils'
import { splitItemsIntoColumns } from '../../utils/layout'
import { downloadTextFile, writeClipboardText } from '../../utils/presentation'
import { buildMonitoringDiagnosticsCards } from '../../utils/monitoringDebug'
import {
  formatOverviewGpuMemory,
  getOverviewAudioLines,
  getOverviewGpuLines,
  getOverviewNetworkCandidates,
  getOverviewNetworkLines,
  getOverviewStorageLines,
  normalizeOverviewGpuBus,
} from '../../utils/overview'

const props = defineProps<{
  active?: boolean
}>()

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
  initialized,
  lastSyncedAt,
  cpuData,
  memoData,
  memoLayoutData,
  boardData,
  biosData,
  diskData,
  diskLayoutData,
  displaysData,
  osInfo,
  timeInfo,
  audioDevices,
  networkInterfaces,
  networkStatus,
  fetchState,
  backgroundThrottled,
  diagnostics,
  primaryGpu,
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

function cleanVendorText(value: unknown) {
  const text = cleanText(value)
  if (!text || text.includes('\uFFFD')) return ''
  return text
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
  if (fetchState.boardData.status === 'pending' || fetchState.biosData.status === 'pending') return '读取中'
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

const memoryOverviewManufacturer = computed(() => {
  const manufacturers = memoLayoutData.value
    .map((item) => cleanVendorText(item.manufacturer))
    .filter(Boolean)
  return Array.from(new Set(manufacturers)).join(' / ')
})

const overviewPhysicalDisks = computed(() => getPhysicalDiskLayout(diskLayoutData.value))
const primaryOverviewDisk = computed(() => overviewPhysicalDisks.value[0])

function formatVendorModel(vendor: unknown, model: unknown) {
  const vendorText = cleanVendorText(vendor)
  const modelText = cleanText(model)
  if (!vendorText) return modelText
  if (!modelText) return vendorText
  if (modelText.toLowerCase().startsWith(vendorText.toLowerCase())) return modelText
  return `${vendorText} ${modelText}`
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
  return getInstalledMemoryBytes(memoLayoutData.value)
}

function displayMemoryCapacityBytes() {
  return getDisplayMemoryCapacityBytes(memoLayoutData.value, memoData.value)
}

function displayMemoryCapacityLabel() {
  return getDisplayMemoryCapacityLabel(memoLayoutData.value)
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

function formatNetworkRate(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? `${formatBytes(value)}/s` : '--'
}

function formatNetworkLatency(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? `${Math.round(value)} ms` : '--'
}

function formatNetworkType(value: unknown) {
  const normalized = cleanText(value).toLowerCase()
  if (!normalized) return ''
  if (normalized.includes('wireless') || normalized.includes('wifi') || normalized.includes('wi-fi')) return 'Wi-Fi'
  if (normalized.includes('wired') || normalized.includes('ethernet')) return '以太网'
  return cleanText(value)
}

function formatNetworkLinkSpeed(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return ''
  if (value >= 1000) return `${Number((value / 1000).toFixed(value % 1000 === 0 ? 0 : 1))} Gbps`
  return `${Math.round(value)} Mbps`
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
const primaryNetworkInterface = computed(() => {
  const defaultInterface = cleanText(networkStatus.value.defaultInterface)
  const exactMatch = defaultInterface
    ? networkInterfaces.value.find((item) => item.iface === defaultInterface || item.ifaceName === defaultInterface)
    : undefined

  return exactMatch || getOverviewNetworkCandidates(networkInterfaces.value || [], 1)[0]
})
const networkSummaryTitle = computed(() => {
  const item = primaryNetworkInterface.value
  const interfaceName = cleanText(item?.ifaceName) || cleanText(item?.iface) || cleanText(networkStatus.value.defaultInterface)
  const type = formatNetworkType(item?.type)
  return joinParts([type, interfaceName], ' · ') || (fetchState.networkInterfaces.status === 'pending' ? '检测中' : '未识别活动网络')
})
const networkSummaryLines = computed(() => {
  const item = primaryNetworkInterface.value
  const addressLine = joinParts([
    cleanText(item?.ip4) ? `IPv4 ${cleanText(item?.ip4)}` : '',
    formatNetworkLinkSpeed(item?.speed),
  ], ' · ')
  const gatewayLine = joinParts([
    cleanText(networkStatus.value.gateway) ? `网关 ${cleanText(networkStatus.value.gateway)}` : '',
    typeof networkStatus.value.latencyMs === 'number' ? `延迟 ${formatNetworkLatency(networkStatus.value.latencyMs)}` : '',
  ], ' · ')
  const trafficLine = joinParts([
    typeof networkStatus.value.rxSec === 'number' ? `↓ ${formatNetworkRate(networkStatus.value.rxSec)}` : '',
    typeof networkStatus.value.txSec === 'number' ? `↑ ${formatNetworkRate(networkStatus.value.txSec)}` : '',
  ], ' · ')
  const lines = [addressLine, trafficLine, gatewayLine].filter(Boolean)

  if (lines.length) return lines
  if (fetchState.networkInterfaces.status === 'pending' || fetchState.networkStatus.status === 'pending') {
    return ['正在读取 IP、链路和实时流量']
  }
  return ['未获取到活动网络信息']
})
const overviewNetworkStatusLines = computed(() => {
  const lines = [
    joinParts([
      networkStatus.value.defaultInterface ? `默认 ${networkStatus.value.defaultInterface}` : '',
      networkStatus.value.gateway ? `网关 ${networkStatus.value.gateway}` : '',
      networkStatus.value.operstate ? networkStatus.value.operstate : '',
    ], ' · '),
    joinParts([
      `网关延迟 ${formatNetworkLatency(networkStatus.value.latencyMs)}`,
      `↓ ${formatNetworkRate(networkStatus.value.rxSec)}`,
      `↑ ${formatNetworkRate(networkStatus.value.txSec)}`,
    ], ' · '),
  ].filter(Boolean)

  return lines
})
const boardCardLines = computed(() => {
  const versionPrefix = isDarwinPlatform.value ? '固件' : 'BIOS'
  const versionLine = biosData.value?.version ? `${versionPrefix} ${biosData.value.version}` : ''
  const secondaryLine = cleanText(isDarwinPlatform.value ? biosData.value?.releaseDate : biosData.value?.releaseDate || biosData.value?.vendor)

  return [versionLine, secondaryLine]
    .filter(Boolean)
    .filter((line, index, list) => list.indexOf(line) === index && line !== formatBoardTitle())
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
    title: displayMemoryCapacityBytes() > 0
      ? joinParts([memoryOverviewManufacturer.value, `${bytesToGB(displayMemoryCapacityBytes())} GB`], ' · ')
      : memoryOverviewManufacturer.value || '读取中',
    lines: memoryOverviewLines(),
  },
  {
    id: 'storage',
    label: '硬盘',
    accent: 'var(--accent-yellow)',
    icon: HardDisk,
    title: primaryOverviewDisk.value
      ? formatVendorModel(primaryOverviewDisk.value.vendor, primaryOverviewDisk.value.name) || '已识别物理磁盘'
      : fetchState.diskLayout.status === 'pending' ? '读取中' : '未识别物理磁盘',
    lines: primaryOverviewDisk.value
      ? [
          primaryOverviewDisk.value.size ? formatBytes(primaryOverviewDisk.value.size) : '',
          joinParts([primaryOverviewDisk.value.interfaceType, primaryOverviewDisk.value.type], ' · '),
          overviewPhysicalDisks.value.length > 1 ? `另有 ${overviewPhysicalDisks.value.length - 1} 块物理磁盘` : '',
        ].filter(Boolean)
      : getOverviewStorageLines(storageUsage.value),
  },
  {
    id: 'board',
    label: '主板',
    accent: 'var(--accent-yellow)',
    icon: Chip,
    title: formatBoardTitle(),
    lines: boardCardLines.value,
  },
  {
    id: 'network',
    label: '网络',
    accent: 'var(--accent-blue)',
    icon: Wifi,
    title: networkSummaryTitle.value,
    lines: networkSummaryLines.value,
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
      displayMemoryCapacityBytes() > 0 ? `${displayMemoryCapacityLabel()} ${bytesToGB(displayMemoryCapacityBytes())} GB` : '',
      installedMemoryBytes() > 0 && memoData.value.total ? `系统可见总量 ${bytesToGB(memoData.value.total)} GB` : '',
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
    lines: [...overviewNetworkStatusLines.value, ...overviewNetworkLines.value],
  },
  ]

  return rows.map((item) => ({
    ...item,
    lines: item.lines.length ? item.lines : [initialized.value ? '未获取到相关信息' : '正在读取…'],
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
  if (!primaryGpu.value) fieldItems.push('主显卡')
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

const overviewReportText = computed(() => {
  const reportLines = [
    '系统概览报告',
    `导出时间：${new Date().toLocaleString('zh-CN')}`,
    '',
    ...summaryCards.value.map((card) => `${card.label}：${card.title}${card.lines.length ? ` / ${card.lines.join(' / ')}` : ''}`),
    '',
    ...detailRows.value.map((row) => `${row.label}：${row.lines.join('；')}`),
  ]

  return reportLines.join('\n')
})

function exportReport() {
  downloadTextFile(
    `hardware-report-${new Date().toISOString().slice(0, 10)}.txt`,
    overviewReportText.value
  )
}

async function copyMissingParams() {
  try {
    await writeClipboardText(missingDebugText.value)
    return true
  } catch (error) {
    console.error('复制缺失参数失败:', error)
    return false
  }
}

async function copyMonitoringDiagnostics() {
  try {
    await writeClipboardText(monitoringDiagnosticsText.value)
    return true
  } catch (error) {
    console.error('复制监控诊断失败:', error)
    return false
  }
}

async function copyOverviewInfo() {
  try {
    await writeClipboardText(overviewReportText.value)
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

useActivePageLifecycle(
  () => props.active,
  async () => {
    await ensureStoreActive()
    uptimeSeconds.value = Math.floor(timeInfo.value?.uptime || 0)
    startUptimeTicker()
  },
  releaseStore,
)
</script>

<template>
  <div class="dashboard-page">
    <StateBlock
      v-if="!loading && pageStateBlock"
      :variant="pageStateBlock.variant"
      :title="pageStateBlock.title"
      :description="pageStateBlock.description"
      :action-label="pageStateBlock.actionLabel"
      @retry="retryOverviewPage"
    />

    <div v-else class="dashboard-scroll">
      <div class="dashboard-shell">
        <div v-if="loading || !initialized" class="overview-progress" role="status" aria-live="polite">
          <span class="overview-progress__dot" aria-hidden="true"></span>
          <span>{{ loading ? '正在读取核心硬件信息，已返回的数据会立即显示' : '首屏已就绪，正在后台补齐详细硬件信息' }}</span>
        </div>
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

.overview-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 7px 12px;
  border: 1px solid var(--panel-border-soft);
  border-radius: 10px;
  background: rgba(43, 114, 255, 0.07);
  color: var(--text-muted);
  font-size: 12px;
}

.overview-progress__dot {
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--accent-blue);
  box-shadow: 0 0 0 4px rgba(43, 114, 255, 0.12);
  animation: overview-progress-pulse 1.2s ease-in-out infinite;
}

@keyframes overview-progress-pulse {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 1; }
}

:deep([id^='section-']) {
  scroll-margin-top: 18px;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 12px;
}

.summary-card,
.diagnostics-panel,
.detail-panel {
  border: 1px solid var(--panel-border);
  border-radius: var(--surface-radius);
  background: var(--surface-card-background);
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
  background: var(--surface-icon-background);
  box-shadow: inset 0 0 0 1px var(--surface-inset-highlight);
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
  background: var(--surface-softer-background);
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
    box-shadow: 0 0 0 4px var(--status-halo-background);
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

  .diagnostics-grid {
    grid-template-columns: 1fr;
  }
}
</style>
