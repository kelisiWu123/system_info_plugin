<script setup lang="ts">
import {
  Chip,
  Computer,
  Cpu,
  GraphicDesign,
  HardDisk,
  Memory,
  NetworkTree,
  Refresh,
} from '@icon-park/vue-next'
import { computed, onUnmounted, ref, watch } from 'vue'
import {
  refreshDeviceSpecsHardwareData,
  useDeviceSpecsHardwareData,
  type DeviceSpecsServiceKey,
} from '../../composables/useDeviceSpecsHardwareData'
import {
  formatBytes,
  formatDisplayResolution,
  getDisplayMemoryCapacityBytes,
  getPhysicalDiskLayout,
} from '../../utils'
import { selectPrimaryGpu } from '../../utils/gpu'
import { downloadTextFile, writeClipboardText } from '../../utils/presentation'

const props = defineProps<{
  active?: boolean
}>()

type SpecAvailability = 'ready' | 'pending' | 'missing' | 'unsupported' | 'error'

interface CoreSpecCard {
  id: string
  label: string
  value: string
  facts: string[]
  icon: unknown
  tone: 'blue' | 'green' | 'purple' | 'yellow' | 'cyan' | 'orange'
  availability: SpecAvailability
  statusLabel: string
}

interface CoreSpecGroup {
  id: string
  label: string
  description: string
  cards: CoreSpecCard[]
}

interface SecondarySpecRow {
  id: string
  label: string
  lines: string[]
  availability: SpecAvailability
}

const {
  loading,
  loaded,
  pendingReads,
  lastSyncedAt,
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
  audioDevices,
  networkAdapters,
  fetchState,
  loadDeviceSpecsHardwareData,
} = useDeviceSpecsHardwareData()

const refreshing = ref(false)
const copyFeedback = ref<'idle' | 'success' | 'error'>('idle')
let copyFeedbackTimerId: number | undefined

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
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

function uniqueLines(lines: string[]) {
  return Array.from(new Set(lines.map(cleanText).filter(Boolean)))
}

function formatCapacity(bytes?: number | null, digits = 0) {
  if (!Number.isFinite(bytes || 0) || !bytes) return ''
  const gb = bytes / (1024 ** 3)
  if (gb >= 1) {
    const value = digits > 0 ? Number(gb.toFixed(digits)) : Math.round(gb)
    return `${value} GB`
  }
  return formatBytes(bytes)
}

function formatDiskCapacity(bytes?: number | null) {
  if (!Number.isFinite(bytes || 0) || !bytes) return ''
  const gb = bytes / 1_000_000_000
  if (gb >= 1000) return `${Number((gb / 1000).toFixed(2))} TB`
  return `${Math.round(gb)} GB`
}

function formatNetworkSpeed(speed?: number | null) {
  if (!speed || speed <= 0) return ''
  if (speed >= 1000) {
    const gbps = speed / 1000
    return `${Number(gbps.toFixed(gbps % 1 === 0 ? 0 : 1))} Gbps`
  }
  return `${Math.round(speed)} Mbps`
}

function formatNetworkType(value: unknown) {
  const type = cleanText(value).toLowerCase()
  if (!type) return ''
  if (type.includes('wireless') || type.includes('wifi') || type.includes('wi-fi')) return 'Wi-Fi'
  if (type.includes('wired') || type.includes('ethernet')) return '以太网'
  return cleanText(value)
}

