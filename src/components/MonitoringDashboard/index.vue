<script setup lang="ts">
import {
  Cpu,
  DashboardOne,
  DataSheet,
  GraphicDesign,
  HardDisk,
  Memory,
  NetworkTree,
  Refresh,
  Speed,
  Thermometer,
} from '@icon-park/vue-next'
import { computed, onUnmounted, ref, watch } from 'vue'
import {
  activateMonitorDashboard,
  deactivateMonitorDashboard,
  monitorDashboardStore,
  refreshMonitorDashboardData,
  updateMonitorRefreshSettings,
} from '../../composables/useMonitorDashboardData'
import {
  formatBytes,
  formatUptime,
  getDisplayMemoryUsedBytes,
  getMemoryPressureLabel,
} from '../../utils'

const props = defineProps<{
  active?: boolean
}>()

type MetricKind = 'load' | 'temperature' | 'memory' | 'storage'
type MetricState = 'normal' | 'warning' | 'danger'

interface MonitorMetricCard {
  id: string
  label: string
  value: string
  secondary: string
  percent: number
  kind: MetricKind
  icon: unknown
  history: number[]
}

const {
  loading,
  lastSyncedAt,
  lastError,
  monitoringRefreshSettings,
  backgroundThrottled,
  cpuData,
  cpuLoad,
  cpuTemperature,
  memoData,
  primaryGpu,
  storageIoData,
  storageUsage,
  networkStatus,
  topProcesses,
  timeInfo,
  usedMemoPercent,
  metricHistory,
} = monitorDashboardStore

const subscribed = ref(false)
const refreshing = ref(false)
const settingsPending = ref(false)

const refreshProfiles = [
  { id: 'eco', label: '省电' },
  { id: 'balanced', label: '平衡' },
  { id: 'realtime', label: '实时' },
] as const

