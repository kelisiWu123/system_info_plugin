import { computed, reactive, ref } from 'vue'
import {
  DEFAULT_MONITORING_REFRESH_SETTINGS,
  appendMetricHistory,
  createMonitoringDiagnostics,
  getMonitoringRefreshIntervals,
} from '../utils/monitoring'
import { selectPrimaryGpu } from '../utils/gpu'

type GraphicsMetricHistoryKey = 'gpuLoad' | 'gpuTemp' | 'gpuClock' | 'gpuMemory' | 'gpuPower'

const loading = ref(true)
const initialized = ref(false)
const lastSyncedAt = ref<number>()
const monitoringRefreshSettings = ref<MonitoringRefreshSettingsData>({ ...DEFAULT_MONITORING_REFRESH_SETTINGS })
const backgroundThrottled = ref(false)

const gpuData = ref<GpuData[]>([])
const displaysData = ref<DisplayData[]>([])
const boardData = ref<BoardData>()
const biosData = ref<BiosInfoData>()
const osInfo = ref<OsInfoData>()

const metricHistory = reactive<Record<GraphicsMetricHistoryKey, number[]>>({
  gpuLoad: [],
  gpuTemp: [],
  gpuClock: [],
  gpuMemory: [],
  gpuPower: [],
})

const primaryGpu = computed(() => selectPrimaryGpu(gpuData.value))

let initPromise: Promise<void> | undefined
let refreshSettingsPromise: Promise<void> | undefined
let refreshInFlight: Promise<void> | undefined
let pollingTimerId: number | undefined
let subscriberCount = 0
let lastGpuRefreshAt = 0
let visibilityListenersBound = false
const diagnostics = createMonitoringDiagnostics('graphics')

function withTimeout<T>(promise: Promise<T>, timeout = 8000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error('读取超时')), timeout)
    }),
  ])
}

async function readService<T>(reader: () => Promise<T>, timeout = 8000, retries = 0): Promise<T> {
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await withTimeout(reader(), timeout)
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error ? lastError : new Error('读取失败')
}

function resolveBackgroundThrottled() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return false
  if (!monitoringRefreshSettings.value.backgroundThrottleEnabled) return false

  const visible = !document.hidden && document.visibilityState !== 'hidden'
  const focused = typeof document.hasFocus === 'function' ? document.hasFocus() : true
  return !(visible && focused)
}

function getCurrentRefreshIntervals() {
  return getMonitoringRefreshIntervals(monitoringRefreshSettings.value.profile, backgroundThrottled.value)
}

function hasActiveRefreshIntervals() {
  return getCurrentRefreshIntervals().gpu > 0
}

function stopPolling() {
  if (!pollingTimerId) return
  window.clearTimeout(pollingTimerId)
  pollingTimerId = undefined
}

function startPolling() {
  if (pollingTimerId || subscriberCount <= 0 || !hasActiveRefreshIntervals()) return

  if (!lastSyncedAt.value || Date.now() - lastSyncedAt.value > getCurrentRefreshIntervals().base) {
    refreshGraphicsDynamicMetrics()
  }

  const scheduleNext = () => {
    if (subscriberCount <= 0 || !hasActiveRefreshIntervals()) {
      pollingTimerId = undefined
      return
    }

    pollingTimerId = window.setTimeout(async () => {
      pollingTimerId = undefined
      await refreshGraphicsDynamicMetrics()
      scheduleNext()
    }, getCurrentRefreshIntervals().base)
  }

  scheduleNext()
}

function restartPolling() {
  stopPolling()
  startPolling()
}

function updateBackgroundThrottled() {
  const nextValue = resolveBackgroundThrottled()
  if (backgroundThrottled.value === nextValue) return
  backgroundThrottled.value = nextValue
  restartPolling()
}

function bindVisibilityListeners() {
  if (visibilityListenersBound || typeof window === 'undefined' || typeof document === 'undefined') return

  const handleVisibilityChange = () => updateBackgroundThrottled()
  window.addEventListener('focus', handleVisibilityChange)
  window.addEventListener('blur', handleVisibilityChange)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  visibilityListenersBound = true
  backgroundThrottled.value = resolveBackgroundThrottled()
}

