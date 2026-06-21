import { computed, reactive, ref } from 'vue'
import {
  DEFAULT_MONITORING_REFRESH_SETTINGS,
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

const fetchState = reactive<Record<GraphicsServiceKey, { status: FetchStatus; note: string }>>({
  gpuInfo: { status: 'pending', note: '' },
  displaysData: { status: 'pending', note: '' },
  boardData: { status: 'pending', note: '' },
  biosData: { status: 'pending', note: '' },
  osInfo: { status: 'pending', note: '' },
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

function setFetchState(key: GraphicsServiceKey, status: FetchStatus, note = '') {
  fetchState[key].status = status
  fetchState[key].note = note
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
  const nextValue = resolveMonitoringBackgroundThrottled(monitoringRefreshSettings.value.backgroundThrottleEnabled)
  if (backgroundThrottled.value === nextValue) return
  backgroundThrottled.value = nextValue
  restartPolling()
}

function syncMonitoringVisibility() {
  visibilityListenersBound = bindMonitoringVisibilityListeners(visibilityListenersBound, updateBackgroundThrottled)
  backgroundThrottled.value = resolveMonitoringBackgroundThrottled(monitoringRefreshSettings.value.backgroundThrottleEnabled)
}

async function ensureMonitoringRefreshSettingsLoaded() {
  if (refreshSettingsPromise) return refreshSettingsPromise

  refreshSettingsPromise = (async () => {
    try {
      monitoringRefreshSettings.value = await window.services.getMonitoringRefreshSettings()
    } catch {
      monitoringRefreshSettings.value = { ...DEFAULT_MONITORING_REFRESH_SETTINGS }
    }
    backgroundThrottled.value = resolveMonitoringBackgroundThrottled(monitoringRefreshSettings.value.backgroundThrottleEnabled)
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

      try {
        const gpuRes = await readService(() => window.services.getGpuInfo(), 15000)
        gpuData.value = gpuRes || []
        setFetchState('gpuInfo', gpuData.value.length ? 'ok' : 'missing', gpuData.value.length ? '' : '返回空数组')
      } catch (error) {
        setFetchState('gpuInfo', 'error', normalizeErrorMessage(error))
        throw error
      }

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

    await refreshGraphicsDynamicMetrics(true)
  } finally {
    initialized.value = true
    loading.value = false
  }
}

export async function activateGraphicsHardwareStore() {
  subscriberCount += 1
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

  await ensureMonitoringRefreshSettingsLoaded()
  startPolling()
}

export async function refreshGraphicsHardwareData() {
  if (!initialized.value) {
    if (!initPromise) {
      initPromise = initGraphicsHardwareData().finally(() => {
        initPromise = undefined
      })
    }

    await initPromise
    return
  }

  await refreshGraphicsDynamicMetrics(true)
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
  fetchState,
  monitoringRefreshSettings,
  backgroundThrottled,
  diagnostics: diagnostics.state,
  primaryGpu,
}
