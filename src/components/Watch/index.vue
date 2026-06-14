<script setup lang="ts">
import {
  CloseSmall,
  Cpu,
  DashboardOne,
  GraphicDesign,
  Memory,
  MemoryCardOne,
  Minus,
  Pushpin,
  Thermometer,
} from '@icon-park/vue-next'
import { computed, onUnmounted, reactive, ref, watch } from 'vue'
import { clampPercent, getDisplayCpuCurrentSpeedGHz, getDisplayMemoryUsedBytes, getDisplayMemoryUsagePercent, getMemoryPressureLabel } from '../../utils'
import {
  buildWatchCpuOverviewSideItems,
  formatWatchRuntime,
  getWatchCpuAuxMetricIds,
  getWatchOverviewSideColumnCount,
  formatWatchCpuSpeedSourceLabel,
  getWatchCpuPalette,
  getWatchGpuPalette,
  getWatchMemoryPalette,
  WATCH_MODE_POLL_PROFILES,
} from '../../utils/watch'

const props = defineProps<{
  active?: boolean
}>()

const memoData = reactive<MemoData>({
  active: 0,
  available: 0,
  total: 0,
  free: 0,
  used: 0,
  rawActive: 0,
  rawAvailable: 0,
  normalizedPlatform: '',
  swaptotal: 0,
  swapused: 0,
  swapfree: 0,
  pressure: {
    level: 'unknown',
    rawLevel: null,
    availablePercent: null,
    source: 'fallback',
  },
})

const gpuData = ref<GpuData[]>([])
const cpuInfo = ref<CpuData>()
const cpuLoad = ref(0)
const cpuTemperature = ref<CpuTemperatureData>()
const cpuCurrentSpeed = ref<CpuCurrentSpeedData>()
const cpuPower = ref<CpuPowerData>()
const cpuVoltage = ref<CpuVoltageData>()
const cpuFanSpeed = ref<CpuFanData>()
const timeInfo = ref<TimeData>()
const memoryLayout = ref<MemoLayoutData[]>([])
const pinned = ref(true)
const monitorMode = ref<'overview' | 'cpu' | 'gpu'>('overview')

const history = reactive({
  cpu: [] as number[],
  gpu: [] as number[],
  memory: [] as number[],
  cpuTemp: [] as number[],
  cpuSpeed: [] as number[],
  cpuPower: [] as number[],
  cpuVoltage: [] as number[],
  cpuFan: [] as number[],
  gpuTemp: [] as number[],
  gpuMemory: [] as number[],
  gpuPower: [] as number[],
})

let fastTimerId: number | undefined
let slowTimerId: number | undefined
let lastCpuSensorRefreshAt = 0
let lastCpuPowerRefreshAt = 0
let lastCpuAuxSensorRefreshAt = 0
let lastCpuSpeedRefreshAt = 0
let lastGpuRefreshAt = 0
let lastInfoRefreshAt = 0
let lastTimeRefreshAt = 0
let watchRefreshGeneration = 0

const STATIC_INFO_INTERVAL_MS = 20000
const TIME_INFO_INTERVAL_MS = 10000
const CPU_SPEED_INFO_INTERVAL_MS = 4500

function getCurrentPollProfile() {
  return WATCH_MODE_POLL_PROFILES[monitorMode.value]
}

function withTimeout<T>(promise: Promise<T>, timeout = 2500): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error('读取超时')), timeout)
    }),
  ])
}

function clampHistory(list: number[], value: number) {
  list.push(Number.isFinite(value) ? value : 0)
  if (list.length > 24) list.shift()
}

function gpuTelemetryScore(item: GpuData) {
  let score = 0

  if (typeof item.utilizationGpu === 'number') score += 100
  if (typeof item.temperatureGpu === 'number') score += 40
  if (typeof item.powerDraw === 'number') score += 30
  if (typeof item.memoryUsed === 'number') score += 20
  score += item.memoryTotal || item.vram || 0

  return score
}