async function ensureMonitoringRefreshSettingsLoaded() {
  if (refreshSettingsPromise) return refreshSettingsPromise

  refreshSettingsPromise = (async () => {
    try {
      monitoringRefreshSettings.value = await window.services.getMonitoringRefreshSettings()
    } catch {
      monitoringRefreshSettings.value = { ...DEFAULT_MONITORING_REFRESH_SETTINGS }
    }
    backgroundThrottled.value = resolveBackgroundThrottled()
  })().finally(() => {
    refreshSettingsPromise = undefined
  })

  return refreshSettingsPromise
}

async function refreshGraphicsDynamicMetrics(force = false) {
  if (refreshInFlight) return refreshInFlight

  refreshInFlight = (async () => {
    try {
      const intervals = getCurrentRefreshIntervals()
      diagnostics.markRefreshAttempt(force, backgroundThrottled.value)
      if (!force && intervals.gpu <= 0) {
        diagnostics.markRefreshSkipped('background-paused', backgroundThrottled.value)
        return
      }

      const now = Date.now()
      const needsGpu = intervals.gpu > 0 && (force || now - lastGpuRefreshAt >= intervals.gpu)
      if (!needsGpu) {
        diagnostics.markRefreshSkipped('not-due', backgroundThrottled.value)
        return
      }

      const gpuRes = await readService(() => window.services.getGpuInfo(), 15000)
      gpuData.value = gpuRes || []

      const nextPrimaryGpu = selectPrimaryGpu(gpuData.value)
      appendMetricHistory(metricHistory.gpuTemp, nextPrimaryGpu?.temperatureGpu || 0)
      appendMetricHistory(metricHistory.gpuLoad, nextPrimaryGpu?.utilizationGpu || 0, true)
      appendMetricHistory(metricHistory.gpuClock, nextPrimaryGpu?.clockCore || 0)
      appendMetricHistory(metricHistory.gpuMemory, nextPrimaryGpu?.memoryUsed || 0)
      appendMetricHistory(metricHistory.gpuPower, nextPrimaryGpu?.powerDraw || 0)

      lastGpuRefreshAt = now
      lastSyncedAt.value = Date.now()
      diagnostics.markRefreshSuccess(backgroundThrottled.value)
    } finally {
      refreshInFlight = undefined
    }
  })()

  return refreshInFlight
}

async function initGraphicsHardwareData() {
  try {
    const [boardRes, biosRes, osRes, displaysRes] = await Promise.allSettled([
      readService(() => window.services.getBoardData(), 8000, 1),
      readService(() => window.services.getBiosData(), 10000, 1),
      readService(() => window.services.getOsInfo(), 8000, 1),
      readService(() => window.services.getDisplaysData(), 12000, 1),
    ])

    if (boardRes.status === 'fulfilled') boardData.value = boardRes.value
    if (biosRes.status === 'fulfilled') biosData.value = biosRes.value
    if (osRes.status === 'fulfilled') osInfo.value = osRes.value
    if (displaysRes.status === 'fulfilled') displaysData.value = displaysRes.value || []

    await refreshGraphicsDynamicMetrics(true)
  } finally {
    initialized.value = true
    loading.value = false
  }
}

export async function activateGraphicsHardwareStore() {
  subscriberCount += 1
  diagnostics.markActivated(subscriberCount)
  bindVisibilityListeners()

  if (!initialized.value) {
    if (!initPromise) {
      initPromise = initGraphicsHardwareData().finally(() => {
        initPromise = undefined
      })
    }

    await initPromise
  }

  await ensureMonitoringRefreshSettingsLoaded()
  startPolling()
}

export function deactivateGraphicsHardwareStore() {
  subscriberCount = Math.max(0, subscriberCount - 1)
  diagnostics.markDeactivated(subscriberCount)

  if (subscriberCount <= 0) {
    stopPolling()
    return
  }

  restartPolling()
}

export const graphicsHardwareStore = {
  loading,
  initialized,
  lastSyncedAt,
  gpuData,
  displaysData,
  boardData,
  biosData,
  osInfo,
  metricHistory,
  monitoringRefreshSettings,
  backgroundThrottled,
  diagnostics: diagnostics.state,
  primaryGpu,
}
