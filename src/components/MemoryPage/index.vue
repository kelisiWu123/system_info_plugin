<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { activateHardwareStore, deactivateHardwareStore, hardwareStore } from '../../composables/useHardwareData'
import { bytesToGB, clampPercent } from '../../utils'

const props = defineProps<{
  active?: boolean
}>()

interface SummaryStat {
  label: string
  value: string
  accent?: string
  barPercent?: number
}

interface SlotRow {
  slot: string
  size: string
  typeSpeed: string
  manufacturerModel: string
  status: string
  installed: boolean
}

const {
  loading,
  lastSyncedAt,
  memoData,
  memoLayoutData,
  boardData,
  osInfo,
  metricHistory,
} = hardwareStore

const subscribed = ref(false)

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

function formatSyncTime(value?: number) {
  if (!value) return '--:--:--'
  return new Date(value).toLocaleString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function formatVoltage(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? `${value.toFixed(2)} V` : '--'
}

function formatFrequency(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? `${Math.round(value)} MHz` : '--'
}

function formatUsage(value: number) {
  return `${Math.round(value)}%`
}

function bytesToGBNumber(value: number) {
  return value > 0 ? Math.round((value / (1024 ** 3)) * 10) / 10 : 0
}

function sparklinePoints(values: number[]) {
  const source = values.length ? values : [0, 0, 0, 0, 0, 0]
  const min = Math.min(...source)
  const max = Math.max(...source)
  const range = Math.max(1, max - min)
  const step = source.length > 1 ? 220 / (source.length - 1) : 220

  return source
    .map((value, index) => {
      const x = Number((index * step).toFixed(2))
      const y = Number((88 - ((value - min) / range) * 58).toFixed(2))
      return `${x},${y}`
    })
    .join(' ')
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

function normalizeKitPart(partNum?: string) {
  return cleanText(partNum).replace(/\s+/g, '') || '--'
}

function channelKey(bank: string, index: number) {
  const normalized = cleanText(bank).toUpperCase()
  const channelMatch = normalized.match(/CHANNEL\s+([A-D])/)
  if (channelMatch?.[1]) return channelMatch[1]
  const dimmMatch = normalized.match(/DIMM[_-]?([A-D])/)
  if (dimmMatch?.[1]) return dimmMatch[1]
  return index % 2 === 0 ? 'A' : 'B'
}

const memoryModules = computed(() => memoLayoutData.value.filter((item) => item.size > 0))
const installedMemoryBytes = computed(() => memoryModules.value.reduce((sum, item) => sum + (item.size || 0), 0))
const installedMemoryGB = computed(() => bytesToGBNumber(installedMemoryBytes.value))
const systemMemoryGB = computed(() => bytesToGBNumber(memoData.value.total || 0))
const usedMemoryGB = computed(() => bytesToGBNumber(memoData.value.active || 0))
const freeMemoryGB = computed(() => bytesToGBNumber(memoData.value.available || 0))
const usagePercent = computed(() => (memoData.value.total ? clampPercent((memoData.value.active / memoData.value.total) * 100) : 0))
const moduleCount = computed(() => memoryModules.value.length)
const slotCount = computed(() => Math.max(boardData.value?.memSlots || 0, memoLayoutData.value.length))
const memoryType = computed(() => cleanText(memoryModules.value[0]?.type) || cleanText(memoLayoutData.value[0]?.type) || '--')
const memoryManufacturer = computed(() => cleanText(memoryModules.value[0]?.manufacturer) || '--')
const memorySeries = computed(() => normalizeKitPart(memoryModules.value[0]?.partNum))
const memoryConfiguredVoltage = computed(() => safeNumber(memoryModules.value[0]?.voltageConfigured))
const memoryClock = computed(() => Math.max(0, ...memoLayoutData.value.map((item) => item.clockSpeed || 0)))
const memoryActualClock = computed(() => (memoryClock.value > 0 ? Math.round(memoryClock.value / 2) : 0))
const eccState = computed(() => {
  const value = memoryModules.value[0]?.ecc
  if (value === true) return '支持'
  if (value === false) return '不支持'
  return '--'
})
const formFactor = computed(() => cleanText(memoryModules.value[0]?.formFactor) || '--')
const kitSummary = computed(() => {
  if (!moduleCount.value) return '未识别到可用内存模组'
  const sizes = memoryModules.value.map((item) => `${bytesToGB(item.size)} GB`)
  return `${installedMemoryGB.value} GB (${sizes.join(' + ')}) ${memoryType.value}`
})

const statusStats = computed<SummaryStat[]>(() => [
  { label: '使用率', value: formatUsage(usagePercent.value), accent: 'var(--accent-blue)' },
  { label: '已用内存', value: `${usedMemoryGB.value} GB`, accent: 'var(--accent-purple)', barPercent: usagePercent.value },
  { label: '可用内存', value: `${freeMemoryGB.value} GB`, accent: 'var(--accent-blue)', barPercent: clampPercent((freeMemoryGB.value / Math.max(systemMemoryGB.value, 1)) * 100) },
  { label: '当前频率', value: formatFrequency(memoryClock.value), accent: '#5eb4ff' },
  { label: '模组数量', value: `${moduleCount.value} / ${slotCount.value || moduleCount.value}`, accent: 'var(--accent-green)' },
  { label: '系统总量', value: `${systemMemoryGB.value} GB`, accent: 'var(--accent-purple)' },
])

const timingRows = computed(() => [
  { label: '频率', value: formatFrequency(memoryClock.value) },
  { label: '实际频率', value: memoryActualClock.value ? `${memoryActualClock.value} MHz` : '--' },
  { label: '配置电压', value: formatVoltage(memoryConfiguredVoltage.value) },
  { label: '最小电压', value: formatVoltage(memoryModules.value[0]?.voltageMin) },
  { label: '最大电压', value: formatVoltage(memoryModules.value[0]?.voltageMax) },
  { label: 'ECC', value: eccState.value },
  { label: '封装', value: formFactor.value },
  { label: '模组数', value: `${moduleCount.value}` },
  { label: '插槽数', value: `${slotCount.value || moduleCount.value}` },
  { label: '制造商', value: memoryManufacturer.value },
  { label: '型号', value: memorySeries.value },
  { label: '系统总量', value: `${systemMemoryGB.value} GB` },
  { label: '操作系统', value: joinParts([osInfo.value?.distro || osInfo.value?.platform, osInfo.value?.release], ' / ') || '--' },
])

const slotRows = computed<SlotRow[]>(() => {
  const total = slotCount.value || memoLayoutData.value.length
  return Array.from({ length: total }, (_, index) => {
    const item = memoLayoutData.value[index]
    const slot = cleanText(item?.bank) || `DIMM_${String.fromCharCode(65 + Math.floor(index / 2))}${(index % 2) + 1}`
    const installed = Boolean(item?.size)
    return {
      slot,
      size: installed && item ? `${bytesToGB(item.size)} GB` : '-',
      typeSpeed: installed && item ? joinParts([item.type, item.clockSpeed ? `${item.clockSpeed} MHz` : ''], ' / ') || '--' : '-',
      manufacturerModel: installed && item ? joinParts([item.manufacturer, normalizeKitPart(item.partNum)], ' / ') || '--' : '-',
      status: installed ? '已启用' : '空闲',
      installed,
    }
  })
})

const memoryChannels = computed(() => {
  const groups = new Map<string, SlotRow[]>()
  slotRows.value.forEach((row, index) => {
    const key = channelKey(row.slot, index)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)?.push(row)
  })

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, rows]) => ({
      key,
      label: `Channel ${key}`,
      rows,
    }))
})

