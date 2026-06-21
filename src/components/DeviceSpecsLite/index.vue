<script setup lang="ts">
import { Computer, DataSheet, System, Time } from '@icon-park/vue-next'
import { computed, onUnmounted, ref, watch } from 'vue'
import {
  refreshDeviceSpecsHardwareData,
  useDeviceSpecsHardwareData,
} from '../../composables/useDeviceSpecsHardwareData'
import {
  formatBytes,
  formatDisplayResolution,
  formatUptime,
  getDisplayMemoryCapacityBytes,
  getPhysicalDiskLayout,
} from '../../utils'
import {
  formatOverviewGpuMemory,
  getOverviewNetworkCandidates,
  normalizeOverviewGpuBus,
} from '../../utils/overview'
import StateBlock from '../common/StateBlock.vue'

const props = defineProps<{
  active?: boolean
}>()

interface SummaryItem {
  id: string
  label: string
  value: string
  icon: unknown
  accent: string
}

interface SpecRow {
  id: string
  label: string
  lines: string[]
}

const {
  loading,
  cpuData,
  memoData,
  memoLayoutData,
  gpuData,
  diskData,
  diskLayoutData,
  boardData,
  biosData,
  systemData,
  displaysData,
  osInfo,
  timeInfo,
  audioDevices,
  networkInterfaces,
  loadDeviceSpecsHardwareData,
} = useDeviceSpecsHardwareData()

const uptimeSeconds = ref(0)
let uptimeTimerId: number | undefined

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function joinParts(parts: Array<string | number | null | undefined>, separator = ' ') {
  return parts
    .map((part) => (typeof part === 'number' ? String(part) : cleanText(part)))
    .filter(Boolean)
    .join(separator)
}

function uniqueLines(lines: string[]) {
  return Array.from(new Set(lines.map(cleanText).filter(Boolean)))
}

function formatCapacity(bytes?: number | null, digits = 0) {
  if (!Number.isFinite(bytes || 0) || !bytes) return ''
  const gb = bytes / (1024 * 1024 * 1024)
  if (gb >= 1) {
    const fixed = Number.isInteger(gb) ? gb.toFixed(0) : gb.toFixed(digits)
    return `${fixed} GB`
  }
  return formatBytes(bytes)
}

function formatDeviceModel() {
  const value = joinParts([
    systemData.value?.manufacturer,
    systemData.value?.model,
    systemData.value?.version,
  ])
  if (value) return value

  const boardValue = joinParts([boardData.value?.manufacturer, boardData.value?.model])
  if (boardValue) return boardValue

  return cleanText(osInfo.value?.hostname) || '未知设备'
}

function formatSystemInfo() {
  return joinParts([
    osInfo.value?.distro || osInfo.value?.platform,
    osInfo.value?.release,
    osInfo.value?.arch,
  ])
}

function installedMemoryBytes() {
  return getDisplayMemoryCapacityBytes(memoLayoutData.value, memoData.value)
}

function formatMemoryKit() {
  const sizes = memoLayoutData.value
    .map((item) => formatCapacity(item.size))
    .filter(Boolean)

  return sizes.length ? sizes.join(' + ') : ''
}

function formatMemoryLine() {
  const total = formatCapacity(installedMemoryBytes())
  const type = cleanText(memoLayoutData.value.find((item) => cleanText(item.type))?.type)
  const clock = Math.max(0, ...memoLayoutData.value.map((item) => item.clockSpeed || 0))
  const clockText = clock ? `${clock} MHz` : ''
  const kit = formatMemoryKit()
  const primary = joinParts([total, type, clockText])
  const fallback = total || formatCapacity(memoData.value.total)

  return kit ? `${primary}（${kit}）` : primary || fallback
}

function formatCpuLine() {
  return joinParts([
    cpuData.value?.brand,
    cpuData.value?.physicalCores ? `${cpuData.value.physicalCores} 核` : '',
    cpuData.value?.cores ? `${cpuData.value.cores} 线程` : '',
  ])
}

function formatGpuLine(item: GpuData) {
  const model = cleanText(item.model) || cleanText(item.name)
  const memory = formatOverviewGpuMemory(item)
  const bus = normalizeOverviewGpuBus(item.bus)
  const hint = item.vramDynamic ? '动态共享' : ''
  const meta = [memory, bus, hint].filter(Boolean).join(' / ')

  return meta ? `${model}（${meta}）` : model
}

