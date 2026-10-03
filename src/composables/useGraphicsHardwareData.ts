import { subscribeHardwareMetrics, hasSharedHardwareTelemetry, refreshSharedHardwareMetrics, isOlderMetricSample } from '../utils/metricRefresh'
import { computed, reactive, ref } from 'vue'
import {
  appendMetricHistory,
  createMonitoringDiagnostics,
  getMonitoringRefreshIntervals,
} from '../utils/monitoring'
import { selectPrimaryGpu } from '../utils/gpu'
import { bindMonitoringVisibilityListeners, resolveMonitoringBackgroundThrottled } from '../utils/monitoringVisibility'
import { normalizeErrorMessage, readService } from '../utils/serviceReader'

type GraphicsMetricHistoryKey = 'gpuLoad' | 'gpuTemp' | 'gpuClock' | 'gpuMemory' | 'gpuPower'
type FetchStatus = 'pending' | 'ok' | 'missing' | 'error'
type GraphicsServiceKey = 'gpuInfo' | 'displaysData' | 'boardData' | 'biosData' | 'osInfo'

const loading = ref(true)
const initialized = ref(false)
const lastSyncedAt = ref<number>()
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

const fetchState = reactive<Record<GraphicsServiceKey, { status: FetchStatus; note: string }>>({
  gpuInfo: { status: 'pending', note: '' },
  displaysData: { status: 'pending', note: '' },
  boardData: { status: 'pending', note: '' },
  biosData: { status: 'pending', note: '' },
  osInfo: { status: 'pending', note: '' },
})

const primaryGpu = computed(() => selectPrimaryGpu(gpuData.value))

let initPromise: Promise<void> | undefined
let refreshInFlight: Promise<void> | undefined
let pollingTimerId: number | undefined
let subscriberCount = 0
let lastGpuRefreshAt = 0
let visibilityListenersBound = false
const diagnostics = createMonitoringDiagnostics('graphics')

let stopSharedTelemetry: (() => void) | undefined
function subscribeGraphicsTelemetry() {
  if (stopSharedTelemetry) return
  stopSharedTelemetry = subscribeHardwareMetrics({ gpu: (value, at) => {
    gpuData.value = value
    setFetchState('gpuInfo', value.length ? 'ok' : 'missing', '')
    lastSyncedAt.value = at
    appendMetricHistory(metricHistory.gpuLoad, primaryGpu.value?.utilizationGpu ?? 0, true, 24, at)
    appendMetricHistory(metricHistory.gpuTemp, primaryGpu.value?.temperatureGpu ?? 0, false, 24, at)
    appendMetricHistory(metricHistory.gpuPower, primaryGpu.value?.powerDraw ?? 0, false, 24, at)
    appendMetricHistory(metricHistory.gpuMemory, primaryGpu.value?.memoryUsed ?? 0, false, 24, at)
    appendMetricHistory(metricHistory.gpuClock, primaryGpu.value?.clockCore ?? 0, false, 24, at)
  } }, (_, error) => setFetchState('gpuInfo', 'error', error))
}

function setFetchState(key: GraphicsServiceKey, status: FetchStatus, note = '') {
  fetchState[key].status = status
  fetchState[key].note = note
}

function getCurrentRefreshIntervals() {
  return getMonitoringRefreshIntervals('balanced', backgroundThrottled.value)
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
  if (hasSharedHardwareTelemetry()) return
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
      try {
        await refreshGraphicsDynamicMetrics()
      } catch (error) {
        console.error('显卡轮询失败:', error)
      } finally {
        scheduleNext()
      }
    }, getCurrentRefreshIntervals().base)
  }

  scheduleNext()
}

function restartPolling() {
  stopPolling()
  startPolling()
}

function updateBackgroundThrottled() {
  const nextValue = resolveMonitoringBackgroundThrottled(true)
  if (backgroundThrottled.value === nextValue) return
  backgroundThrottled.value = nextValue
  restartPolling()
}

function syncMonitoringVisibility() {
  visibilityListenersBound = bindMonitoringVisibilityListeners(visibilityListenersBound, updateBackgroundThrottled)
  backgroundThrottled.value = resolveMonitoringBackgroundThrottled(true)
}

