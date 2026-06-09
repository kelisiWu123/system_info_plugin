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
const cpuLoad = ref(0)
const cpuTemperature = ref<CpuTemperatureData>()
const cpuCurrentSpeed = ref<CpuCurrentSpeedData>()
const timeInfo = ref<TimeData>()
const pinned = ref(true)

const history = reactive({
  cpu: [] as number[],
  gpu: [] as number[],
  memory: [] as number[],
})

let fastTimerId: number | undefined
let slowTimerId: number | undefined

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

function formatRuntime(seconds?: number) {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return '--:--:--'
  const whole = Math.floor(seconds)
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const remainingSeconds = whole % 60
  return [hours, minutes, remainingSeconds].map((value) => String(value).padStart(2, '0')).join(':')
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

function progressBarStyle(percent: number, tone: string) {
  return {
    width: `${clampPercent(percent)}%`,
    background: tone,
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

const cpuTempValue = computed(() => {
  if (typeof cpuTemperature.value?.value === 'number') return cpuTemperature.value.value
  if (typeof cpuTemperature.value?.main === 'number') return cpuTemperature.value.main
  return null
})

const cpuFrequencyValue = computed(() => {
  const value = getDisplayCpuCurrentSpeedGHz(cpuCurrentSpeed.value)
  return value > 0 ? value : null
})

const gpuMemoryUsed = computed(() => {
  const gpu = primaryGpu.value
  if (!gpu) return null
  return typeof gpu.memoryUsed === 'number' && gpu.memoryUsed > 0 ? gpu.memoryUsed : null
})

const gpuName = computed(() => {
  const value = primaryGpu.value?.model || primaryGpu.value?.name || '未识别显卡'
  return value.length > 20 ? `${value.slice(0, 20)}...` : value
})

const footerStatus = computed(() => {
  if (cpuPercent.value || memoryPercent.value || gpuPercent.value) return '状态良好'
  if (!primaryGpu.value) return '未检测到显卡信息'
  return '部分指标暂不支持'
})

async function refreshFastMetrics() {
  try {
    const [cpuLoadRes, memoRes, cpuTemperatureRes, cpuSpeedRes, timeRes] = await Promise.allSettled([
      withTimeout(window.services.getCpuFullLoad()),
      withTimeout(window.services.getMemInfo()),
      withTimeout(window.services.getCpuTemperature(), 3500),
      withTimeout(window.services.getCpuCurrentSpeed(), 3500),
      withTimeout(window.services.getTimeInfo(), 3500),
    ])

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

    if (cpuTemperatureRes.status === 'fulfilled') {
      cpuTemperature.value = cpuTemperatureRes.value
    }

    if (cpuSpeedRes.status === 'fulfilled') {
      cpuCurrentSpeed.value = cpuSpeedRes.value
    }

    if (timeRes.status === 'fulfilled') {
      timeInfo.value = timeRes.value
    }
  } catch (error) {
    console.warn('悬浮监控快速刷新失败:', error)
  }
}

async function refreshSlowMetrics() {
  try {
    const gpuRes = await withTimeout(window.services.getGpuInfo(), 8000)
    gpuData.value = gpuRes
    clampHistory(history.gpu, gpuPercent.value)
  } catch (error) {
    console.warn('悬浮监控显卡刷新失败:', error)
  }
}

function stopPolling() {
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

  await refreshFastMetrics()
  await refreshSlowMetrics()

  fastTimerId = window.setInterval(() => {
    refreshFastMetrics()
  }, 1000)

  slowTimerId = window.setInterval(() => {
    refreshSlowMetrics()
  }, 1500)
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

      <div class="monitor-shell__body">
        <WatchRow tone="cpu">
          <template #icon>
            <Cpu theme="outline" size="24" fill="#35b6ff" :strokeWidth="3" />
          </template>
          <template #title>CPU</template>
          <template #subtitle>使用率</template>
          <template #value>{{ formatPercent(cpuPercent) }}</template>
          <template #chart>
            <svg class="metric-sparkline metric-sparkline--cpu" viewBox="0 0 238 64" preserveAspectRatio="none">
              <polygon :points="sparklineArea(history.cpu)" />
              <polyline :points="sparklinePoints(history.cpu)" />
            </svg>
          </template>
          <template #bar>
            <div class="metric-progress">
              <span class="metric-progress__fill" :style="progressBarStyle(cpuPercent, 'linear-gradient(90deg, #33b8ff, #4bd7ff)')" />
            </div>
          </template>
          <template #side>
            <div class="metric-side-item">
              <div class="metric-side-item__label">
                <Thermometer theme="outline" size="13" fill="currentColor" :strokeWidth="3" />
                <span>温度</span>
              </div>
              <strong>{{ formatTemperature(cpuTempValue) }}</strong>
            </div>
            <div class="metric-side-item">
              <div class="metric-side-item__label">
                <DashboardOne theme="outline" size="13" fill="currentColor" :strokeWidth="3" />
                <span>频率</span>
              </div>
              <strong>{{ formatFrequencyGHz(cpuFrequencyValue) }}</strong>
            </div>
          </template>
        </WatchRow>

        <WatchRow tone="gpu">
          <template #icon>
            <GraphicDesign theme="outline" size="24" fill="#83df55" :strokeWidth="3" />
          </template>
          <template #title>GPU</template>
          <template #subtitle>{{ gpuName }}</template>
          <template #value>{{ formatPercent(gpuPercent) }}</template>
          <template #chart>
            <svg class="metric-sparkline metric-sparkline--gpu" viewBox="0 0 238 64" preserveAspectRatio="none">
              <polygon :points="sparklineArea(history.gpu)" />
              <polyline :points="sparklinePoints(history.gpu)" />
            </svg>
          </template>
          <template #bar>
            <div class="metric-progress">
              <span class="metric-progress__fill" :style="progressBarStyle(gpuPercent, 'linear-gradient(90deg, #70d646, #9cf165)')" />
            </div>
          </template>
          <template #side>
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
                <span>显存</span>
              </div>
              <strong>{{ formatGigabytesFromMegabytes(gpuMemoryUsed) }}</strong>
            </div>
          </template>
        </WatchRow>

        <WatchRow tone="memory">
          <template #icon>
            <Memory theme="outline" size="24" fill="#a775ff" :strokeWidth="3" />
          </template>
          <template #title>内存</template>
          <template #subtitle>使用率</template>
          <template #value>{{ formatPercent(memoryPercent) }}</template>
          <template #chart>
            <svg class="metric-sparkline metric-sparkline--memory" viewBox="0 0 238 64" preserveAspectRatio="none">
              <polygon :points="sparklineArea(history.memory)" />
              <polyline :points="sparklinePoints(history.memory)" />
            </svg>
          </template>
          <template #bar>
            <div class="metric-progress">
              <span class="metric-progress__fill" :style="progressBarStyle(memoryPercent, 'linear-gradient(90deg, #9568ff, #b98dff)')" />
            </div>
          </template>
          <template #side>
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
              <strong>{{ memoData.normalizedPlatform === 'darwin' ? memoryPressureLabel : formatGigabytesFromBytes(memoData.total, 0) }}</strong>
            </div>
          </template>
        </WatchRow>
      </div>

      <footer class="monitor-shell__footer">
        <div class="monitor-shell__footer-meta">
          <span>运行时间 {{ formatRuntime(timeInfo?.uptime) }}</span>
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
  gap: 12px;
  padding: 14px 15px 13px;
  border: 1px solid rgba(210, 223, 248, 0.34);
  border-radius: 26px;
  background:
    radial-gradient(circle at top left, rgba(53, 119, 255, 0.2), transparent 30%),
    linear-gradient(180deg, rgba(27, 45, 79, 0.82), rgba(13, 22, 40, 0.8));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.22),
    0 22px 44px rgba(1, 8, 18, 0.4);
  backdrop-filter: blur(24px);
}

.monitor-shell__header,
.monitor-shell__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.monitor-shell__header {
  padding: 2px 2px 10px;
  border-bottom: 1px solid rgba(129, 149, 183, 0.2);
  -webkit-app-region: drag;
}

.monitor-shell__brand {
  display: flex;
  align-items: center;
  gap: 9px;
  color: rgba(236, 242, 251, 0.96);
  font-size: 12px;
  font-weight: 600;
}

.monitor-shell__brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 8px;
  background: linear-gradient(180deg, rgba(95, 149, 255, 0.92), rgba(56, 103, 255, 0.76));
  color: #f6f9ff;
  font-size: 10px;
  font-weight: 800;
  box-shadow: 0 10px 20px rgba(48, 92, 255, 0.26);
}

.monitor-shell__actions {
  display: flex;
  align-items: center;
  gap: 6px;
  -webkit-app-region: no-drag;
}

.monitor-action {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 28px;
  border: 0;
  border-radius: 8px;
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
  gap: 10px;
}

.metric-sparkline {
  width: 100%;
  height: 56px;
}

.metric-sparkline polygon {
  opacity: 0.18;
}

.metric-sparkline polyline {
  fill: none;
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.metric-sparkline--cpu polygon {
  fill: #35b6ff;
}

.metric-sparkline--cpu polyline {
  stroke: #35b6ff;
}

.metric-sparkline--gpu polygon {
  fill: #83df55;
}

.metric-sparkline--gpu polyline {
  stroke: #83df55;
}

.metric-sparkline--memory polygon {
  fill: #a775ff;
}

.metric-sparkline--memory polyline {
  stroke: #a775ff;
}

.metric-progress {
  position: relative;
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(62, 79, 110, 0.28);
}

.metric-progress__fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  box-shadow: 0 0 16px rgba(77, 178, 255, 0.22);
}

.metric-side-item {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

.metric-side-item__label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: rgba(205, 216, 235, 0.78);
  font-size: 11px;
  line-height: 1;
}

.metric-side-item strong {
  color: #f4f8ff;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.1;
}

.monitor-shell__footer {
  padding: 0 4px 2px;
  color: rgba(206, 215, 232, 0.86);
  font-size: 10px;
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
</style>