const channelSummary = computed(() => {
  const count = memoryChannels.value.length
  if (count >= 4) return '四通道'
  if (count === 3) return '三通道'
  if (count === 2) return '双通道'
  if (count === 1) return '单通道'
  return '未识别通道信息'
})

const detailRows = computed(() => [
  { label: '内存类型', value: memoryType.value },
  { label: '内存频率', value: memoryClock.value ? `${memoryActualClock.value} MHz (实际) / ${memoryClock.value} MHz (等效)` : '--' },
  { label: '内存电压', value: formatVoltage(memoryConfiguredVoltage.value) },
  { label: 'XMP / EXPO', value: memoryClock.value > 4800 ? '已启用高频配置' : '标准配置' },
  { label: '位宽', value: '64-bit' },
  { label: 'ECC', value: eccState.value },
  { label: 'Registered', value: formFactor.value.includes('DIMM') ? '否' : '--' },
  { label: '内存颗粒', value: memoryManufacturer.value },
  { label: 'SPD 型号', value: memorySeries.value },
  { label: '插槽占用', value: `${moduleCount.value} / ${slotCount.value || moduleCount.value}` },
  { label: '制造信息', value: cleanText(memoryModules.value[0]?.serialNum) || '--' },
  { label: '已安装容量', value: installedMemoryGB.value ? `${installedMemoryGB.value} GB` : '--' },
  { label: '系统可用总量', value: systemMemoryGB.value ? `${systemMemoryGB.value} GB` : '--' },
])