function formatSyncTime(value?: number) {
  if (!value) return ''
  return new Date(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function resolveAvailability(keys: DeviceSpecsServiceKey[], hasValue: boolean): SpecAvailability {
  if (hasValue) return 'ready'

  const states = keys.map((key) => fetchState[key])
  if (states.some((state) => state.status === 'pending')) return 'pending'

  const failedState = states.find((state) => state.status === 'error')
  if (failedState) {
    const note = failedState.note.toLowerCase()
    if (note.includes('unsupported') || note.includes('not supported') || note.includes('不支持')) {
      return 'unsupported'
    }
    return 'error'
  }

  return 'missing'
}

function availabilityLabel(availability: SpecAvailability) {
  switch (availability) {
    case 'pending': return '读取中…'
    case 'missing': return '系统未提供'
    case 'unsupported': return '当前平台不支持'
    case 'error': return '读取失败'
    default: return ''
  }
}

function withReadingFallback(value: string, keys: DeviceSpecsServiceKey[], hasResolvedValue: boolean) {
  if (value) return value
  return availabilityLabel(resolveAvailability(keys, hasResolvedValue)) || '系统未提供'
}

function unavailableFact(keys: DeviceSpecsServiceKey[]) {
  return availabilityLabel(resolveAvailability(keys, false)) || '系统未提供'
}

const physicalDisks = computed(() => getPhysicalDiskLayout(diskLayoutData.value))
const primaryGpu = computed(() => selectPrimaryGpu(gpuData.value))
const primaryNetworkAdapter = computed(() => {
  return networkAdapters.value.find((item) => item.default)
    || networkAdapters.value.find((item) => item.operstate === 'up' && Boolean(item.ip4))
    || networkAdapters.value.find((item) => Boolean(item.ip4))
    || networkAdapters.value[0]
})

const deviceTitle = computed(() => {
  const friendlyVersion = cleanText(systemData.value?.version)
  if (cleanText(osInfo.value?.platform).toLowerCase() === 'darwin' && friendlyVersion) return friendlyVersion

  return joinParts([
    systemData.value?.manufacturer,
    systemData.value?.model,
  ]) || friendlyVersion || cleanText(osInfo.value?.hostname) || '这台电脑'
})

const systemLine = computed(() => joinParts([
  osInfo.value?.distro || osInfo.value?.platform,
  osInfo.value?.release,
  osInfo.value?.arch,
], ' · '))
const systemHeroLine = computed(() => systemLine.value || withReadingFallback('', ['osInfo'], Boolean(systemLine.value)))

const installedMemoryBytes = computed(() => getDisplayMemoryCapacityBytes(memoLayoutData.value, memoData.value))
const memoryManufacturers = computed(() => uniqueLines(memoLayoutData.value.map((item) => cleanVendorText(item.manufacturer))))
const memoryPartNumbers = computed(() => uniqueLines(memoLayoutData.value.map((item) => cleanText(item.partNum))))
const memoryTypes = computed(() => uniqueLines(memoLayoutData.value.map((item) => cleanText(item.type))))
const memoryMaxClock = computed(() => Math.max(0, ...memoLayoutData.value.map((item) => item.clockSpeed || 0)))
const memoryModuleSizes = computed(() => memoLayoutData.value
  .map((item) => formatCapacity(item.size))
  .filter(Boolean))

const memoryTitle = computed(() => {
  const capacity = formatCapacity(installedMemoryBytes.value || memoData.value.total)
  const manufacturer = memoryManufacturers.value.join(' / ')
  if (manufacturer && capacity) return `${manufacturer} · ${capacity}`
  if (memoData.value.normalizedPlatform === 'darwin' && capacity) return `${capacity} 统一内存`
  return capacity
})

const memoryFacts = computed(() => uniqueLines([
  `厂商 ${memoryManufacturers.value.join(' / ') || unavailableFact(['memoryLayout'])}`,
  memoryPartNumbers.value.join(' / '),
  joinParts([
    memoryTypes.value.join(' / '),
    memoryMaxClock.value ? `${memoryMaxClock.value} MHz` : '',
  ], ' · '),
  memoryModuleSizes.value.length > 1 ? `模块 ${memoryModuleSizes.value.join(' + ')}` : '',
]))

function formatVendorModel(vendor: unknown, model: unknown) {
  const vendorText = cleanVendorText(vendor)
  const modelText = cleanText(model)
  if (!vendorText) return modelText
  if (!modelText) return vendorText
  if (modelText.toLowerCase().startsWith(vendorText.toLowerCase())) return modelText
  return `${vendorText} ${modelText}`
}

const diskTitle = computed(() => {
  const disk = physicalDisks.value[0]
  if (!disk) return ''
  return formatVendorModel(disk.vendor, disk.name) || cleanText(disk.device)
})

const diskFacts = computed(() => {
  const disk = physicalDisks.value[0]
  if (!disk) {
    const volume = diskData.value[0]
    return volume
      ? uniqueLines([formatDiskCapacity(volume.size), joinParts([volume.type, volume.interfaceType], ' · ')])
      : []
  }

  const extraDisk = physicalDisks.value[1]
  const vendor = cleanVendorText(disk.vendor)
  return uniqueLines([
    `厂商 ${vendor || unavailableFact(['diskLayout'])}`,
    joinParts([formatDiskCapacity(disk.size), disk.interfaceType, disk.type], ' · '),
    cleanText(disk.firmwareRevision) ? `固件 ${cleanText(disk.firmwareRevision)}` : '',
    extraDisk ? `另有 ${formatVendorModel(extraDisk.vendor, extraDisk.name) || cleanText(extraDisk.device)} · ${formatDiskCapacity(extraDisk.size)}` : '',
  ])
})

const networkTitle = computed(() => {
  const adapter = primaryNetworkAdapter.value
  if (!adapter) return ''

  const vendor = cleanText(adapter.vendor)
  const model = cleanText(adapter.model) || cleanText(adapter.name) || cleanText(adapter.iface)
  if (vendor && model && !model.toLowerCase().startsWith(vendor.toLowerCase())) {
    return `${vendor} ${model}`
  }
  return model || vendor
})

const networkFacts = computed(() => {
  const adapter = primaryNetworkAdapter.value
  return uniqueLines([
    `厂商 ${cleanVendorText(adapter?.vendor) || unavailableFact(['networkAdapters'])}`,
    cleanText(adapter?.ip4) ? `本机 IPv4 ${cleanText(adapter?.ip4)}` : `本机 IPv4 ${unavailableFact(['networkAdapters'])}`,
    joinParts([
      formatNetworkType(adapter?.type),
      cleanText(adapter?.iface),
      formatNetworkSpeed(adapter?.speed),
    ], ' · '),
    cleanText(adapter?.mac) ? `MAC ${cleanText(adapter?.mac)}` : '',
  ])
})

const boardTitle = computed(() => joinParts([boardData.value?.manufacturer, boardData.value?.model]))
const boardFacts = computed(() => uniqueLines([
  boardData.value ? `厂商 ${cleanVendorText(boardData.value.manufacturer) || unavailableFact(['boardData'])}` : '',
  biosData.value?.version ? `BIOS / 固件 ${biosData.value.version}` : '',
  biosData.value?.vendor && biosData.value.vendor !== boardData.value?.manufacturer ? cleanText(biosData.value.vendor) : '',
]))

const cpuAvailability = computed(() => resolveAvailability(['cpuInfo'], Boolean(cpuData.value)))
const gpuAvailability = computed(() => resolveAvailability(['gpuInfo'], gpuData.value.length > 0))
const memoryAvailability = computed(() => resolveAvailability(
  ['memoryLayout', 'memInfo'],
  memoLayoutData.value.length > 0 || memoData.value.total > 0
))
const storageAvailability = computed(() => resolveAvailability(
  ['diskLayout', 'diskData'],
  physicalDisks.value.length > 0 || diskData.value.length > 0
))
const networkAvailability = computed(() => resolveAvailability(['networkAdapters'], Boolean(primaryNetworkAdapter.value)))
const boardAvailability = computed(() => resolveAvailability(['boardData'], Boolean(boardData.value)))

const coreSpecCards = computed<CoreSpecCard[]>(() => [
  {
    id: 'cpu',
    label: '处理器',
    value: withReadingFallback(cleanText(cpuData.value?.brand), ['cpuInfo'], Boolean(cpuData.value)),
    facts: uniqueLines([
      joinParts([
        cpuData.value?.physicalCores ? `${cpuData.value.physicalCores} 核` : '',
        cpuData.value?.cores ? `${cpuData.value.cores} 线程` : '',
      ], ' · '),
      cpuData.value?.speed ? `${cpuData.value.speed} GHz` : '',
    ]),
    icon: Cpu,
    tone: 'blue',
    availability: cpuAvailability.value,
    statusLabel: availabilityLabel(cpuAvailability.value),
  },
  {
    id: 'gpu',
    label: '显卡',
    value: withReadingFallback(
      cleanText(primaryGpu.value?.model) || cleanText(primaryGpu.value?.name),
      ['gpuInfo'],
      gpuData.value.length > 0
    ),
    facts: uniqueLines([
      `厂商 ${cleanVendorText(primaryGpu.value?.vendor) || unavailableFact(['gpuInfo'])}`,
      primaryGpu.value?.memoryTotal || primaryGpu.value?.vram
        ? `显存 / 共享内存 ${formatCapacity((primaryGpu.value?.memoryTotal || primaryGpu.value?.vram || 0) * 1024 * 1024)}`
        : '',
    ]),
    icon: GraphicDesign,
    tone: 'green',
    availability: gpuAvailability.value,
    statusLabel: availabilityLabel(gpuAvailability.value),
  },
  {
    id: 'memory',
    label: '内存',
    value: withReadingFallback(
      memoryTitle.value,
      ['memoryLayout', 'memInfo'],
      memoLayoutData.value.length > 0 || memoData.value.total > 0
    ),
    facts: memoryFacts.value,
    icon: Memory,
    tone: 'purple',
    availability: memoryAvailability.value,
    statusLabel: availabilityLabel(memoryAvailability.value),
  },
  {
    id: 'storage',
    label: '硬盘',
    value: withReadingFallback(
      diskTitle.value,
      ['diskLayout', 'diskData'],
      physicalDisks.value.length > 0 || diskData.value.length > 0
    ),
    facts: diskFacts.value,
    icon: HardDisk,
    tone: 'yellow',
    availability: storageAvailability.value,
    statusLabel: availabilityLabel(storageAvailability.value),
  },
  {
    id: 'network',
    label: '网卡 / 本机 IP',
    value: withReadingFallback(networkTitle.value, ['networkAdapters'], Boolean(primaryNetworkAdapter.value)),
    facts: networkFacts.value,
    icon: NetworkTree,
    tone: 'cyan',
    availability: networkAvailability.value,
    statusLabel: availabilityLabel(networkAvailability.value),
  },
  {
    id: 'board',
    label: '主板 / 平台',
    value: withReadingFallback(boardTitle.value, ['boardData'], Boolean(boardData.value)),
    facts: boardFacts.value,
    icon: Chip,
    tone: 'orange',
    availability: boardAvailability.value,
    statusLabel: availabilityLabel(boardAvailability.value),
  },
])

const coreSpecGroups = computed<CoreSpecGroup[]>(() => [
  {
    id: 'compute',
    label: '核心计算',
    description: '处理器、显卡与内存',
    cards: coreSpecCards.value.filter((card) => ['cpu', 'gpu', 'memory'].includes(card.id)),
  },
  {
    id: 'devices',
    label: '设备与连接',
    description: '硬盘、活动网卡与主板平台',
    cards: coreSpecCards.value.filter((card) => ['storage', 'network', 'board'].includes(card.id)),
  },
])

const identifiedCoreCount = computed(() => coreSpecCards.value.filter((card) => card.availability === 'ready').length)

function formatDisplayLine(item: DisplayData) {
  const name = cleanText(item.model) || cleanText(item.deviceName) || cleanText(item.vendor)
  const resolution = formatDisplayResolution(item)
  return joinParts([name, resolution === '--' ? '' : resolution], ' · ')
}

function formatAudioLine(item: AudioDeviceData) {
  return joinParts([item.manufacturer, item.name]) || cleanText(item.name)
}

const secondaryRows = computed<SecondarySpecRow[]>(() => {
  const rows = [
    {
      id: 'system',
      label: '系统',
      lines: uniqueLines([systemLine.value]),
      keys: ['osInfo'] as DeviceSpecsServiceKey[],
    },
    {
      id: 'display',
      label: '显示器',
      lines: uniqueLines(displaysData.value.slice(0, 3).map(formatDisplayLine)),
      keys: ['displaysData'] as DeviceSpecsServiceKey[],
    },
    {
      id: 'audio',
      label: '音频',
      lines: uniqueLines(audioDevices.value.slice(0, 3).map(formatAudioLine)),
      keys: ['audioDevices'] as DeviceSpecsServiceKey[],
    },
  ]

  return rows.map((row) => {
    const availability = resolveAvailability(row.keys, row.lines.length > 0)
    return {
      id: row.id,
      label: row.label,
      availability,
      lines: row.lines.length ? row.lines : [availabilityLabel(availability) || '系统未提供'],
    }
  })
})

const specsReportText = computed(() => {
  return [
    '设备规格',
    `导出时间：${new Date().toLocaleString('zh-CN')}`,
    `设备：${deviceTitle.value}`,
    systemLine.value ? `系统：${systemLine.value}` : '',
    '',
    ...coreSpecCards.value.map((card) => `${card.label}：${card.value}${card.facts.length ? `；${card.facts.join('；')}` : ''}`),
    '',
    ...secondaryRows.value.map((row) => `${row.label}：${row.lines.join('；')}`),
  ].filter((line) => line !== '').join('\n')
})

function exportReport() {
  downloadTextFile(
    `device-specs-${new Date().toISOString().slice(0, 10)}.txt`,
    specsReportText.value
  )
}

function resetCopyFeedbackLater() {
  if (copyFeedbackTimerId) window.clearTimeout(copyFeedbackTimerId)
  copyFeedbackTimerId = window.setTimeout(() => {
    copyFeedback.value = 'idle'
    copyFeedbackTimerId = undefined
  }, 1600)
}

async function copyDeviceSpecsInfo() {
  try {
    await writeClipboardText(specsReportText.value)
    copyFeedback.value = 'success'
    resetCopyFeedbackLater()
    return true
  } catch (error) {
    console.error('复制设备规格失败:', error)
    copyFeedback.value = 'error'
    resetCopyFeedbackLater()
    return false
  }
}

async function refreshSpecs() {
  if (refreshing.value) return
  refreshing.value = true
  try {
    await refreshDeviceSpecsHardwareData()
  } finally {
    refreshing.value = false
  }
}

defineExpose({
  exportReport,
  copyDeviceSpecsInfo,
})

watch(
  () => props.active,
  async (active) => {
    if (active === false) return
    await loadDeviceSpecsHardwareData()
  },
  { immediate: true }
)

onUnmounted(() => {
  if (copyFeedbackTimerId) window.clearTimeout(copyFeedbackTimerId)
})
</script>

<template>
  <div class="device-specs-page">
    <div class="device-specs-scroll">
      <div class="device-specs-shell">
        <header class="spec-hero">
          <div class="spec-hero__identity">
            <div class="spec-hero__icon">
              <Computer theme="outline" size="26" fill="currentColor" :strokeWidth="3" />
            </div>
            <div>
              <div class="spec-hero__eyebrow">设备规格</div>
              <h1>{{ deviceTitle }}</h1>
              <p>{{ systemHeroLine }}</p>
            </div>
          </div>

          <div class="spec-hero__actions">
            <div v-if="loading" class="spec-loading-status" role="status" aria-live="polite">
              <span class="spec-loading-status__pulse" aria-hidden="true" />
              核心项 {{ identifiedCoreCount }}/6 · 正在补齐 {{ pendingReads }} 项
            </div>
            <div v-else-if="loaded && lastSyncedAt" class="spec-loaded-status">
              核心项 {{ identifiedCoreCount }}/6 · 已更新 {{ formatSyncTime(lastSyncedAt) }}
            </div>

            <button type="button" class="spec-action" @click="copyDeviceSpecsInfo">
              {{ copyFeedback === 'success' ? '已复制' : copyFeedback === 'error' ? '复制失败' : '复制配置' }}
            </button>
            <button type="button" class="spec-action" @click="exportReport">导出</button>
            <button type="button" class="spec-action spec-action--icon" :disabled="refreshing" title="重新读取设备规格" @click="refreshSpecs">
              <Refresh theme="outline" size="17" fill="currentColor" :strokeWidth="3" />
            </button>
          </div>
        </header>

        <section class="core-spec-sections" aria-label="核心硬件规格">
          <div v-for="group in coreSpecGroups" :key="group.id" class="core-spec-group">
            <div class="core-spec-group__head">
              <strong>{{ group.label }}</strong>
              <span>{{ group.description }}</span>
            </div>

            <div class="core-spec-grid">
              <article
                v-for="card in group.cards"
                :key="card.id"
                :class="[
                  'core-spec-card',
                  `core-spec-card--${card.tone}`,
                  `core-spec-card--${card.availability}`,
                ]"
              >
                <div class="core-spec-card__head">
                  <div class="core-spec-card__identity">
                    <div class="core-spec-card__icon">
                      <component :is="card.icon" theme="outline" size="20" fill="currentColor" :strokeWidth="3" />
                    </div>
                    <span>{{ card.label }}</span>
                  </div>
                  <span
                    v-if="card.availability !== 'ready'"
                    :class="['core-spec-card__status', `core-spec-card__status--${card.availability}`]"
                  >
                    {{ card.statusLabel }}
                  </span>
                </div>
                <h2>{{ card.value }}</h2>
                <div class="core-spec-card__facts">
                  <span v-for="fact in card.facts" :key="fact">{{ fact }}</span>
                  <span v-if="!card.facts.length" class="core-spec-card__fact-muted">
                    {{ card.availability === 'ready' ? '暂无更多规格' : card.statusLabel }}
                  </span>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section class="secondary-spec-panel">
          <div class="secondary-spec-panel__head">
            <div>
              <span>其他关键信息</span>
              <h2>显示与系统</h2>
            </div>
            <span>核心硬件优先，次要信息保持低视觉权重</span>
          </div>

          <div class="secondary-spec-grid">
            <div
              v-for="row in secondaryRows"
              :key="row.id"
              :class="['secondary-spec-row', `secondary-spec-row--${row.availability}`]"
            >
              <span class="secondary-spec-row__label">{{ row.label }}</span>
              <div>
                <p v-for="line in row.lines" :key="line">{{ line }}</p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
.device-specs-page,
.device-specs-scroll {
  height: 100%;
  min-height: 0;
}

.device-specs-page {
  color: var(--text-primary);
}

.device-specs-scroll {
  overflow: auto;
}

.device-specs-shell {
  display: flex;
  flex-direction: column;
  gap: 13px;
  min-width: 0;
  padding-bottom: 2px;
}

.spec-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  min-height: 84px;
  padding: 8px 4px 11px;
  border-bottom: 1px solid var(--panel-border-soft);
}