function formatDisplayLine(item: DisplayData) {
  const resolution = formatDisplayResolution(item)
  const diagonal = item.sizeX && item.sizeY ? `${(item.sizeX / 25.4).toFixed(1)} 英寸` : ''
  const name = cleanText(item.model) || cleanText(item.deviceName) || cleanText(item.vendor)

  return joinParts([name, diagonal, resolution === '--' ? '' : resolution], ' / ')
}

function formatDiskLine(item: DiskLayoutData) {
  const name = joinParts([item.vendor, item.name]) || cleanText(item.device) || '未知磁盘'
  const meta = joinParts([formatCapacity(item.size), item.type, item.interfaceType], ' / ')

  return meta ? `${name}（${meta}）` : name
}

function formatVolumeLine(item: DiskData) {
  const name = cleanText(item.name) || cleanText(item.mount) || '磁盘卷'
  const meta = joinParts([formatCapacity(item.size), item.type, item.mount], ' / ')

  return meta ? `${name}（${meta}）` : name
}

function formatAudioLine(item: AudioDeviceData) {
  return cleanText(item.name) || cleanText(item.manufacturer)
}

function formatNetworkSpeed(speed?: number | null) {
  if (!speed || speed <= 0) return ''
  if (speed >= 1000 && speed % 1000 === 0) return `${speed / 1000} Gbps`
  if (speed > 1000) return `${(speed / 1000).toFixed(1)} Gbps`
  return `${speed} Mbps`
}

function formatNetworkLine(item: NetworkInterfaceData) {
  const name = cleanText(item.ifaceName) || cleanText(item.iface)
  const speed = formatNetworkSpeed(item.speed)
  const type = cleanText(item.type)
  const meta = [type, speed].filter(Boolean).join(' / ')

  return meta ? `${name}（${meta}）` : name
}

function withFallback(lines: string[]) {
  const normalized = uniqueLines(lines)
  return normalized.length ? normalized : ['未获取到相关信息']
}

const summaryItems = computed<SummaryItem[]>(() => [
  {
    id: 'model',
    label: '型号信息',
    value: formatDeviceModel(),
    icon: Computer,
    accent: 'var(--accent-blue)',
  },
  {
    id: 'system',
    label: '系统信息',
    value: formatSystemInfo() || '未知系统',
    icon: System,
    accent: 'var(--accent-cyan)',
  },
  {
    id: 'uptime',
    label: '运行时间',
    value: formatUptime(uptimeSeconds.value || timeInfo.value?.uptime || 0),
    icon: Time,
    accent: 'var(--accent-green)',
  },
])

const physicalDisks = computed(() => getPhysicalDiskLayout(diskLayoutData.value))

const specRows = computed<SpecRow[]>(() => [
  {
    id: 'processor',
    label: '处理器',
    lines: withFallback([formatCpuLine()]),
  },
  {
    id: 'board',
    label: '主板',
    lines: withFallback([
      joinParts([boardData.value?.manufacturer, boardData.value?.model]),
      joinParts([biosData.value?.vendor, biosData.value?.version, biosData.value?.releaseDate], ' / '),
    ]),
  },
  {
    id: 'memory',
    label: '内存',
    lines: withFallback([formatMemoryLine()]),
  },
  {
    id: 'graphics',
    label: '显卡',
    lines: withFallback(gpuData.value.map(formatGpuLine)),
  },
  {
    id: 'display',
    label: '显示器',
    lines: withFallback(displaysData.value.map(formatDisplayLine)),
  },
  {
    id: 'disk',
    label: '磁盘',
    lines: withFallback(
      physicalDisks.value.length
        ? physicalDisks.value.map(formatDiskLine)
        : diskData.value.slice(0, 4).map(formatVolumeLine)
    ),
  },
  {
    id: 'audio',
    label: '声卡',
    lines: withFallback(audioDevices.value.map(formatAudioLine).slice(0, 8)),
  },
  {
    id: 'network',
    label: '网卡',
    lines: withFallback(getOverviewNetworkCandidates(networkInterfaces.value, 3).map(formatNetworkLine)),
  },
])

const specsReportText = computed(() => {
  return [
    '轻量设备规格',
    `导出时间：${new Date().toLocaleString('zh-CN')}`,
    '',
    ...summaryItems.value.map((item) => `${item.label}：${item.value}`),
    '',
    ...specRows.value.map((row) => `${row.label}：${row.lines.join('；')}`),
  ].join('\n')
})