const memoryReportText = computed(() => {
  const lines = [
    '内存页面报告',
    `导出时间：${new Date().toLocaleString('zh-CN')}`,
    '',
    `套装：${kitSummary.value}`,
    `制造商：${memoryManufacturer.value}`,
    `型号：${memorySeries.value}`,
    `频率：${formatFrequency(memoryClock.value)}`,
    `电压：${formatVoltage(memoryConfiguredVoltage.value)}`,
    `已安装容量：${installedMemoryGB.value} GB`,
    `系统可用总量：${systemMemoryGB.value} GB`,
    `占用：${usedMemoryGB.value} GB / ${systemMemoryGB.value} GB (${formatUsage(usagePercent.value)})`,
    '',
    ...slotRows.value.map((row) => `${row.slot}：${row.size} / ${row.typeSpeed} / ${row.status}`),
    '',
    ...detailRows.value.map((row) => `${row.label}：${row.value}`),
  ]

  return lines.join('\n')
})

function exportReport() {
  const blob = new Blob([memoryReportText.value], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `memory-report-${new Date().toISOString().slice(0, 10)}.txt`
  anchor.click()
  URL.revokeObjectURL(url)
}

async function copyMemoryInfo() {
  try {
    await writeClipboard(memoryReportText.value)
    return true
  } catch (error) {
    console.error('复制内存信息失败:', error)
    return false
  }
}

defineExpose({
  exportReport,
  copyMemoryInfo,
})

async function ensureStoreActive() {
  if (subscribed.value) return
  subscribed.value = true
  await activateHardwareStore()
}

function releaseStore() {
  if (!subscribed.value) return
  deactivateHardwareStore()
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
  <div class="memory-page">
    <div v-if="loading" class="memory-empty">正在同步内存数据...</div>

    <template v-else>
      <section class="memory-hero">
        <article class="hero-card">
          <div class="hero-card__head">
            <div class="ram-badge">
              <div class="ram-badge__board">
                <span class="ram-badge__pins"></span>
              </div>
            </div>

            <div class="hero-card__title">
              <h2>{{ kitSummary }}</h2>
              <p>{{ joinParts([memoryManufacturer, memorySeries], ' / ') || '等待内存识别' }}</p>
            </div>
          </div>

          <div class="hero-specs">
            <div class="hero-spec">
              <span>类型</span>
              <strong>{{ memoryType }}</strong>
            </div>
            <div class="hero-spec">
              <span>制造商</span>
              <strong>{{ memoryManufacturer }}</strong>
            </div>
            <div class="hero-spec">
              <span>已安装容量</span>
              <strong>{{ installedMemoryGB ? `${installedMemoryGB} GB` : '--' }}</strong>
            </div>
            <div class="hero-spec">
              <span>当前频率</span>
              <strong>{{ formatFrequency(memoryClock) }}</strong>
            </div>
            <div class="hero-spec">
              <span>已装模组</span>
              <strong>{{ moduleCount }} / {{ slotCount || moduleCount }}</strong>
            </div>
            <div class="hero-spec">
              <span>配置电压</span>
              <strong>{{ formatVoltage(memoryConfiguredVoltage) }}</strong>
            </div>
          </div>
        </article>

        <article class="status-card">
          <div class="status-card__title">
            <h3>内存状态</h3>
            <p>更新时间：{{ formatSyncTime(lastSyncedAt) }}</p>
          </div>

          <div class="status-grid">
            <div v-for="item in statusStats" :key="item.label" class="status-metric">
              <span>{{ item.label }}</span>
              <strong :style="{ color: item.accent || 'inherit' }">{{ item.value }}</strong>
              <div v-if="typeof item.barPercent === 'number'" class="status-metric__bar">
                <i :style="{ width: `${item.barPercent}%`, background: item.accent || 'var(--accent-blue)' }"></i>
              </div>
            </div>
          </div>
        </article>
      </section>

      <section class="memory-grid">
        <article class="memory-panel">
          <div class="memory-panel__title">
            <h3>内存配置</h3>
            <p>当前可识别的 SPD / 模组配置项</p>
          </div>

          <div class="timing-grid">
            <div v-for="item in timingRows" :key="item.label" class="timing-item">
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
            </div>
          </div>
        </article>

        <article class="memory-panel">
          <div class="memory-panel__title">
            <h3>内存槽位</h3>
            <p>{{ moduleCount }} / {{ slotCount || moduleCount }} 已启用</p>
          </div>

          <div class="slot-table">
            <div class="slot-table__head">
              <span>插槽</span>
              <span>容量</span>
              <span>类型 / 频率</span>
              <span>制造商 / 型号</span>
              <span>状态</span>
            </div>

            <div v-for="row in slotRows" :key="row.slot" class="slot-table__row">
              <span>{{ row.slot }}</span>
              <strong>{{ row.size }}</strong>
              <strong>{{ row.typeSpeed }}</strong>
              <strong>{{ row.manufacturerModel }}</strong>
              <em :class="['slot-state', { 'slot-state--active': row.installed }]">{{ row.status }}</em>
            </div>
          </div>
        </article>

        <article class="memory-panel">
          <div class="memory-panel__title">
            <h3>内存使用率</h3>
            <p>共享轮询历史，切页不会重置</p>
          </div>

          <div class="usage-panel">
            <div class="usage-chart">
              <div class="usage-chart__labels">
                <span>100%</span>
                <span>75%</span>
                <span>50%</span>
                <span>25%</span>
                <span>0%</span>
              </div>
              <svg class="usage-chart__svg" viewBox="0 0 220 96" preserveAspectRatio="none" aria-hidden="true">
                <polyline :points="sparklinePoints(metricHistory.memoryLoad)" fill="none" stroke="#42a3ff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              <div class="usage-chart__axis">
                <span>96秒前</span>
                <span>64秒前</span>
                <span>32秒前</span>
                <span>现在</span>
              </div>
            </div>

            <div class="usage-summary">
              <div class="usage-summary__row">
                <span>使用率</span>
                <strong>{{ formatUsage(usagePercent) }}</strong>
              </div>
              <div class="usage-summary__row">
                <span>已用内存</span>
                <strong>{{ usedMemoryGB }} GB</strong>
              </div>
              <div class="usage-summary__row">
                <span>可用内存</span>
                <strong>{{ freeMemoryGB }} GB</strong>
              </div>
              <div class="usage-summary__row">
                <span>系统总量</span>
                <strong>{{ systemMemoryGB }} GB</strong>
              </div>
            </div>
          </div>
        </article>

        <article class="memory-panel">
          <div class="memory-panel__title">
            <h3>内存通道</h3>
            <p>{{ channelSummary }}</p>
          </div>

          <div class="channel-grid">
            <div v-for="channel in memoryChannels" :key="channel.key" class="channel-card">
              <div class="channel-card__label">{{ channel.label }}</div>
              <div class="channel-slot-list">
                <div v-for="row in channel.rows" :key="`${channel.key}-${row.slot}`" :class="['channel-slot', { 'channel-slot--active': row.installed }]">
                  <span>{{ row.slot }}</span>
                  <strong>{{ row.size }}</strong>
                </div>
              </div>
            </div>
          </div>
        </article>
      </section>

      <section class="memory-detail">
        <div class="memory-panel__title">
          <h3>内存详细信息</h3>
          <p>基于当前模组、主板槽位与系统内存状态整理</p>
        </div>

        <div class="detail-grid">
          <div v-for="row in detailRows" :key="row.label" class="detail-row">
            <span>{{ row.label }}</span>
            <strong>{{ row.value }}</strong>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped lang="less">
.memory-page {
  height: 100%;
  min-height: 0;
  overflow: auto;
}

.memory-empty {
  display: grid;
  place-items: center;
  min-height: 320px;
  color: var(--text-muted);
  font-size: 15px;
}

.memory-hero,
.memory-grid {
  display: grid;
  gap: 12px;
  margin-bottom: 12px;
}

.memory-hero {
  grid-template-columns: 1fr 0.95fr;
}

.memory-grid {
  grid-template-columns: 1fr 1fr;
}

.hero-card,
.status-card,
.memory-panel,
.memory-detail {
  border: 1px solid rgba(84, 104, 132, 0.2);
  border-radius: 18px;
  background:
    linear-gradient(180deg, rgba(26, 36, 50, 0.96), rgba(19, 28, 41, 0.94)),
    radial-gradient(circle at top right, rgba(74, 126, 255, 0.12), transparent 34%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.03),
    0 18px 34px rgba(5, 10, 18, 0.16);
}

.hero-card,
.status-card,
.memory-panel,
.memory-detail {
  padding: 16px 18px 18px;
}

.hero-card__head {
  display: grid;
  grid-template-columns: 134px minmax(0, 1fr);
  gap: 18px;
  align-items: center;
}

.ram-badge {
  display: grid;
  place-items: center;
}

.ram-badge__board {
  position: relative;
  width: 112px;
  height: 74px;
  border-radius: 14px;
  background:
    linear-gradient(155deg, rgba(246, 248, 252, 0.92), rgba(210, 221, 238, 0.74)),
    linear-gradient(180deg, rgba(18, 25, 36, 0.18), rgba(18, 25, 36, 0));
  border: 1px solid rgba(225, 232, 244, 0.28);
  transform: rotate(-18deg);
  box-shadow:
    0 16px 22px rgba(3, 8, 14, 0.28),
    inset 0 -10px 16px rgba(14, 22, 34, 0.08);
}

.ram-badge__board::before,
.ram-badge__board::after {
  content: '';
  position: absolute;
  top: 12px;
  bottom: 12px;
  width: 20px;
  border-radius: 8px;
  background: rgba(22, 34, 48, 0.12);
}

.ram-badge__board::before {
  left: 14px;
}

.ram-badge__board::after {
  right: 14px;
}

.ram-badge__pins {
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: -5px;
  height: 6px;
  border-radius: 999px;
  background:
    repeating-linear-gradient(90deg, rgba(246, 190, 90, 0.95) 0 6px, rgba(138, 102, 26, 0.2) 6px 9px);
}

.hero-card__title {
  h2 {
    margin: 0;
    color: #f3f7fd;
    font-size: 20px;
    font-weight: 700;
    line-height: 1.25;
  }

  p {
    margin: 8px 0 0;
    color: var(--text-muted);
    font-size: 14px;
  }
}

.hero-specs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0 14px;
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid rgba(86, 101, 126, 0.18);
}

.hero-spec {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 0 10px;

  span {
    color: var(--text-subtle);
    font-size: 13px;
  }

  strong {
    color: #f5f8fd;
    font-size: 15px;
    font-weight: 700;
  }
}

.status-card__title,
.memory-panel__title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;

  h3 {
    margin: 0;
    color: #f4f7fd;
    font-size: 16px;
    font-weight: 700;
  }

  p {
    margin: 6px 0 0;
    color: var(--text-subtle);
    font-size: 13px;
  }
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.status-metric {
  padding: 12px 12px 10px;
  border: 1px solid rgba(86, 101, 126, 0.14);
  border-radius: 14px;
  background: rgba(16, 25, 36, 0.58);

  span {
    display: block;
    color: var(--text-subtle);
    font-size: 12px;
  }

  strong {
    display: block;
    margin-top: 8px;
    color: #f6f9ff;
    font-size: 16px;
    font-weight: 700;
  }
}

.status-metric__bar {
  height: 3px;
  margin-top: 12px;
  border-radius: 999px;
  background: rgba(91, 110, 136, 0.24);
  overflow: hidden;

  i {
    display: block;
    height: 100%;
    border-radius: inherit;
  }
}

.timing-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0 16px;
}