.spec-hero__identity {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 14px;
}

.spec-hero__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  flex: 0 0 auto;
  border-radius: 14px;
  background: var(--state-info-bg);
  color: var(--state-info-fg);
  box-shadow: inset 0 0 0 1px var(--control-active-border);
}

.spec-hero__eyebrow {
  color: var(--accent-cyan);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.spec-hero h1 {
  margin: 4px 0 0;
  overflow: hidden;
  color: var(--text-primary);
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.025em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.spec-hero p {
  margin: 5px 0 0;
  color: var(--text-subtle);
  font-size: 12px;
}

.spec-hero__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 7px;
  flex-wrap: wrap;
}

.spec-loading-status,
.spec-loaded-status {
  color: var(--text-subtle);
  font-size: 11px;
  font-weight: 700;
}

.spec-loading-status {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

.spec-loading-status__pulse {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent-blue);
  box-shadow: 0 0 0 4px var(--state-info-bg);
}

.spec-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  padding: 0 11px;
  border: 1px solid var(--control-border);
  border-radius: var(--control-radius);
  background: var(--control-bg);
  color: var(--control-fg);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.spec-action:hover {
  border-color: var(--control-border-strong);
  color: var(--control-fg-strong);
}

.spec-action--icon {
  width: 34px;
  padding: 0;
}

.core-spec-sections {
  display: flex;
  flex-direction: column;
  gap: 13px;
}

.core-spec-group {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.core-spec-group__head {
  display: flex;
  align-items: baseline;
  gap: 9px;
  padding: 0 3px;

  strong {
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 800;
  }

  span {
    color: var(--text-subtle);
    font-size: 10px;
    font-weight: 600;
  }
}

.core-spec-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 11px;
}

.core-spec-card,
.secondary-spec-panel {
  border: 1px solid var(--panel-border);
  border-radius: var(--surface-radius);
  background: var(--card-background);
  box-shadow: var(--panel-shadow);
}

.core-spec-card {
  position: relative;
  min-height: 138px;
  padding: 14px 15px;
  overflow: hidden;
  transition: border-color 0.16s ease, background 0.16s ease;
}

.core-spec-card--error {
  border-color: rgba(255, 126, 107, 0.32);
}

.core-spec-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 800;
}