function formatPercent(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value)}%` : '--'
}

function formatTemperature(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? `${Math.round(value)}°C` : '--'
}

function formatGigabytesFromBytes(value: number | null | undefined, digits = 1) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? `${(value / (1024 ** 3)).toFixed(digits)} GB` : '--'
}

function formatGigabytesFromMegabytes(value: number | null | undefined, digits = 1) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? `${(value / 1024).toFixed(digits)} GB` : '--'
}

function formatFrequencyGHz(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? `${value.toFixed(2)} GHz` : '--'
}

function formatPower(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '--'
  if (value < 1) return `${Math.round(value * 1000)} mW`
  if (value < 10) return `${value.toFixed(1)} W`
  return `${Math.round(value)} W`
}

function formatVoltage(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? `${value.toFixed(2)} V` : '--'
}

function formatFanSpeed(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? `${Math.round(value)} RPM` : '--'
}

function sparklinePoints(values: number[]) {
  const source = values.length ? values : [0, 0, 0, 0, 0, 0]
  const min = Math.min(...source)
  const max = Math.max(...source)
  const range = Math.max(1, max - min)
  const step = source.length > 1 ? 238 / (source.length - 1) : 238

  return source
    .map((value, index) => {
      const x = Number((index * step).toFixed(2))
      const y = Number((58 - ((value - min) / range) * 44).toFixed(2))
      return `${x},${y}`
    })
    .join(' ')
}

function sparklineArea(values: number[]) {
  const line = sparklinePoints(values)
  return `0,64 ${line} 238,64`
}

function gpuSparklinePoints(values: number[]) {
  const source = values.length ? values : [0, 0, 0, 0, 0, 0]
  const step = source.length > 1 ? 238 / (source.length - 1) : 238

  return source
    .map((value, index) => {
      const x = Number((index * step).toFixed(2))
      const percent = clampPercent(value)
      const visiblePercent = percent > 0 ? Math.max(percent, 12) : 0
      const y = Number((58 - (visiblePercent / 100) * 44).toFixed(2))
      return `${x},${y}`
    })
    .join(' ')
}

function gpuSparklineArea(values: number[]) {
  const line = gpuSparklinePoints(values)
  return `0,64 ${line} 238,64`
}

function progressBarStyle(percent: number, tone: string, minVisiblePercent = 0) {
  const bounded = clampPercent(percent)
  return {
    width: `${bounded > 0 ? Math.max(bounded, minVisiblePercent) : 0}%`,
    background: tone,
  }
}

function sparklinePaletteStyle(palette: { fill: string; stroke: string }) {
  return {
    '--sparkline-fill': palette.fill,
    '--sparkline-stroke': palette.stroke,
  }
}

const primaryGpu = computed(() => {
  return [...gpuData.value].sort((left, right) => gpuTelemetryScore(right) - gpuTelemetryScore(left))[0]
})

const cpuPercent = computed(() => clampPercent(cpuLoad.value))
const memoryPercent = computed(() => {
  return getDisplayMemoryUsagePercent(memoData)
})
const gpuPercent = computed(() => clampPercent(primaryGpu.value?.utilizationGpu || 0))
const memoryPressureLabel = computed(() => getMemoryPressureLabel(memoData.pressure?.level))
const cpuWatchPalette = computed(() => getWatchCpuPalette())
const gpuWatchPalette = computed(() => getWatchGpuPalette())
const memoryWatchPalette = computed(() => getWatchMemoryPalette(memoData.normalizedPlatform, memoData.pressure?.level))

const cpuTempValue = computed(() => {
  if (typeof cpuTemperature.value?.value === 'number') return cpuTemperature.value.value
  if (typeof cpuTemperature.value?.main === 'number') return cpuTemperature.value.main
  return null
})

const cpuTemperatureDisplay = computed(() => {
  if (cpuTempValue.value !== null) return formatTemperature(cpuTempValue.value)
  const reason = cpuTemperature.value?.reason || cpuTemperature.value?.errorCode || ''
  if (reason === 'MACOS_SMC_PERMISSION_REQUIRED') return '需要管理员权限'
  if (reason.startsWith('MACOS_SMC_')) return 'AppleSMC 失败'
  return formatTemperature(cpuTempValue.value)
})

const cpuFrequencyValue = computed(() => {
  const value = getDisplayCpuCurrentSpeedGHz(cpuCurrentSpeed.value)
  return value > 0 ? value : null
})
const cpuFrequencySourceLabel = computed(() => formatWatchCpuSpeedSourceLabel(cpuCurrentSpeed.value))
const cpuPowerValue = computed(() => (typeof cpuPower.value?.value === 'number' ? cpuPower.value.value : null))
const cpuVoltageValue = computed(() => (typeof cpuVoltage.value?.value === 'number' ? cpuVoltage.value.value : null))
const cpuFanSpeedValue = computed(() => (typeof cpuFanSpeed.value?.value === 'number' ? cpuFanSpeed.value.value : null))
const watchCpuAuxMetricIds = computed(() => getWatchCpuAuxMetricIds(memoData.normalizedPlatform))
const cpuOverviewSideItems = computed(() => buildWatchCpuOverviewSideItems({
  temperatureValue: cpuTemperatureDisplay.value,
  powerValue: formatPower(cpuPowerValue.value),
}))
const cpuOverviewSideColumnCount = computed(() => getWatchOverviewSideColumnCount(cpuOverviewSideItems.value.length))

const installedMemoryTotal = computed(() => {
  const modules = memoryLayout.value
    .map((item) => (typeof item?.size === 'number' && Number.isFinite(item.size) ? item.size : 0))
    .filter((size) => size > 0)

  if (!modules.length) return memoData.total || 0
  return modules.reduce((sum, size) => sum + size, 0)
})

const gpuTempValue = computed(() => (
  typeof primaryGpu.value?.temperatureGpu === 'number' ? primaryGpu.value.temperatureGpu : null
))

const gpuPowerValue = computed(() => (
  typeof primaryGpu.value?.powerDraw === 'number' ? primaryGpu.value.powerDraw : null
))

const gpuMemoryUsedValue = computed(() => (
  typeof primaryGpu.value?.memoryUsed === 'number' ? primaryGpu.value.memoryUsed : null
))

const footerStatus = computed(() => {
  if (cpuPercent.value || memoryPercent.value || gpuPercent.value) return '状态良好'
  if (!primaryGpu.value) return '未检测到显卡信息'
  return '部分指标暂不支持'
})

const cpuDetailStats = computed(() => {
  const stats = [
    {
    id: 'load',
    label: 'CPU 使用率',
    value: formatPercent(cpuPercent.value),
    accent: cpuWatchPalette.value.stroke,
    tone: 'cpu',
    history: history.cpu,
  },
  {
    id: 'temp',
    label: 'CPU 温度',
    value: formatTemperature(cpuTempValue.value),
    accent: '#69d04a',
    tone: 'temp',
    history: history.cpuTemp,
  },
  {
    id: 'speed',
    label: `当前频率 · ${cpuFrequencySourceLabel.value}`,
    value: formatFrequencyGHz(cpuFrequencyValue.value),
    accent: '#58a8ff',
    tone: 'speed',
    history: history.cpuSpeed,
  },
  {
    id: 'power',
    label: '当前功耗',
    value: formatPower(cpuPowerValue.value),
    accent: '#ffae47',
    tone: 'power',
    history: history.cpuPower,
  },
  ] as Array<{
    id: string
    label: string
    value: string
    accent: string
    tone: string
    history: number[]
  }>

  if (watchCpuAuxMetricIds.value.includes('voltage')) {
    stats.push({
      id: 'voltage',
      label: '核心电压',
      value: formatVoltage(cpuVoltageValue.value),
      accent: '#b47cff',
      tone: 'voltage',
      history: history.cpuVoltage,
    })
  }

  if (watchCpuAuxMetricIds.value.includes('fan')) {
    stats.push({
      id: 'fan',
      label: 'CPU 风扇',
      value: formatFanSpeed(cpuFanSpeedValue.value),
      accent: '#73c1ff',
      tone: 'fan',
      history: history.cpuFan,
    })
  }

  return stats
})

const gpuDetailStats = computed(() => [
  {
    id: 'load',
    label: 'GPU 使用率',
    value: formatPercent(gpuPercent.value),
    accent: gpuWatchPalette.value.stroke,
    tone: 'gpu',
    history: history.gpu,
  },
  {
    id: 'temp',
    label: 'GPU 温度',
    value: formatTemperature(gpuTempValue.value),
    accent: '#79d84f',
    tone: 'temp',
    history: history.gpuTemp,
  },
  {
    id: 'memory',
    label: '显存占用',
    value: formatGigabytesFromMegabytes(gpuMemoryUsedValue.value),
    accent: '#b47cff',
    tone: 'memory',
    history: history.gpuMemory,
  },
  {
    id: 'power',
    label: '当前功耗',
    value: formatPower(gpuPowerValue.value),
    accent: '#ffb14d',
    tone: 'power',
    history: history.gpuPower,
  },
])

async function refreshFastMetrics(force = false) {
  try {
    const refreshGeneration = watchRefreshGeneration
    const now = Date.now()
    const pollProfile = getCurrentPollProfile()
    const needsCpuDetailSensors = monitorMode.value === 'cpu'
    const needsCpuTemp = pollProfile.cpuTemp > 0 && (force || now - lastCpuSensorRefreshAt >= pollProfile.cpuTemp)
    const needsCpuSpeed = (monitorMode.value === 'overview' || needsCpuDetailSensors)
      && (force || now - lastCpuSpeedRefreshAt >= CPU_SPEED_INFO_INTERVAL_MS)
    const needsCpuPower = pollProfile.cpuPower > 0 && (force || now - lastCpuPowerRefreshAt >= pollProfile.cpuPower)
    const needsCpuAuxSensors = needsCpuDetailSensors
      && pollProfile.cpuAux > 0
      && (force || now - lastCpuAuxSensorRefreshAt >= pollProfile.cpuAux)
    const needsTimeInfo = force || now - lastTimeRefreshAt >= TIME_INFO_INTERVAL_MS

    const [cpuLoadRes, memoRes, cpuTemperatureRes, cpuSpeedRes, cpuPowerRes, cpuVoltageRes, cpuFanRes, timeRes] = await Promise.allSettled([
      withTimeout(window.services.getCpuFullLoad()),
      withTimeout(window.services.getMemInfo()),
      needsCpuTemp ? withTimeout(window.services.getCpuTemperature(), 3500) : Promise.resolve(undefined),
      needsCpuSpeed ? withTimeout(window.services.getCpuCurrentSpeed(), 3500) : Promise.resolve(undefined),
      (needsCpuPower || needsCpuAuxSensors) ? withTimeout(window.services.getCpuPower(), 3500) : Promise.resolve(undefined),
      needsCpuAuxSensors ? withTimeout(window.services.getCpuVoltage(), 3500) : Promise.resolve(undefined),
      needsCpuAuxSensors ? withTimeout(window.services.getCpuFanSpeed(), 3500) : Promise.resolve(undefined),
      needsTimeInfo ? withTimeout(window.services.getTimeInfo(), 3500) : Promise.resolve(undefined),
    ])

    if (refreshGeneration !== watchRefreshGeneration) return

    if (cpuLoadRes.status === 'fulfilled') {
      cpuLoad.value = cpuLoadRes.value
      clampHistory(history.cpu, cpuLoadRes.value)
    }

    if (memoRes.status === 'fulfilled') {
      memoData.active = memoRes.value.active
      memoData.total = memoRes.value.total
      memoData.available = memoRes.value.available
      memoData.free = memoRes.value.free || 0
      memoData.used = memoRes.value.used || 0
      memoData.rawActive = memoRes.value.rawActive || 0
      memoData.rawAvailable = memoRes.value.rawAvailable || 0
      memoData.normalizedPlatform = memoRes.value.normalizedPlatform || ''
      memoData.swaptotal = memoRes.value.swaptotal || 0
      memoData.swapused = memoRes.value.swapused || 0
      memoData.swapfree = memoRes.value.swapfree || 0
      memoData.pressure = memoRes.value.pressure || memoData.pressure
      clampHistory(history.memory, memoryPercent.value)
    }

    if (needsCpuTemp && cpuTemperatureRes.status === 'fulfilled') {
      cpuTemperature.value = cpuTemperatureRes.value
      clampHistory(history.cpuTemp, cpuTempValue.value || 0)
      lastCpuSensorRefreshAt = now
    }

    if (needsCpuSpeed && cpuSpeedRes.status === 'fulfilled') {
      cpuCurrentSpeed.value = cpuSpeedRes.value
      clampHistory(history.cpuSpeed, cpuFrequencyValue.value || 0)
      lastCpuSpeedRefreshAt = now
    }

    if ((needsCpuPower || needsCpuAuxSensors) && cpuPowerRes.status === 'fulfilled') {
      cpuPower.value = cpuPowerRes.value
      clampHistory(history.cpuPower, cpuPowerRes.value?.value || 0)
    }

    if (needsCpuPower) {
      lastCpuPowerRefreshAt = now
    }

    if (needsCpuAuxSensors && cpuVoltageRes.status === 'fulfilled') {
      cpuVoltage.value = cpuVoltageRes.value
      clampHistory(history.cpuVoltage, cpuVoltageRes.value?.value || 0)
    }

    if (needsCpuAuxSensors && cpuFanRes.status === 'fulfilled') {
      cpuFanSpeed.value = cpuFanRes.value
      clampHistory(history.cpuFan, cpuFanRes.value?.value || 0)
    }

    if (needsCpuAuxSensors) {
      lastCpuAuxSensorRefreshAt = now
    }

    if (needsTimeInfo && timeRes.status === 'fulfilled') {
      timeInfo.value = timeRes.value
      lastTimeRefreshAt = now
    }
  } catch (error) {
    console.warn('悬浮监控快速刷新失败:', error)
  }
}

async function refreshSlowMetrics(force = false) {
  try {
    const refreshGeneration = watchRefreshGeneration
    const now = Date.now()
    const pollProfile = getCurrentPollProfile()
    const needsGpuDetail = monitorMode.value === 'gpu'
    const needsGpu = force || now - lastGpuRefreshAt >= (needsGpuDetail ? pollProfile.gpu : pollProfile.gpu)
    const needsStaticInfo = force || now - lastInfoRefreshAt >= STATIC_INFO_INTERVAL_MS

    const [gpuRes, cpuInfoRes, memoryLayoutRes] = await Promise.allSettled([
      needsGpu ? withTimeout(window.services.getGpuInfo(), 8000) : Promise.resolve(undefined),
      needsStaticInfo ? withTimeout(window.services.getCpuInfo(), 5000) : Promise.resolve(undefined),
      needsStaticInfo ? withTimeout(window.services.getMemoryLayout(), 5000) : Promise.resolve(undefined),
    ])

    if (refreshGeneration !== watchRefreshGeneration) return

    if (needsGpu && gpuRes.status === 'fulfilled') {
      gpuData.value = gpuRes.value || gpuData.value
      clampHistory(history.gpu, gpuPercent.value)
      clampHistory(history.gpuTemp, gpuTempValue.value || 0)
      clampHistory(history.gpuMemory, gpuMemoryUsedValue.value || 0)
      clampHistory(history.gpuPower, gpuPowerValue.value || 0)
      lastGpuRefreshAt = now
    }

    if (needsStaticInfo && cpuInfoRes.status === 'fulfilled') {
      cpuInfo.value = cpuInfoRes.value
    }

    if (needsStaticInfo && memoryLayoutRes.status === 'fulfilled') {
      memoryLayout.value = memoryLayoutRes.value || memoryLayout.value
      lastInfoRefreshAt = now
    }
  } catch (error) {
    console.warn('悬浮监控显卡刷新失败:', error)
  }
}

function stopPolling() {
  watchRefreshGeneration += 1
  if (fastTimerId) {
    window.clearInterval(fastTimerId)
    fastTimerId = undefined
  }

  if (slowTimerId) {
    window.clearInterval(slowTimerId)
    slowTimerId = undefined
  }
}

async function startPolling() {
  stopPolling()
  watchRefreshGeneration += 1
  lastCpuSensorRefreshAt = 0
  lastCpuAuxSensorRefreshAt = 0
  lastCpuSpeedRefreshAt = 0
  lastGpuRefreshAt = 0
  lastInfoRefreshAt = 0
  lastTimeRefreshAt = 0

  await refreshFastMetrics(true)
  await refreshSlowMetrics(true)

  const pollProfile = getCurrentPollProfile()

  fastTimerId = window.setInterval(() => {
    refreshFastMetrics()
  }, pollProfile.fast)

  slowTimerId = window.setInterval(() => {
    refreshSlowMetrics()
  }, pollProfile.slow)
}

function togglePin() {
  pinned.value = !pinned.value
  window.services.alwaysOnTop(pinned.value)
}

function minimizeWindow() {
  window.services.minimizeWindow?.()
}

function closeWindow() {
  window.services.closeWindow()
}

function setMonitorMode(mode: 'overview' | 'cpu' | 'gpu') {
  if (monitorMode.value === mode) return
  const previousMode = monitorMode.value
  monitorMode.value = mode

  if (previousMode === 'cpu' && mode !== 'cpu') {
    lastCpuSensorRefreshAt = 0
    lastCpuAuxSensorRefreshAt = 0
  }

   if (previousMode === 'gpu' && mode !== 'gpu') {
    lastGpuRefreshAt = 0
  }

  if (props.active !== false) {
    void startPolling()
  }
}

watch(
  () => props.active,
  async (active) => {
    if (!active) {
      stopPolling()
      return
    }

    window.services.alwaysOnTop(pinned.value)
    await startPolling()
  },
  { immediate: true }
)

onUnmounted(() => {
  stopPolling()
})
</script>

<template>
  <div class="watch-container">
    <div class="monitor-shell">
      <header class="monitor-shell__header">
        <div class="monitor-shell__brand">
          <div class="monitor-shell__brand-mark">H</div>
          <span>HWInfoX Monitor</span>
        </div>

        <div class="monitor-shell__modes">
          <button
            type="button"
            :class="['monitor-mode', { 'monitor-mode--active': monitorMode === 'overview' }]"
            @click="setMonitorMode('overview')"
          >
            概览
          </button>
          <button
            type="button"
            :class="['monitor-mode', { 'monitor-mode--active': monitorMode === 'cpu' }]"
            @click="setMonitorMode('cpu')"
          >
            CPU
          </button>
          <button
            type="button"
            :class="['monitor-mode', { 'monitor-mode--active': monitorMode === 'gpu' }]"
            @click="setMonitorMode('gpu')"
          >
            GPU
          </button>
        </div>

        <div class="monitor-shell__actions">
          <button type="button" :class="['monitor-action', { 'monitor-action--active': pinned }]" @click="togglePin">
            <Pushpin theme="outline" size="16" fill="currentColor" :strokeWidth="3" />
          </button>
          <button type="button" class="monitor-action" @click="minimizeWindow">
            <Minus theme="outline" size="16" fill="currentColor" :strokeWidth="3" />
          </button>
          <button type="button" class="monitor-action monitor-action--close" @click="closeWindow">
            <CloseSmall theme="outline" size="18" fill="currentColor" :strokeWidth="3" />
          </button>
        </div>
      </header>

      <div v-if="monitorMode === 'overview'" class="monitor-shell__body">
        <WatchRow
          tone="cpu"
          :accent="cpuWatchPalette.stroke"
          :border="cpuWatchPalette.border"
          :side-width="cpuOverviewSideColumnCount > 1 ? '122px' : '82px'"
        >
          <template #icon>
            <Cpu theme="outline" size="24" :fill="cpuWatchPalette.icon" :strokeWidth="3" />
          </template>
          <template #title>CPU</template>
          <template #subtitle>使用率</template>
          <template #value>{{ formatPercent(cpuPercent) }}</template>
          <template #chart>
            <svg
              class="metric-sparkline metric-sparkline--cpu"
              :style="sparklinePaletteStyle(cpuWatchPalette)"
              viewBox="0 0 238 64"
              preserveAspectRatio="none"
            >
              <polygon :points="sparklineArea(history.cpu)" />
              <polyline :points="sparklinePoints(history.cpu)" />
            </svg>
          </template>
          <template #bar>
            <div class="metric-progress">
              <span class="metric-progress__fill" :style="progressBarStyle(cpuPercent, cpuWatchPalette.progress)" />
            </div>
          </template>
          <template #side>
            <div
              :class="[
                'metric-side-list',
                `metric-side-list--columns-${cpuOverviewSideColumnCount}`,
              ]"
            >
              <div
                v-for="item in cpuOverviewSideItems"
                :key="item.id"
                class="metric-side-item"
              >
                <div class="metric-side-item__label">
                  <Thermometer v-if="item.icon === 'temperature'" theme="outline" size="13" fill="currentColor" :strokeWidth="3" />
                  <DashboardOne v-else theme="outline" size="13" fill="currentColor" :strokeWidth="3" />
                  <span>{{ item.label }}</span>
                </div>
                <strong>{{ item.value }}</strong>
              </div>
            </div>
          </template>
        </WatchRow>

        <WatchRow tone="gpu" :accent="gpuWatchPalette.stroke" :border="gpuWatchPalette.border">
          <template #icon>
            <GraphicDesign theme="outline" size="24" :fill="gpuWatchPalette.icon" :strokeWidth="3" />
          </template>
          <template #title>GPU</template>
          <template #subtitle>使用率</template>
          <template #value>{{ formatPercent(gpuPercent) }}</template>
          <template #chart>
            <svg
              class="metric-sparkline metric-sparkline--gpu"
              :style="sparklinePaletteStyle(gpuWatchPalette)"
              viewBox="0 0 238 64"
              preserveAspectRatio="none"
            >
              <line class="metric-sparkline__baseline" x1="0" y1="58" x2="238" y2="58" />
              <polygon :points="gpuSparklineArea(history.gpu)" />
              <polyline class="metric-sparkline__halo" :points="gpuSparklinePoints(history.gpu)" />
              <polyline :points="gpuSparklinePoints(history.gpu)" />
            </svg>
          </template>
          <template #bar>
            <div class="metric-progress metric-progress--gpu">
              <span class="metric-progress__fill" :style="progressBarStyle(gpuPercent, gpuWatchPalette.progress, 6)" />
            </div>
          </template>
          <template #side>
            <div class="metric-side-list metric-side-list--columns-1">
              <div class="metric-side-item">
                <div class="metric-side-item__label">
                  <Thermometer theme="outline" size="13" fill="currentColor" :strokeWidth="3" />
                  <span>温度</span>
                </div>
                <strong>{{ formatTemperature(primaryGpu?.temperatureGpu) }}</strong>
              </div>
              <div class="metric-side-item">
                <div class="metric-side-item__label">
                  <MemoryCardOne theme="outline" size="13" fill="currentColor" :strokeWidth="3" />
                  <span>功耗</span>
                </div>
                <strong>{{ formatPower(gpuPowerValue) }}</strong>
              </div>
            </div>
          </template>
        </WatchRow>

        <WatchRow tone="memory" :accent="memoryWatchPalette.stroke" :border="memoryWatchPalette.border">
          <template #icon>
            <Memory theme="outline" size="24" :fill="memoryWatchPalette.icon" :strokeWidth="3" />
          </template>
          <template #title>内存</template>
          <template #subtitle>使用率</template>
          <template #value>{{ formatPercent(memoryPercent) }}</template>
          <template #chart>
            <svg
              class="metric-sparkline metric-sparkline--memory"
              :style="sparklinePaletteStyle(memoryWatchPalette)"
              viewBox="0 0 238 64"
              preserveAspectRatio="none"
            >
              <polygon :points="sparklineArea(history.memory)" />
              <polyline :points="sparklinePoints(history.memory)" />
            </svg>
          </template>
          <template #bar>
            <div class="metric-progress">
              <span class="metric-progress__fill" :style="progressBarStyle(memoryPercent, memoryWatchPalette.progress)" />
            </div>
          </template>
          <template #side>
            <div class="metric-side-list metric-side-list--columns-1">
              <div class="metric-side-item">
                <div class="metric-side-item__label">
                  <DashboardOne theme="outline" size="13" fill="currentColor" :strokeWidth="3" />
                  <span>已用</span>
                </div>
                <strong>{{ formatGigabytesFromBytes(getDisplayMemoryUsedBytes(memoData)) }}</strong>
              </div>
              <div class="metric-side-item">
                <div class="metric-side-item__label">
                  <MemoryCardOne theme="outline" size="13" fill="currentColor" :strokeWidth="3" />
                  <span>{{ memoData.normalizedPlatform === 'darwin' ? '压力' : '总计' }}</span>
                </div>
                <strong>{{ memoData.normalizedPlatform === 'darwin' ? memoryPressureLabel : formatGigabytesFromBytes(installedMemoryTotal, 0) }}</strong>
              </div>
            </div>
          </template>
        </WatchRow>
      </div>

      <div v-else-if="monitorMode === 'cpu'" class="monitor-shell__body monitor-shell__body--cpu-detail">
        <section class="detail-glass-panel detail-glass-panel--cpu cpu-detail-grid">
          <article
            v-for="item in cpuDetailStats"
            :key="item.id"
            :class="['cpu-detail-metric', `cpu-detail-metric--${item.tone}`]"
          >
            <div class="cpu-detail-metric__head">
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
            </div>
            <svg :class="['cpu-detail-sparkline', `cpu-detail-sparkline--${item.tone}`]" viewBox="0 0 238 64" preserveAspectRatio="none">
              <polygon :points="sparklineArea(item.history)" />
              <polyline :points="sparklinePoints(item.history)" />
            </svg>
          </article>
        </section>

      </div>

      <div v-else class="monitor-shell__body monitor-shell__body--cpu-detail">
        <section class="detail-glass-panel detail-glass-panel--gpu cpu-detail-grid">
          <article
            v-for="item in gpuDetailStats"
            :key="item.id"
            :class="['cpu-detail-metric', `cpu-detail-metric--${item.tone}`]"
          >
            <div class="cpu-detail-metric__head">
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
            </div>
            <svg :class="['cpu-detail-sparkline', `cpu-detail-sparkline--${item.tone}`]" viewBox="0 0 238 64" preserveAspectRatio="none">
              <polygon :points="sparklineArea(item.history)" />
              <polyline :points="sparklinePoints(item.history)" />
            </svg>
          </article>
        </section>
      </div>

      <footer class="monitor-shell__footer">
        <div class="monitor-shell__footer-meta">
          <span>运行时间 {{ formatWatchRuntime(timeInfo?.uptime) }}</span>
          <span>更新频率 1s</span>
        </div>
        <div class="monitor-shell__footer-status">
          <span class="monitor-shell__footer-pulse" />
          <span>{{ footerStatus }}</span>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped lang="less">
.watch-container {
  height: 100%;
  width: 100%;
  background: transparent;
}

.monitor-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  box-sizing: border-box;
  gap: 8px;
  padding: 10px 12px 8px;
  border: 1px solid rgba(210, 223, 248, 0.34);
  border-radius: 8px;
  background:
    radial-gradient(circle at top left, rgba(53, 119, 255, 0.2), transparent 28%),
    linear-gradient(180deg, rgba(27, 45, 79, 0.62), rgba(13, 22, 40, 0.58));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.22),
    0 20px 40px rgba(1, 8, 18, 0.26);
  backdrop-filter: blur(28px);
}

.monitor-shell__header,
.monitor-shell__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.monitor-shell__header {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  padding: 1px 2px 8px;
  border-bottom: 1px solid rgba(129, 149, 183, 0.18);
  -webkit-app-region: drag;
}

.monitor-shell__brand {
  display: flex;
  align-items: center;
  gap: 8px;
  color: rgba(236, 242, 251, 0.96);
  font-size: 12px;
  font-weight: 600;
}

.monitor-shell__brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 7px;
  background: linear-gradient(180deg, rgba(95, 149, 255, 0.92), rgba(56, 103, 255, 0.76));
  color: #f6f9ff;
  font-size: 9px;
  font-weight: 800;
  box-shadow: 0 10px 20px rgba(48, 92, 255, 0.26);
}

.monitor-shell__modes {
  justify-self: center;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px;
  border-radius: 999px;
  border: 1px solid rgba(103, 126, 166, 0.18);
  background: rgba(17, 27, 44, 0.42);
  -webkit-app-region: no-drag;
}

.monitor-mode {
  min-width: 38px;
  height: 20px;
  padding: 0 8px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgba(205, 216, 235, 0.66);
  font-size: 9px;
  font-weight: 600;
}

.monitor-mode--active {
  background: rgba(59, 132, 255, 0.2);
  color: #f5f9ff;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.monitor-shell__actions {
  display: flex;
  align-items: center;
  gap: 4px;
  -webkit-app-region: no-drag;
}

.monitor-action {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 24px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: rgba(215, 223, 239, 0.84);
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease;
}

.monitor-action:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #f3f7ff;
}

.monitor-action--active {
  color: #40b8ff;
}

.monitor-action--close:hover {
  background: rgba(255, 111, 125, 0.18);
  color: #ffd8dd;
}

.monitor-shell__body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  gap: 8px;
}

.monitor-shell__body:not(.monitor-shell__body--cpu-detail) {
  justify-content: center;
}

.monitor-shell__body--cpu-detail {
  gap: 6px;
  overflow-y: auto;
  padding-right: 2px;
  justify-content: flex-start;
}

.detail-glass-panel {
  position: relative;
  overflow: hidden;
  border: 1px solid rgba(101, 123, 160, 0.24);
  border-radius: 8px;
  background:
    radial-gradient(circle at top left, rgba(255, 255, 255, 0.04), transparent 34%),
    linear-gradient(180deg, rgba(22, 34, 53, 0.84), rgba(15, 24, 39, 0.82));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.05),
    0 14px 28px rgba(1, 7, 18, 0.16);
}

.detail-glass-panel::before {
  content: '';
  position: absolute;
  inset: -20% auto auto -12%;
  width: 140px;
  height: 140px;
  border-radius: 999px;
  opacity: 0.22;
  filter: blur(18px);
  pointer-events: none;
}

.detail-glass-panel--cpu::before {
  background: radial-gradient(circle, rgba(167, 117, 255, 0.68), transparent 70%);
}

.detail-glass-panel--gpu::before {
  background: radial-gradient(circle, rgba(143, 244, 255, 0.78), transparent 70%);
}

.metric-sparkline {
  width: 100%;
  height: 48px;
}

.metric-sparkline polygon {
  fill: var(--sparkline-fill);
  opacity: 0.18;
}

.metric-sparkline polyline {
  fill: none;
  stroke: var(--sparkline-stroke);
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.metric-sparkline__baseline {
  stroke: rgba(143, 244, 255, 0.28);
  stroke-width: 1.4;
  stroke-linecap: round;
}

.metric-sparkline__halo {
  fill: none;
  stroke: rgba(183, 251, 255, 0.55);
  stroke-width: 7;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0.62;
}

.metric-sparkline--cpu polygon {
  fill: var(--sparkline-fill, rgba(167, 117, 255, 0.22));
}

.metric-sparkline--cpu polyline {
  stroke: var(--sparkline-stroke, #a775ff);
}

.metric-sparkline--gpu polygon {
  fill: var(--sparkline-fill, rgba(143, 244, 255, 0.42));
  opacity: 0.36;
}

.metric-sparkline--gpu polyline {
  stroke: var(--sparkline-stroke, #8ff4ff);
  stroke-width: 3.6;
  filter: drop-shadow(0 0 6px rgba(143, 244, 255, 0.74));
}

.metric-sparkline--memory polygon {
  fill: var(--sparkline-fill, rgba(121, 216, 79, 0.22));
}

.metric-sparkline--memory polyline {
  stroke: var(--sparkline-stroke, #79d84f);
}

.cpu-detail-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  padding: 12px 14px;
}

.cpu-detail-metric {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding-right: 10px;
  border-right: 1px solid rgba(96, 116, 148, 0.18);
}

.cpu-detail-metric:last-child {
  padding-right: 0;
  border-right: 0;
}

.cpu-detail-metric__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;

  span {
    color: rgba(205, 216, 235, 0.76);
    font-size: 11px;
  }

  strong {
    color: #f7faff;
    font-size: 15px;
    font-weight: 700;
    line-height: 1;
  }
}

.cpu-detail-metric--cpu .cpu-detail-metric__head strong {
  color: #a775ff;
}

.cpu-detail-metric--temp .cpu-detail-metric__head strong {
  color: #88e85d;
}

.cpu-detail-metric--speed .cpu-detail-metric__head strong {
  color: #54b4ff;
}

.cpu-detail-metric--power .cpu-detail-metric__head strong {
  color: #ffae47;
}

.cpu-detail-metric--voltage .cpu-detail-metric__head strong {
  color: #b47cff;
}

.cpu-detail-metric--fan .cpu-detail-metric__head strong {
  color: #73c1ff;
}

.cpu-detail-metric--gpu .cpu-detail-metric__head strong {
  color: #79e7ff;
}

.cpu-detail-metric--memory .cpu-detail-metric__head strong {
  color: #b47cff;
}

.cpu-detail-sparkline {
  width: 100%;
  height: 36px;
}

.cpu-detail-sparkline polygon {
  opacity: 0.18;
}

.cpu-detail-sparkline polyline {
  fill: none;
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.cpu-detail-secondary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.cpu-detail-secondary--top {
  margin-bottom: 2px;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  padding: 10px 14px;
  gap: 0;
}

.cpu-detail-secondary__item {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
  padding: 3px 12px 3px 0;
  border-right: 1px solid rgba(96, 116, 148, 0.14);

  &:last-child {
    padding-right: 0;
    border-right: 0;
  }

  span {
    color: rgba(200, 212, 232, 0.72);
    font-size: 11px;
  }

  strong {
    color: #f5f8ff;
    font-size: 14px;
    font-weight: 700;
    line-height: 1.25;
  }
}

.detail-glass-panel--cpu .cpu-detail-secondary__item strong {
  color: #9ddfff;
}

.detail-glass-panel--gpu .cpu-detail-secondary__item strong {
  color: #b8f48c;
}

.cpu-detail-sparkline--cpu polygon {
  fill: rgba(167, 117, 255, 0.22);
}

.cpu-detail-sparkline--cpu polyline {
  stroke: #a775ff;
}

.cpu-detail-sparkline--temp polygon {
  fill: #79d84f;
}

.cpu-detail-sparkline--temp polyline {
  stroke: #79d84f;
}

.cpu-detail-sparkline--speed polygon {
  fill: #5aa8ff;
}

.cpu-detail-sparkline--speed polyline {
  stroke: #5aa8ff;
}

.cpu-detail-sparkline--memory polygon {
  fill: #b47cff;
}

.cpu-detail-sparkline--memory polyline {
  stroke: #b47cff;
}

.cpu-detail-sparkline--voltage polygon {
  fill: #b47cff;
}

.cpu-detail-sparkline--voltage polyline {
  stroke: #b47cff;
}

.cpu-detail-sparkline--power polygon {
  fill: #ffb14d;
}

.cpu-detail-sparkline--power polyline {
  stroke: #ffb14d;
}

.cpu-detail-sparkline--fan polygon {
  fill: #73c1ff;
}

.cpu-detail-sparkline--fan polyline {
  stroke: #73c1ff;
}

.metric-progress {
  position: relative;
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(62, 79, 110, 0.34);
}

.metric-progress--gpu {
  border: 1px solid rgba(143, 244, 255, 0.26);
  background:
    linear-gradient(90deg, rgba(143, 244, 255, 0.18), rgba(143, 244, 255, 0.07)),
    rgba(28, 58, 76, 0.42);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.035),
    0 0 14px rgba(143, 244, 255, 0.14);
}

.metric-progress__fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  box-shadow: 0 0 16px rgba(77, 178, 255, 0.22);
}

.metric-progress--gpu .metric-progress__fill {
  box-shadow:
    0 0 12px rgba(143, 244, 255, 0.6),
    0 0 24px rgba(47, 216, 255, 0.28);
}

.metric-side-item {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

.metric-side-list {
  display: grid;
  align-content: center;
  gap: 7px;
  min-width: 0;
}

.metric-side-list--columns-1 {
  grid-template-columns: minmax(0, 1fr);
}

.metric-side-list--columns-2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 10px;
  row-gap: 6px;
}

.metric-side-item__label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: rgba(205, 216, 235, 0.78);
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
}

.metric-side-item strong {
  display: block;
  color: var(--watch-card-strong, #f4f8ff);
  font-size: 14px;
  font-weight: 700;
  line-height: 1.1;
}

.metric-side-item__value--wrap {
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
  line-height: 1.2;
}

.monitor-shell__footer {
  padding: 2px 4px 1px;
  color: rgba(206, 215, 232, 0.86);
  font-size: 9px;
}

.monitor-shell__footer-meta,
.monitor-shell__footer-status {
  display: inline-flex;
  align-items: center;
  gap: 12px;
}

.monitor-shell__footer-status {
  gap: 7px;
  color: #39b8ff;
  font-weight: 600;
}

.monitor-shell__footer-pulse {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #39b8ff;
  box-shadow: 0 0 14px rgba(57, 184, 255, 0.7);
}

@media (max-width: 720px) {
  .monitor-shell__header {
    flex-wrap: wrap;
  }

  .cpu-detail-grid,
  .cpu-detail-secondary:not(.cpu-detail-secondary--top) {
    grid-template-columns: 1fr;
  }

  .cpu-detail-secondary--top {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px 12px;
  }

  .cpu-detail-metric {
    padding-right: 0;
    padding-bottom: 8px;
    border-right: 0;
    border-bottom: 1px solid rgba(96, 116, 148, 0.16);
  }

  .cpu-detail-metric:last-child {
    padding-bottom: 0;
    border-bottom: 0;
  }

  .cpu-detail-secondary--top {
    padding: 10px 12px;
  }

  .cpu-detail-secondary--top .cpu-detail-secondary__item {
    padding: 0 8px 0 0;
    border-right: 1px solid rgba(96, 116, 148, 0.14);
  }

  .cpu-detail-secondary--top .cpu-detail-secondary__item:nth-child(2n) {
    padding-right: 0;
    border-right: 0;
  }

  .cpu-detail-secondary--top .cpu-detail-secondary__item strong {
    font-size: 11px;
  }
}
</style>
