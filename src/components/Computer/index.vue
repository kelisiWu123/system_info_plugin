<script setup lang="ts">
import { Chip, Cpu, GraphicDesign, Memory } from '@icon-park/vue-next'
import { computed, onUnmounted, ref, watch } from 'vue'
import { activateHardwareStore, deactivateHardwareStore, hardwareStore, overviewServiceLabels, type OverviewServiceKey } from '../../composables/useHardwareData'
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

const {
  loading,
  lastSyncedAt,
  cpuData,
  cpuTemperature,
  cpuLoad,
  memoData,
  memoLayoutData,
  gpuData,
  boardData,
  biosData,
  diskLayoutData,
  diskData,
  displaysData,
  osInfo,
  timeInfo,
  audioDevices,
  networkInterfaces,
  metricHistory,
  fetchState,
  primaryGpu,
  usedMemoPercent,
  storageUsage,
} = hardwareStore

const serviceLabels = overviewServiceLabels
const subscribed = ref(false)
const uptimeSeconds = ref(0)

let uptimeTimerId: number | undefined

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

function formatGpuMemory(gpu?: GpuData) {
  if (!gpu) return '未检测到显卡信息'
  const memory = gpu.memoryTotal || gpu.vram || 0
  if (!memory) return '显存未知'
  return `${(memory / 1024).toFixed(0)} GB`
}

function formatBoardTitle() {
  const boardName = joinParts([boardData.value?.manufacturer, boardData.value?.model])
  if (boardName) return boardName
  if (loading.value) return '读取中'
  const platform = cleanText(osInfo.value?.platform).toLowerCase()
  if (platform === 'darwin') return '当前平台未提供主板型号'
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

function formatGpuLine(item: GpuData) {
  const memory = item.memoryTotal || item.vram || 0
  return joinParts([
    item.model || item.name,
    memory ? `${(memory / 1024).toFixed(0)} GB` : '',
    item.bus ? item.bus : '',
  ], ' / ')
}

function formatDiskLayoutLine(item: DiskLayoutData) {
  const model = cleanText(item.name) || cleanText(item.device) || cleanText(item.vendor) || '未知硬盘'
  const sizeText = item.size > 0 ? formatBytes(item.size) : ''
  return joinParts([model, sizeText, item.interfaceType], ' / ')
}

function formatDisplayLine(item: DisplayData) {
  const resolutionText = formatDisplayResolution(item)
  const diagonalText = item.sizeX && item.sizeY ? `${(item.sizeX / 25.4).toFixed(1)}"` : ''
  return joinParts([item.model || item.deviceName, diagonalText, resolutionText === '--' ? '' : resolutionText], ' / ')
}

function formatAudioLine(item: AudioDeviceData) {
  return cleanText(item.name) || cleanText(item.manufacturer) || '未知音频设备'
}

function formatNetworkLine(item: NetworkInterfaceData) {
  const speedText = item.speed ? `${item.speed} Mbps` : ''
  return joinParts([cleanText(item.ifaceName) || cleanText(item.iface) || '未知网络接口', speedText], ' / ')
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

const gpuLoadPercent = computed(() => clampPercent(primaryGpu.value?.utilizationGpu || 0))
const cpuTemperatureValue = computed(() => {
  if (typeof cpuTemperature.value?.value === 'number') return cpuTemperature.value.value
  if (typeof cpuTemperature.value?.main === 'number') return cpuTemperature.value.main
  return null
})
const cpuTemperatureUnsupported = computed(() => cpuTemperature.value?.source === 'unsupported' && cpuTemperatureValue.value === null)

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
      formatGpuMemory(primaryGpu.value),
      primaryGpu.value?.bus ? primaryGpu.value.bus : '',
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
    lines: [
      biosData.value?.version ? `BIOS ${biosData.value.version}` : '',
      biosData.value?.releaseDate || biosData.value?.vendor || '',
    ].filter(Boolean),
  },
])

const statusCards = computed<MetricCard[]>(() => [
  {
    id: 'cpu-temperature',
    label: 'CPU 温度',
    value: typeof cpuTemperatureValue.value === 'number' ? `${Math.round(cpuTemperatureValue.value)}°C` : cpuTemperatureUnsupported.value ? '暂不支持' : '--',
    accent: 'var(--accent-blue)',
    percent: clampPercent(cpuTemperatureValue.value || 0),
    trend: metricHistory.cpuTemp,
    footerStart: cpuTemperatureUnsupported.value ? '' : formatTemperatureRange(metricHistory.cpuTemp, cpuTemperature.value?.max || 0).low,
    footerEnd: cpuTemperatureUnsupported.value ? '' : formatTemperatureRange(metricHistory.cpuTemp, cpuTemperature.value?.max || 0).high,
    footerCenter: cpuTemperatureUnsupported.value ? '当前机器暂不支持' : undefined,
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
    label: '内存使用率',
    value: `${Math.round(usedMemoPercent.value)}%`,
    accent: 'var(--accent-purple)',
    percent: usedMemoPercent.value,
    trend: metricHistory.memoryLoad,
    footerCenter: memoData.value.total ? `${bytesToGB(getDisplayMemoryUsedBytes(memoData.value))} GB / ${bytesToGB(memoData.value.total)} GB` : '等待内存数据',
  },
  {
    id: 'storage-usage',
    label: '存储使用率',
    value: cleanText(osInfo.value?.platform).toLowerCase() === 'darwin' ? '--' : `${Math.round(storageUsage.value.percent)}%`,
    accent: 'var(--accent-yellow)',
    percent: cleanText(osInfo.value?.platform).toLowerCase() === 'darwin' ? 0 : storageUsage.value.percent,
    trend: cleanText(osInfo.value?.platform).toLowerCase() === 'darwin' ? [] : metricHistory.storageLoad,
    footerCenter: cleanText(osInfo.value?.platform).toLowerCase() === 'darwin'
      ? 'macOS 暂不显示已用存储'
      : storageUsage.value.total
        ? `${formatBytes(storageUsage.value.used)} / ${formatBytes(storageUsage.value.total)}`
        : '等待磁盘数据',
  },
])