.timing-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 0;
  border-bottom: 1px solid rgba(86, 101, 126, 0.08);

  span {
    color: var(--text-subtle);
    font-size: 13px;
  }

  strong {
    color: var(--text-secondary);
    font-size: 15px;
    font-weight: 700;
  }
}

.slot-table {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.slot-table__head,
.slot-table__row {
  display: grid;
  grid-template-columns: 1fr 0.8fr 1.2fr 1.4fr 0.8fr;
  gap: 12px;
  align-items: center;
}

.slot-table__head {
  padding: 0 0 10px;
  color: var(--text-subtle);
  font-size: 12px;
  border-bottom: 1px solid rgba(86, 101, 126, 0.16);
}

.slot-table__row {
  padding: 10px 0;
  border-bottom: 1px solid rgba(86, 101, 126, 0.08);

  span {
    color: var(--text-secondary);
    font-size: 13px;
  }

  strong {
    color: #eef3fb;
    font-size: 13px;
    font-weight: 600;
  }
}

.slot-state {
  justify-self: start;
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(37, 49, 67, 0.8);
  color: var(--text-muted);
  font-style: normal;
  font-size: 12px;
  font-weight: 700;
}

.slot-state--active {
  background: rgba(45, 90, 34, 0.42);
  color: #8fda69;
}

.usage-panel {
  display: grid;
  grid-template-columns: 1.15fr 0.7fr;
  gap: 18px;
  align-items: end;
}

.usage-chart {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  grid-template-rows: 1fr auto;
  gap: 8px 12px;
}

.usage-chart__labels {
  display: grid;
  gap: 10px;
  color: var(--text-subtle);
  font-size: 12px;
}

.usage-chart__svg {
  width: 100%;
  height: 104px;
  border-bottom: 1px solid rgba(86, 101, 126, 0.14);
}

.usage-chart__axis {
  grid-column: 2;
  display: flex;
  justify-content: space-between;
  color: var(--text-subtle);
  font-size: 12px;
}

.usage-summary {
  display: grid;
  gap: 10px;
}

.usage-summary__row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 6px 0;
  border-bottom: 1px solid rgba(86, 101, 126, 0.08);

  span {
    color: var(--text-subtle);
    font-size: 13px;
  }

  strong {
    color: #f3f7fd;
    font-size: 15px;
    font-weight: 700;
  }
}