async function refreshGraphicsDynamicMetrics(force = false) {
  if (hasSharedHardwareTelemetry()) return
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

      try {
        const gpuRes = await readService(() => window.services.getGpuInfo(), 15000)
        if (isOlderMetricSample(gpuRes, gpuData.value)) return
        gpuData.value = gpuRes || []
        setFetchState('gpuInfo', gpuData.value.length ? 'ok' : 'missing', gpuData.value.length ? '' : '返回空数组')
      } catch (error) {
        setFetchState('gpuInfo', 'error', normalizeErrorMessage(error))
        diagnostics.markRefreshSkipped('gpu-read-failed', backgroundThrottled.value)
        return
      }

      const nextPrimaryGpu = selectPrimaryGpu(gpuData.value)
      appendMetricHistory(metricHistory.gpuTemp, nextPrimaryGpu?.temperatureGpu || 0, false, 24, nextPrimaryGpu?.sampledAt)
      appendMetricHistory(metricHistory.gpuLoad, nextPrimaryGpu?.utilizationGpu || 0, true, 24, nextPrimaryGpu?.sampledAt)
      appendMetricHistory(metricHistory.gpuClock, nextPrimaryGpu?.clockCore || 0, false, 24, nextPrimaryGpu?.sampledAt)
      appendMetricHistory(metricHistory.gpuMemory, nextPrimaryGpu?.memoryUsed || 0, false, 24, nextPrimaryGpu?.sampledAt)
      appendMetricHistory(metricHistory.gpuPower, nextPrimaryGpu?.powerDraw || 0, false, 24, nextPrimaryGpu?.sampledAt)

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

    if (boardRes.status === 'fulfilled') {
      boardData.value = boardRes.value
      setFetchState('boardData', boardRes.value ? 'ok' : 'missing', boardRes.value ? '' : '返回为空')
    } else {
      setFetchState('boardData', 'error', normalizeErrorMessage(boardRes.reason))
    }

    if (biosRes.status === 'fulfilled') {
      biosData.value = biosRes.value
      setFetchState('biosData', biosRes.value ? 'ok' : 'missing', biosRes.value ? '' : '返回为空')
    } else {
      setFetchState('biosData', 'error', normalizeErrorMessage(biosRes.reason))
    }

    if (osRes.status === 'fulfilled') {
      osInfo.value = osRes.value
      setFetchState('osInfo', osRes.value ? 'ok' : 'missing', osRes.value ? '' : '返回为空')
    } else {
      setFetchState('osInfo', 'error', normalizeErrorMessage(osRes.reason))
    }

    if (displaysRes.status === 'fulfilled') {
      displaysData.value = displaysRes.value || []
      setFetchState('displaysData', displaysData.value.length ? 'ok' : 'missing', displaysData.value.length ? '' : '返回空数组')
    } else {
      setFetchState('displaysData', 'error', normalizeErrorMessage(displaysRes.reason))
    }

    loading.value = false
    await refreshGraphicsDynamicMetrics(true)
  } finally {
    initialized.value = true
    loading.value = false
  }
}

export async function activateGraphicsHardwareStore() {
  subscriberCount += 1
  subscribeGraphicsTelemetry()
  diagnostics.markActivated(subscriberCount)
  syncMonitoringVisibility()

  if (!initialized.value) {
    if (!initPromise) {
      initPromise = initGraphicsHardwareData().finally(() => {
        initPromise = undefined
      })
    }

    await initPromise
  }

  startPolling()
}

export async function refreshGraphicsHardwareData() {
  window.services.invalidateHardwareInfoCache?.(['boardData', 'biosData', 'osInfo', 'displaysData'])
  await refreshSharedHardwareMetrics(['gpu'])
  if (initPromise) await initPromise
  if (!initPromise) {
    initPromise = initGraphicsHardwareData().finally(() => { initPromise = undefined })
  }
  await initPromise
}

export function deactivateGraphicsHardwareStore() {
  subscriberCount = Math.max(0, subscriberCount - 1)
  diagnostics.markDeactivated(subscriberCount)

  if (subscriberCount <= 0) {
    stopSharedTelemetry?.()
    stopSharedTelemetry = undefined
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
  fetchState,
  backgroundThrottled,
  diagnostics: diagnostics.state,
  primaryGpu,
}