function clampPercent(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

function formatPercent(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value)}%` : '--'
}

function formatTemperature(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? `${Math.round(value)}°C` : '--'
}

function formatRate(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? `${formatBytes(value)}/s` : '--'
}

function formatLatency(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? `${Math.round(value)} ms` : '--'
}

function formatIops(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? `${Math.round(value)} IOPS` : '--'
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

function formatProcessMemory(item: TopProcessData) {
  return item.memRss > 0 ? formatBytes(item.memRss * 1024) : `${item.mem.toFixed(1)}%`
}

function temperatureValue() {
  if (typeof cpuTemperature.value?.value === 'number') return cpuTemperature.value.value
  if (typeof cpuTemperature.value?.main === 'number') return cpuTemperature.value.main
  return null
}

function resolveMetricState(card: MonitorMetricCard): MetricState {
  const value = card.percent

  if (card.kind === 'temperature') {
    if (value >= 90) return 'danger'
    if (value >= 80) return 'warning'
    return 'normal'
  }

  if (card.kind === 'storage') {
    if (value >= 95) return 'danger'
    if (value >= 85) return 'warning'
    return 'normal'
  }

  if (value >= 95) return 'danger'
  if (value >= 80) return 'warning'
  return 'normal'
}

function sparklinePoints(values: number[]) {
  const source = values.length ? values.slice(-24) : [0, 0, 0, 0, 0, 0]
  const max = Math.max(100, ...source)
  const step = source.length > 1 ? 150 / (source.length - 1) : 150

  return source
    .map((value, index) => {
      const x = Number((index * step).toFixed(2))
      const y = Number((42 - (Math.max(0, value) / max) * 34).toFixed(2))
      return `${x},${y}`
    })
    .join(' ')
}

const cpuTemperatureValue = computed(() => temperatureValue())
const gpuLoadPercent = computed(() => clampPercent(primaryGpu.value?.utilizationGpu || 0))
const gpuTemperatureValue = computed(() => (
  typeof primaryGpu.value?.temperatureGpu === 'number' ? primaryGpu.value.temperatureGpu : null
))
const memoryUsedBytes = computed(() => getDisplayMemoryUsedBytes(memoData.value))
const memoryDisplayValue = computed(() => (
  memoData.value.normalizedPlatform === 'darwin'
    ? getMemoryPressureLabel(memoData.value.pressure?.level)
    : formatPercent(usedMemoPercent.value)
))

const metricCards = computed<MonitorMetricCard[]>(() => [
  {
    id: 'cpu-load',
    label: 'CPU 使用率',
    value: formatPercent(cpuLoad.value),
    secondary: cpuData.value?.brand || '处理器负载',
    percent: clampPercent(cpuLoad.value),
    kind: 'load',
    icon: Cpu,
    history: metricHistory.cpuLoad,
  },
  {
    id: 'cpu-temp',
    label: 'CPU 温度',
    value: formatTemperature(cpuTemperatureValue.value),
    secondary: cpuTemperature.value?.source === 'unsupported' ? '当前传感器暂不可用' : '处理器温度',
    percent: clampPercent(cpuTemperatureValue.value || 0),
    kind: 'temperature',
    icon: Thermometer,
    history: metricHistory.cpuTemp,
  },
  {
    id: 'gpu-load',
    label: 'GPU 使用率',
    value: formatPercent(gpuLoadPercent.value),
    secondary: primaryGpu.value?.model || primaryGpu.value?.name || '图形处理器',
    percent: gpuLoadPercent.value,
    kind: 'load',
    icon: GraphicDesign,
    history: metricHistory.gpuLoad,
  },
  {
    id: 'gpu-temp',
    label: 'GPU 温度',
    value: formatTemperature(gpuTemperatureValue.value),
    secondary: '图形处理器温度',
    percent: clampPercent(gpuTemperatureValue.value || 0),
    kind: 'temperature',
    icon: Speed,
    history: metricHistory.gpuTemp,
  },
  {
    id: 'memory',
    label: memoData.value.normalizedPlatform === 'darwin' ? '内存压力' : '内存使用率',
    value: memoryDisplayValue.value,
    secondary: memoData.value.total
      ? `${formatBytes(memoryUsedBytes.value)} / ${formatBytes(memoData.value.total)}`
      : '等待内存数据',
    percent: clampPercent(usedMemoPercent.value),
    kind: 'memory',
    icon: Memory,
    history: metricHistory.memoryLoad,
  },
  {
    id: 'storage',
    label: '存储使用率',
    value: storageUsage.value.total ? formatPercent(storageUsage.value.percent) : '--',
    secondary: storageUsage.value.total
      ? `${formatBytes(storageUsage.value.used)} / ${formatBytes(storageUsage.value.total)}`
      : '等待磁盘数据',
    percent: clampPercent(storageUsage.value.percent),
    kind: 'storage',
    icon: HardDisk,
    history: metricHistory.storageLoad,
  },
])

const monitorStatusText = computed(() => {
  if (loading.value) return '正在建立监控基线'
  if (lastError.value) return '部分监控项暂不可用'
  if (backgroundThrottled.value) return '后台降频中'
  return '监控运行中'
})

const networkTitle = computed(() => networkStatus.value.defaultInterface || '默认网络')
const networkMeta = computed(() => {
  const parts = [
    networkStatus.value.gateway ? `网关 ${networkStatus.value.gateway}` : '',
    networkStatus.value.operstate || '',
    networkStatus.value.latencyMs !== null ? `延迟 ${formatLatency(networkStatus.value.latencyMs)}` : '',
  ].filter(Boolean)
  return parts.join(' · ') || '等待网络状态'
})

async function applyRefreshProfile(profile: MonitoringRefreshSettingsData['profile']) {
  if (settingsPending.value || monitoringRefreshSettings.value.profile === profile) return
  settingsPending.value = true
  try {
    await updateMonitorRefreshSettings({ profile })
  } finally {
    settingsPending.value = false
  }
}

async function toggleBackgroundThrottle() {
  if (settingsPending.value) return
  settingsPending.value = true
  try {
    await updateMonitorRefreshSettings({
      backgroundThrottleEnabled: !monitoringRefreshSettings.value.backgroundThrottleEnabled,
    })
  } finally {
    settingsPending.value = false
  }
}

async function refreshNow() {
  if (refreshing.value) return
  refreshing.value = true
  try {
    await refreshMonitorDashboardData()
  } finally {
    refreshing.value = false
  }
}

function openStandardFloatingMonitor() {
  window.services.createWindow('a_watch', 398, 432, 0)
}

function openSuperLiteMonitor() {
  window.services.createWindow('a_watch_super_lite', 200, 200, 0)
}

async function ensureActive() {
  if (subscribed.value) return
  subscribed.value = true
  await activateMonitorDashboard()
}

function release() {
  if (!subscribed.value) return
  subscribed.value = false
  deactivateMonitorDashboard()
}

watch(
  () => props.active,
  async (active) => {
    if (active === false) {
      release()
      return
    }
    await ensureActive()
  },
  { immediate: true }
)

onUnmounted(() => {
  release()
})
</script>

<template>
  <div class="monitor-dashboard-page">
    <div class="monitor-dashboard-scroll">
      <div class="monitor-dashboard-shell">
        <header class="monitor-dashboard-hero">
          <div class="monitor-dashboard-hero__copy">
            <div class="monitor-dashboard-kicker">
              <span class="monitor-dashboard-kicker__pulse" aria-hidden="true" />
              <span>{{ monitorStatusText }}</span>
              <span>·</span>
              <span>运行 {{ formatUptime(timeInfo?.uptime || 0) }}</span>
            </div>
            <h1>运行状态</h1>
            <p>集中查看温度、负载、内存、磁盘和网络状态，并按需要打开标准或超轻量悬浮监控。</p>
          </div>

          <div class="monitor-dashboard-hero__actions">
            <button type="button" class="monitor-launch-button monitor-launch-button--primary" @click="openStandardFloatingMonitor">
              <DashboardOne theme="outline" size="17" fill="currentColor" :strokeWidth="3" />
              标准悬浮监控
            </button>
            <button type="button" class="monitor-launch-button" @click="openSuperLiteMonitor">
              <DataSheet theme="outline" size="17" fill="currentColor" :strokeWidth="3" />
              超轻量悬浮
            </button>
          </div>
        </header>

        <section class="monitor-toolbar" aria-label="监控刷新设置">
          <div class="monitor-toolbar__profiles">
            <span>刷新</span>
            <button
              v-for="profile in refreshProfiles"
              :key="profile.id"
              type="button"
              :disabled="settingsPending"
              :class="['monitor-profile-button', { 'monitor-profile-button--active': monitoringRefreshSettings.profile === profile.id }]"
              @click="applyRefreshProfile(profile.id)"
            >
              {{ profile.label }}
            </button>
          </div>

          <div class="monitor-toolbar__right">
            <button
              type="button"
              :disabled="settingsPending"
              :class="['monitor-background-button', { 'monitor-background-button--active': monitoringRefreshSettings.backgroundThrottleEnabled }]"
              @click="toggleBackgroundThrottle"
            >
              后台降频 {{ monitoringRefreshSettings.backgroundThrottleEnabled ? '开' : '关' }}
            </button>
            <button type="button" class="monitor-refresh-button" :disabled="refreshing" @click="refreshNow">
              <Refresh theme="outline" size="16" fill="currentColor" :strokeWidth="3" />
              {{ refreshing ? '刷新中' : '刷新' }}
            </button>
            <span class="monitor-toolbar__synced">{{ formatSyncTime(lastSyncedAt) }}</span>
          </div>
        </section>

        <section class="monitor-metric-grid" aria-label="核心监控指标">
          <article
            v-for="card in metricCards"
            :key="card.id"
            :class="['monitor-metric-card', `monitor-metric-card--${resolveMetricState(card)}`]"
          >
            <div class="monitor-metric-card__head">
              <div class="monitor-metric-card__icon">
                <component :is="card.icon" theme="outline" size="20" fill="currentColor" :strokeWidth="3" />
              </div>
              <span>{{ card.label }}</span>
            </div>

            <div class="monitor-metric-card__value">{{ card.value }}</div>
            <div class="monitor-metric-card__secondary">{{ card.secondary }}</div>

            <svg class="monitor-metric-card__sparkline" viewBox="0 0 150 44" preserveAspectRatio="none" aria-hidden="true">
              <polyline :points="sparklinePoints(card.history)" />
            </svg>

            <div class="monitor-metric-card__track" aria-hidden="true">
              <span :style="{ width: `${card.percent}%` }" />
            </div>
          </article>
        </section>

        <section class="monitor-live-grid">
          <article class="monitor-live-card">
            <div class="monitor-live-card__head">
              <div>
                <span class="monitor-live-card__eyebrow">网络</span>
                <h2>{{ networkTitle }}</h2>
              </div>
              <NetworkTree theme="outline" size="24" fill="currentColor" :strokeWidth="3" />
            </div>
            <p>{{ networkMeta }}</p>
            <div class="monitor-live-card__values">
              <div>
                <span>下载</span>
                <strong>{{ formatRate(networkStatus.rxSec) }}</strong>
              </div>
              <div>
                <span>上传</span>
                <strong>{{ formatRate(networkStatus.txSec) }}</strong>
              </div>
              <div>
                <span>网关延迟</span>
                <strong>{{ formatLatency(networkStatus.latencyMs) }}</strong>
              </div>
            </div>
          </article>

          <article class="monitor-live-card">
            <div class="monitor-live-card__head">
              <div>
                <span class="monitor-live-card__eyebrow">存储 I/O</span>
                <h2>实时读写</h2>
              </div>
              <HardDisk theme="outline" size="24" fill="currentColor" :strokeWidth="3" />
            </div>
            <p>首次采样会建立基线，随后显示实时吞吐和 IOPS。</p>
            <div class="monitor-live-card__values">
              <div>
                <span>读取</span>
                <strong>{{ formatRate(storageIoData.readBytesPerSec) }}</strong>
              </div>
              <div>
                <span>写入</span>
                <strong>{{ formatRate(storageIoData.writeBytesPerSec) }}</strong>
              </div>
              <div>
                <span>IOPS</span>
                <strong>{{ formatIops(storageIoData.totalIops) }}</strong>
              </div>
            </div>
          </article>
        </section>

        <section class="monitor-process-panel">
          <div class="monitor-process-panel__head">
            <div>
              <span>资源热点</span>
              <h2>高占用进程</h2>
            </div>
            <span>CPU Top + 内存 Top 合并</span>
          </div>

          <div v-if="topProcesses.length" class="monitor-process-list">
            <div v-for="(item, index) in topProcesses" :key="`${item.pid}-${item.name}`" class="monitor-process-row">
              <span class="monitor-process-row__rank">{{ index + 1 }}</span>
              <div class="monitor-process-row__name">
                <strong>{{ item.name }}</strong>
                <span>PID {{ item.pid }}</span>
              </div>
              <div class="monitor-process-row__metric">
                <span>CPU</span>
                <strong>{{ formatPercent(item.cpu) }}</strong>
              </div>
              <div class="monitor-process-row__metric">
                <span>内存</span>
                <strong>{{ formatProcessMemory(item) }}</strong>
              </div>
            </div>
          </div>
          <div v-else class="monitor-process-empty">正在读取进程占用…</div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
.monitor-dashboard-page,
.monitor-dashboard-scroll {
  height: 100%;
  min-height: 0;
}

.monitor-dashboard-scroll {
  overflow: auto;
}

.monitor-dashboard-shell {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
  padding-bottom: 4px;
}

.monitor-dashboard-hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding: 4px 2px 10px;
}

.monitor-dashboard-kicker {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 24px;
  color: var(--text-subtle);
  font-size: 12px;
  font-weight: 700;
}

.monitor-dashboard-kicker__pulse {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent-green);
  box-shadow: 0 0 0 4px var(--state-good-bg);
}

.monitor-dashboard-hero h1 {
  margin: 8px 0 0;
  color: var(--text-primary);
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.03em;
}

.monitor-dashboard-hero p {
  max-width: 680px;
  margin: 9px 0 0;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.6;
}

.monitor-dashboard-hero__actions {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-top: 14px;
}

.monitor-launch-button,
.monitor-refresh-button,
.monitor-background-button,
.monitor-profile-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--control-height);
  border: 1px solid var(--control-border);
  border-radius: var(--control-radius);
  background: var(--control-bg);
  color: var(--control-fg);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: border-color 0.18s ease, background 0.18s ease, color 0.18s ease;
}

.monitor-launch-button {
  gap: 8px;
  min-height: 40px;
  padding: 0 14px;
}

.monitor-launch-button:hover,
.monitor-refresh-button:hover,
.monitor-background-button:hover,
.monitor-profile-button:hover {
  border-color: var(--control-border-strong);
  color: var(--control-fg-strong);
}

.monitor-launch-button--primary {
  border-color: var(--button-primary-border);
  background: var(--button-primary-bg);
  color: var(--button-primary-fg);
}

.monitor-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  min-height: 48px;
  padding: 7px 10px;
  border: 1px solid var(--panel-border-soft);
  border-radius: 12px;
  background: var(--frame-bg);
}

.monitor-toolbar__profiles,
.monitor-toolbar__right {
  display: flex;
  align-items: center;
  gap: 7px;
}

.monitor-toolbar__profiles > span,
.monitor-toolbar__synced {
  color: var(--text-subtle);
  font-size: 12px;
  font-weight: 700;
}

.monitor-profile-button {
  min-width: 46px;
  padding: 0 10px;
  background: transparent;
}

.monitor-profile-button--active,
.monitor-background-button--active {
  border-color: var(--control-active-border);
  background: var(--control-active-bg);
  color: var(--control-fg-strong);
}

.monitor-background-button,
.monitor-refresh-button {
  gap: 6px;
  padding: 0 11px;
}

.monitor-metric-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.monitor-metric-card,
.monitor-live-card,
.monitor-process-panel {
  border: 1px solid var(--panel-border);
  border-radius: var(--surface-radius);
  background: var(--card-background);
  box-shadow: var(--panel-shadow);
}

.monitor-metric-card {
  position: relative;
  min-height: 168px;
  padding: 16px;
  overflow: hidden;
}

.monitor-metric-card::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: var(--accent-blue);
  opacity: 0.55;
}

.monitor-metric-card--warning::before {
  background: var(--accent-yellow);
  opacity: 0.9;
}

.monitor-metric-card--danger::before {
  background: var(--accent-danger);
  opacity: 1;
}

.monitor-metric-card__head {
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 800;
}

.monitor-metric-card__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: var(--state-info-bg);
  color: var(--state-info-fg);
}

.monitor-metric-card--warning .monitor-metric-card__icon {
  background: var(--state-warn-bg);
  color: var(--state-warn-fg);
}

.monitor-metric-card--danger .monitor-metric-card__icon {
  background: var(--state-danger-bg);
  color: var(--accent-danger);
}

.monitor-metric-card__value {
  margin-top: 14px;
  color: var(--text-primary);
  font-size: 30px;
  font-weight: 800;
  letter-spacing: -0.035em;
}

.monitor-metric-card__secondary {
  margin-top: 5px;
  min-height: 18px;
  overflow: hidden;
  color: var(--text-subtle);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.monitor-metric-card__sparkline {
  display: block;
  width: 100%;
  height: 34px;
  margin-top: 8px;
}

.monitor-metric-card__sparkline polyline {
  fill: none;
  stroke: var(--accent-blue);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0.75;
}

.monitor-metric-card--warning .monitor-metric-card__sparkline polyline {
  stroke: var(--accent-yellow);
}

.monitor-metric-card--danger .monitor-metric-card__sparkline polyline {
  stroke: var(--accent-danger);
}

.monitor-metric-card__track {
  height: 4px;
  margin-top: 6px;
  overflow: hidden;
  border-radius: var(--pill-radius);
  background: var(--surface-track-background);
}

.monitor-metric-card__track span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--accent-blue);
}

.monitor-metric-card--warning .monitor-metric-card__track span {
  background: var(--accent-yellow);
}

.monitor-metric-card--danger .monitor-metric-card__track span {
  background: var(--accent-danger);
}

.monitor-live-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.monitor-live-card {
  padding: 17px 18px;
}

.monitor-live-card__head,
.monitor-process-panel__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.monitor-live-card__head > svg {
  color: var(--accent-cyan);
}

.monitor-live-card__eyebrow,
.monitor-process-panel__head > div > span {
  color: var(--text-subtle);
  font-size: 11px;
  font-weight: 800;
}

.monitor-live-card h2,
.monitor-process-panel h2 {
  margin: 4px 0 0;
  color: var(--text-primary);
  font-size: 16px;
  font-weight: 800;
}

.monitor-live-card > p {
  margin: 8px 0 0;
  min-height: 20px;
  color: var(--text-subtle);
  font-size: 12px;
}

.monitor-live-card__values {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-top: 14px;
}

.monitor-live-card__values > div {
  padding: 10px 11px;
  border: 1px solid var(--panel-border-soft);
  border-radius: 10px;
  background: var(--surface-softer-background);
}

.monitor-live-card__values span,
.monitor-process-row__metric span {
  display: block;
  color: var(--text-subtle);
  font-size: 11px;
}

.monitor-live-card__values strong {
  display: block;
  margin-top: 5px;
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 800;
}

.monitor-process-panel {
  padding: 17px 18px;
}

.monitor-process-panel__head > span {
  color: var(--text-subtle);
  font-size: 11px;
}

.monitor-process-list {
  margin-top: 12px;
}

.monitor-process-row {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) 90px 100px;
  align-items: center;
  gap: 12px;
  min-height: 46px;
  border-top: 1px solid var(--panel-border-soft);
}

.monitor-process-row:first-child {
  border-top: 0;
}

.monitor-process-row__rank {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 8px;
  background: var(--state-info-bg);
  color: var(--state-info-fg);
  font-size: 11px;
  font-weight: 800;
}

.monitor-process-row__name {
  min-width: 0;
}

.monitor-process-row__name strong {
  display: block;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.monitor-process-row__name span {
  display: block;
  margin-top: 2px;
  color: var(--text-subtle);
  font-size: 10px;
}

.monitor-process-row__metric {
  text-align: right;
}

.monitor-process-row__metric strong {
  display: block;
  margin-top: 3px;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 800;
}

.monitor-process-empty {
  margin-top: 12px;
  padding: 16px 0;
  border-top: 1px solid var(--panel-border-soft);
  color: var(--text-subtle);
  font-size: 12px;
}

@media (max-width: 980px) {
  .monitor-dashboard-hero {
    flex-direction: column;
  }

  .monitor-dashboard-hero__actions {
    padding-top: 0;
  }

  .monitor-metric-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .monitor-live-grid {
    grid-template-columns: 1fr;
  }
}
</style>