function exportReport() {
  const blob = new Blob([specsReportText.value], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `device-specs-${new Date().toISOString().slice(0, 10)}.txt`
  anchor.click()
  URL.revokeObjectURL(url)
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

async function copyDeviceSpecsInfo() {
  try {
    await writeClipboard(specsReportText.value)
    return true
  } catch (error) {
    console.error('复制设备规格失败:', error)
    return false
  }
}

async function retryDeviceSpecsPage() {
  await refreshDeviceSpecsHardwareData()
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

function stopUptimeTicker() {
  if (uptimeTimerId) {
    window.clearInterval(uptimeTimerId)
    uptimeTimerId = undefined
  }
}

function releaseStore() {
  stopUptimeTicker()
}

defineExpose({
  exportReport,
  copyDeviceSpecsInfo,
})

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

    await loadDeviceSpecsHardwareData()
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
  <div class="device-specs-page">
    <StateBlock
      v-if="loading"
      variant="loading"
      title="正在同步设备规格"
      description="正在读取整机型号、系统信息和核心硬件清单。"
      action-label="重新同步"
      @retry="retryDeviceSpecsPage"
    />

    <div v-else class="device-specs-scroll">
      <div class="device-specs-shell">
        <section class="spec-summary-grid" aria-label="设备摘要">
          <article v-for="item in summaryItems" :key="item.id" class="spec-summary-card">
            <div class="spec-summary-card__head">
              <component :is="item.icon" theme="outline" size="22" fill="currentColor" :strokeWidth="3" :style="{ color: item.accent }" />
              <h2>{{ item.label }}</h2>
            </div>
            <p>{{ item.value }}</p>
          </article>
        </section>

        <section class="spec-detail-panel">
          <div class="spec-detail-panel__head">
            <DataSheet theme="outline" size="22" fill="currentColor" :strokeWidth="3" />
            <h2>详细信息</h2>
          </div>

          <div class="spec-detail-list">
            <div v-for="row in specRows" :key="row.id" class="spec-detail-row">
              <div class="spec-detail-row__label">{{ row.label }}：</div>
              <div class="spec-detail-row__value">
                <div v-for="line in row.lines" :key="line" class="spec-detail-row__line">{{ line }}</div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
.device-specs-page {
  height: 100%;
  min-height: 0;
  color: var(--text-primary);
}

.device-specs-scroll {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.device-specs-shell {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 14px;
  height: 100%;
  min-height: 0;
  min-width: 0;
}

.spec-summary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.spec-summary-card,
.spec-detail-panel {
  border: 1px solid var(--panel-border);
  border-radius: 14px;
  background: var(--card-background);
  box-shadow: 0 16px 32px rgba(4, 8, 15, 0.18);
}

.spec-summary-card {
  min-height: 88px;
  padding: 13px 15px;
}

.spec-summary-card__head,
.spec-detail-panel__head {
  display: flex;
  align-items: center;
  gap: 12px;

  h2 {
    margin: 0;
    color: var(--text-primary);
    font-size: 16px;
    font-weight: 800;
    line-height: 1.25;
  }
}

.spec-summary-card p {
  margin: 15px 0 0;
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 700;
  line-height: 1.38;
  word-break: break-word;
}

.spec-detail-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 16px 18px;
  overflow: hidden;
}

.spec-detail-panel__head {
  color: var(--text-primary);
  margin-bottom: 12px;
}

.spec-detail-list {
  display: grid;
  gap: 6px;
  min-height: 0;
  overflow: auto;
  padding-right: 6px;
  scrollbar-width: thin;
  scrollbar-color: rgba(110, 128, 160, 0.34) transparent;
}

.spec-detail-list::-webkit-scrollbar {
  width: 6px;
}

.spec-detail-list::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(110, 128, 160, 0.34);
}

.spec-detail-list::-webkit-scrollbar-track {
  background: transparent;
}

.spec-detail-row {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  min-height: 24px;
}

.spec-detail-row__label {
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 750;
  line-height: 1.5;
  white-space: nowrap;
}

.spec-detail-row__value {
  min-width: 0;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 650;
  line-height: 1.5;
  word-break: break-word;
}

.spec-detail-row__line + .spec-detail-row__line {
  margin-top: 1px;
}

@media (max-width: 720px) {
  .device-specs-shell {
    grid-template-rows: auto minmax(0, 1fr);
  }

  .spec-summary-grid {
    grid-template-columns: 1fr;
  }

  .spec-summary-card {
    min-height: 76px;
  }

  .spec-detail-panel {
    padding: 16px;
  }

  .spec-detail-row {
    grid-template-columns: 84px minmax(0, 1fr);
  }
}
</style>