.core-spec-card__identity {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 8px;
}

.core-spec-card__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 31px;
  height: 31px;
  border-radius: 10px;
  background: var(--state-info-bg);
  color: var(--state-info-fg);
}

.core-spec-card--green .core-spec-card__icon { background: var(--state-good-bg); color: var(--state-good-fg); }
.core-spec-card--purple .core-spec-card__icon { background: color-mix(in srgb, var(--accent-purple) 14%, transparent); color: var(--accent-purple); }
.core-spec-card--yellow .core-spec-card__icon { background: var(--state-warn-bg); color: var(--state-warn-fg); }
.core-spec-card--cyan .core-spec-card__icon { background: color-mix(in srgb, var(--accent-cyan) 14%, transparent); color: var(--accent-cyan); }
.core-spec-card--orange .core-spec-card__icon { background: color-mix(in srgb, var(--accent-orange) 14%, transparent); color: var(--accent-orange); }

.core-spec-card__status {
  flex: 0 0 auto;
  padding: 3px 6px;
  border-radius: 999px;
  background: var(--surface-soft-background);
  color: var(--text-subtle);
  font-size: 9px;
  font-weight: 700;
}

.core-spec-card__status--pending {
  color: var(--accent-cyan);
}

.core-spec-card__status--unsupported {
  background: var(--state-warn-bg);
  color: var(--state-warn-fg);
}