const detailRows = computed<DetailRow[]>(() => {
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
  {
    id: 'board',
    label: '主板',
    lines: [joinParts([boardData.value?.manufacturer, boardData.value?.model])],
  },
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
    lines: gpuData.value.map(formatGpuLine),
  },
  {
    id: 'storage',
    label: '存储',
    lines: diskLayoutData.value.map(formatDiskLayoutLine),
  },
  {
    id: 'audio',
    label: '音频',
    lines: audioDevices.value.map(formatAudioLine),
  },
  {
    id: 'network',
    label: '网络',
    lines: networkInterfaces.value.filter((item) => !item.internal).map(formatNetworkLine),
  },
  ]

  return rows.map((item) => ({
    ...item,
    lines: item.lines.length ? item.lines : ['未获取到相关信息'],
  }))
})

const detailRowsLeft = computed(() => detailRows.value.filter((_, index) => index % 2 === 0))
const detailRowsRight = computed(() => detailRows.value.filter((_, index) => index % 2 === 1))

const missingDebugSections = computed<DebugSection[]>(() => {
  const sections: DebugSection[] = []

  const serviceItems = (Object.keys(serviceLabels) as OverviewServiceKey[])
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
  if (!diskLayoutData.value.length) fieldItems.push('磁盘硬件信息')
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

const syncLabel = computed(() => {
  if (loading.value) return '同步中'
  return `已同步 ${formatSyncTime(lastSyncedAt.value)}`
})

function exportReport() {
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

  const blob = new Blob([reportLines.join('\n')], { type: 'text/plain;charset=utf-8' })
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

defineExpose({
  exportReport,
  copyMissingParams,
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
  await activateHardwareStore()
}

function releaseStore() {
  if (subscribed.value) {
    deactivateHardwareStore()
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
    <div class="dashboard-scroll">
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

        <section class="detail-panel">
          <div class="panel-heading">
            <h3>详细信息</h3>
          </div>

          <div class="detail-grid">
            <div class="detail-column">
              <div v-for="row in detailRowsLeft" :id="`section-${row.id}`" :key="row.label" class="detail-row">
                <div class="detail-row__label">{{ row.label }}</div>
                <div class="detail-row__value">
                  <div v-for="line in row.lines" :key="line" class="detail-row__line">{{ line }}</div>
                </div>
              </div>
            </div>

            <div class="detail-column">
              <div v-for="row in detailRowsRight" :id="`section-${row.id}`" :key="row.label" class="detail-row">
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
  gap: 18px;
  min-width: 0;
}

:deep([id^='section-']) {
  scroll-margin-top: 18px;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.summary-card,
.status-panel,
.detail-panel {
  border: 1px solid var(--panel-border);
  border-radius: 14px;
  background: linear-gradient(180deg, rgba(24, 34, 48, 0.98), rgba(21, 30, 43, 0.98));
  box-shadow: var(--panel-shadow);
}

.summary-card {
  min-height: 206px;
  padding: 26px 22px 22px;
}

.summary-card__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  margin-bottom: 14px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.02);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.05);
}

.summary-card__label {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.summary-card__title {
  margin: 10px 0 12px;
  color: var(--text-primary);
  font-size: 18px;
  font-weight: 700;
  line-height: 1.5;
}

.summary-card__line {
  margin: 0 0 7px;
  color: var(--text-muted);
  font-size: 14px;
  line-height: 1.45;
}

.status-panel,
.detail-panel {
  padding: 22px 28px 26px;
}

.panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 22px;

  h3 {
    margin: 0;
    color: var(--text-primary);
    font-size: 18px;
    font-weight: 700;
  }

  span {
    color: var(--text-subtle);
    font-size: 13px;
  }
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 0;
}

.status-card {
  padding: 10px 18px 4px;
  border-right: 1px solid var(--panel-border-soft);
}

.status-card:last-child {
  border-right: 0;
}

.status-card__label {
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 600;
  text-align: center;
}

.status-card__ring {
  position: relative;
  width: 100px;
  height: 100px;
  margin: 18px auto 16px;
  border-radius: 50%;
  padding: 7px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.04);
}

.status-card__ring-inner {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: #1a2330;
  color: var(--text-primary);
  font-size: 18px;
  font-weight: 700;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.04);
}

.status-card__sparkline {
  display: block;
  width: 116px;
  height: 32px;
  margin: 0 auto 10px;
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
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 26px;
}

.detail-column {
  display: flex;
  flex-direction: column;
}

.detail-row {
  display: grid;
  grid-template-columns: 140px minmax(0, 1fr);
  gap: 18px;
  padding: 12px 0;
  border-top: 1px solid var(--panel-border-soft);
}

.detail-row:first-child {
  border-top: 0;
  padding-top: 0;
}

.detail-row__label {
  color: var(--text-muted);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.7;
}

.detail-row__value {
  color: var(--text-secondary);
  font-size: 14px;
  word-break: break-word;
}

.detail-row__line {
  line-height: 1.7;
}

@media (max-width: 1280px) {
  .summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .status-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px 0;
  }

  .status-card:nth-child(3n) {
    border-right: 0;
  }
}
</style>