.channel-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.channel-card {
  padding: 14px;
  border: 1px solid rgba(86, 101, 126, 0.16);
  border-radius: 14px;
  background: rgba(16, 25, 36, 0.58);
}

.channel-card__label {
  color: #63b7ff;
  font-size: 14px;
  font-weight: 700;
}

.channel-slot-list {
  display: grid;
  gap: 10px;
  margin-top: 12px;
}

.channel-slot {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid rgba(84, 104, 132, 0.24);
  border-radius: 10px;
  background: rgba(20, 29, 42, 0.58);

  span {
    color: var(--text-muted);
    font-size: 13px;
  }

  strong {
    color: var(--text-subtle);
    font-size: 13px;
    font-weight: 600;
  }
}

.channel-slot--active {
  border-color: rgba(67, 133, 255, 0.32);
  background: rgba(28, 52, 84, 0.42);

  span,
  strong {
    color: #eef4ff;
  }
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px 22px;
}

.detail-row {
  display: grid;
  gap: 6px;
  padding: 6px 0;

  span {
    color: var(--text-subtle);
    font-size: 13px;
  }

  strong {
    color: var(--text-secondary);
    font-size: 14px;
    font-weight: 600;
  }
}

@media (max-width: 1320px) {
  .memory-hero,
  .memory-grid {
    grid-template-columns: 1fr;
  }

  .detail-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 980px) {
  .hero-card__head,
  .status-grid,
  .timing-grid,
  .usage-panel,
  .channel-grid,
  .detail-grid {
    grid-template-columns: 1fr;
  }

  .slot-table__head,
  .slot-table__row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