.core-spec-card__status--error {
  background: var(--state-danger-bg);
  color: var(--accent-danger);
}

.core-spec-card h2 {
  display: -webkit-box;
  min-height: 42px;
  margin: 12px 0 0;
  overflow: hidden;
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 800;
  line-height: 1.38;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.core-spec-card__facts {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 8px;
}

.core-spec-card__facts span {
  overflow: hidden;
  color: var(--text-subtle);
  font-size: 11px;
  line-height: 1.45;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.core-spec-card__facts .core-spec-card__fact-muted {
  color: var(--text-subtle);
  opacity: 0.72;
}

.secondary-spec-panel {
  padding: 14px 16px;
}

.secondary-spec-panel__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 10px;
}

.secondary-spec-panel__head > div > span,
.secondary-spec-panel__head > span {
  color: var(--text-subtle);
  font-size: 10px;
  font-weight: 700;
}

.secondary-spec-panel__head h2 {
  margin: 3px 0 0;
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 800;
}

.secondary-spec-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0 18px;
}

.secondary-spec-row {
  display: grid;
  grid-template-columns: 54px minmax(0, 1fr);
  gap: 9px;
  min-width: 0;
  padding-top: 10px;
  border-top: 1px solid var(--panel-border-soft);
}

.secondary-spec-row__label {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 800;
}

.secondary-spec-row p {
  margin: 0 0 3px;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.5;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.secondary-spec-row--pending p,
.secondary-spec-row--missing p {
  color: var(--text-subtle);
}

.secondary-spec-row--unsupported p {
  color: var(--state-warn-fg);
}

.secondary-spec-row--error p {
  color: var(--accent-danger);
}

@media (max-width: 900px) {
  .core-spec-grid,
  .secondary-spec-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .spec-hero {
    align-items: flex-start;
    flex-direction: column;
  }

  .spec-hero__actions {
    justify-content: flex-start;
  }
}
</style>
