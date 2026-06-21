import { reactive, ref } from 'vue'
import {
  DEFAULT_MONITORING_REFRESH_SETTINGS,
  appendMetricHistory,
  createMonitoringDiagnostics,
  getMonitoringRefreshIntervals,
} from '../utils/monitoring'
import { getDisplayCpuCurrentSpeedGHz } from '../utils'
import { bindMonitoringVisibilityListeners, resolveMonitoringBackgroundThrottled } from '../utils/monitoringVisibility'
import { normalizeErrorMessage, readService } from '../utils/serviceReader'

type ProcessorMetricHistoryKey = 'cpuLoad' | 'cpuTemp' | 'cpuSpeed' | 'cpuVoltage' | 'cpuPower'
type FetchStatus = 'pending' | 'ok' | 'missing' | 'error'
type ProcessorServiceKey =
  | 'cpuInfo'
  | 'cpuTemperature'
  | 'cpuLoadData'
  | 'cpuCurrentSpeed'
  | 'cpuPower'
  | 'cpuVoltage'
  | 'cpuFanSpeed'
  | 'boardData'
  | 'biosData'
  | 'osInfo'
  | 'timeInfo'

const emptyCurrentLoadData: CurrentLoadData = {
  avgLoad: 0,
  currentLoad: 0,
  currentLoadUser: 0,
  currentLoadSystem: 0,
  currentLoadNice: 0,
  currentLoadIdle: 0,
  currentLoadIrq: 0,
  currentLoadSteal: 0,
  currentLoadGuest: 0,
  rawCurrentLoad: 0,
  rawCurrentLoadUser: 0,
  rawCurrentLoadSystem: 0,
  rawCurrentLoadNice: 0,
  rawCurrentLoadIdle: 0,
  rawCurrentLoadIrq: 0,
  rawCurrentLoadSteal: 0,
  rawCurrentLoadGuest: 0,
  cpus: [],
}

const emptyCpuCurrentSpeedData: CpuCurrentSpeedData = {
  min: 0,
  max: 0,
  avg: 0,
  cores: [],
}

const loading = ref(true)
const initialized = ref(false)
const lastSyncedAt = ref<number>()
const monitoringRefreshSettings = ref<MonitoringRefreshSettingsData>({ ...DEFAULT_MONITORING_REFRESH_SETTINGS })
const backgroundThrottled = ref(false)

const cpuData = ref<CpuData>()
const cpuTemperature = ref<CpuTemperatureData>()
const cpuLoadData = ref<CurrentLoadData>(emptyCurrentLoadData)
const cpuCurrentSpeed = ref<CpuCurrentSpeedData>(emptyCpuCurrentSpeedData)
const cpuPower = ref<CpuPowerData>()
const cpuVoltage = ref<CpuVoltageData>()
const cpuFanSpeed = ref<CpuFanData>()
const boardData = ref<BoardData>()
const biosData = ref<BiosInfoData>()
const osInfo = ref<OsInfoData>()
const timeInfo = ref<TimeData>()

const metricHistory = reactive<Record<ProcessorMetricHistoryKey, number[]>>({
  cpuLoad: [],
  cpuTemp: [],
  cpuSpeed: [],
  cpuVoltage: [],
  cpuPower: [],
})

const fetchState = reactive<Record<ProcessorServiceKey, { status: FetchStatus; note: string }>>({
  cpuInfo: { status: 'pending', note: '' },
  cpuTemperature: { status: 'pending', note: '' },
  cpuLoadData: { status: 'pending', note: '' },
  cpuCurrentSpeed: { status: 'pending', note: '' },
  cpuPower: { status: 'pending', note: '' },
  cpuVoltage: { status: 'pending', note: '' },
  cpuFanSpeed: { status: 'pending', note: '' },
  boardData: { status: 'pending', note: '' },
  biosData: { status: 'pending', note: '' },
  osInfo: { status: 'pending', note: '' },
  timeInfo: { status: 'pending', note: '' },
})

let initPromise: Promise<void> | undefined
let refreshSettingsPromise: Promise<void> | undefined
let refreshInFlight: Promise<void> | undefined
let pollingTimerId: number | undefined
let subscriberCount = 0
let lastCpuTempRefreshAt = 0
let lastCpuLoadRefreshAt = 0
let lastCpuSpeedRefreshAt = 0
let lastCpuAuxRefreshAt = 0
let lastTimeRefreshAt = 0
let visibilityListenersBound = false
const diagnostics = createMonitoringDiagnostics('processor')

function setFetchState(key: ProcessorServiceKey, status: FetchStatus, note = '') {
  fetchState[key].status = status
  fetchState[key].note = note
}

function getCurrentRefreshIntervals() {
  return getMonitoringRefreshIntervals(monitoringRefreshSettings.value.profile, backgroundThrottled.value)
}

function hasActiveRefreshIntervals() {
  const intervals = getCurrentRefreshIntervals()
  return intervals.cpuTemp > 0 || intervals.cpuLoadDetail > 0 || intervals.cpuSpeed > 0 || intervals.cpuAux > 0 || intervals.time > 0
}

function stopPolling() {
  if (!pollingTimerId) return
  window.clearTimeout(pollingTimerId)
  pollingTimerId = undefined
}

function startPolling() {
  if (pollingTimerId || subscriberCount <= 0 || !hasActiveRefreshIntervals()) return

  if (!lastSyncedAt.value || Date.now() - lastSyncedAt.value > getCurrentRefreshIntervals().base) {
    refreshProcessorDynamicMetrics()
  }

  const scheduleNext = () => {
    if (subscriberCount <= 0 || !hasActiveRefreshIntervals()) {
      pollingTimerId = undefined
      return
    }

    pollingTimerId = window.setTimeout(async () => {
      pollingTimerId = undefined
      await refreshProcessorDynamicMetrics()
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

async function refreshProcessorDynamicMetrics(force = false) {
  if (refreshInFlight) return refreshInFlight

  refreshInFlight = (async () => {
    try {
      const intervals = getCurrentRefreshIntervals()
      diagnostics.markRefreshAttempt(force, backgroundThrottled.value)
      if (!force && !hasActiveRefreshIntervals()) {
        diagnostics.markRefreshSkipped('background-paused', backgroundThrottled.value)
        return
      }

      const now = Date.now()
      const needsCpuTemp = intervals.cpuTemp > 0 && (force || now - lastCpuTempRefreshAt >= intervals.cpuTemp)
      const needsCpuLoad = intervals.cpuLoadDetail > 0 && (force || now - lastCpuLoadRefreshAt >= intervals.cpuLoadDetail)
      const needsCpuSpeed = intervals.cpuSpeed > 0 && (force || now - lastCpuSpeedRefreshAt >= intervals.cpuSpeed)
      const needsCpuAux = intervals.cpuAux > 0 && (force || now - lastCpuAuxRefreshAt >= intervals.cpuAux)
      const needsTime = intervals.time > 0 && (force || now - lastTimeRefreshAt >= intervals.time)

      if (!force && !needsCpuTemp && !needsCpuLoad && !needsCpuSpeed && !needsCpuAux && !needsTime) {
        diagnostics.markRefreshSkipped('not-due', backgroundThrottled.value)
        return
      }

      const [temperatureRes, cpuLoadRes, cpuSpeedRes, cpuPowerRes, cpuVoltageRes, cpuFanRes, timeRes] = await Promise.allSettled([
        needsCpuTemp ? readService(() => window.services.getCpuTemperature(), 9000) : Promise.resolve(undefined),
        needsCpuLoad ? readService(() => window.services.getCpuLoadData(), 7000) : Promise.resolve(undefined),
        needsCpuSpeed ? readService(() => window.services.getCpuCurrentSpeed(), 7000) : Promise.resolve(undefined),
        needsCpuAux ? readService(() => window.services.getCpuPower(), 7000) : Promise.resolve(undefined),
        needsCpuAux ? readService(() => window.services.getCpuVoltage(), 7000) : Promise.resolve(undefined),
        needsCpuAux ? readService(() => window.services.getCpuFanSpeed(), 7000) : Promise.resolve(undefined),
        needsTime ? readService(() => window.services.getTimeInfo(), 6000) : Promise.resolve(undefined),
      ])

      let hasUpdatedDynamicMetric = false

      if (needsCpuTemp && temperatureRes.status === 'fulfilled') {
        cpuTemperature.value = temperatureRes.value
        const nextCpuTemperatureValue =
          typeof temperatureRes.value?.value === 'number'
            ? temperatureRes.value.value
            : typeof temperatureRes.value?.main === 'number'
              ? temperatureRes.value.main
              : 0
        setFetchState(
          'cpuTemperature',
          nextCpuTemperatureValue > 0 || temperatureRes.value?.source === 'unsupported' ? 'ok' : 'missing',
          nextCpuTemperatureValue > 0 ? '' : temperatureRes.value?.message || temperatureRes.value?.errorCode || 'main 为空'
        )
        appendMetricHistory(metricHistory.cpuTemp, nextCpuTemperatureValue)
        lastCpuTempRefreshAt = now
        hasUpdatedDynamicMetric = true
      } else if (needsCpuTemp && temperatureRes.status === 'rejected') {
        setFetchState('cpuTemperature', 'error', normalizeErrorMessage(temperatureRes.reason))
      }

      if (needsCpuLoad && cpuLoadRes.status === 'fulfilled') {
        cpuLoadData.value = cpuLoadRes.value || emptyCurrentLoadData
        setFetchState('cpuLoadData', cpuLoadRes.value ? 'ok' : 'missing', cpuLoadRes.value ? '' : '返回为空')
        appendMetricHistory(metricHistory.cpuLoad, cpuLoadData.value.currentLoad || 0, true)
        lastCpuLoadRefreshAt = now
        hasUpdatedDynamicMetric = true
      } else if (needsCpuLoad && cpuLoadRes.status === 'rejected') {
        setFetchState('cpuLoadData', 'error', normalizeErrorMessage(cpuLoadRes.reason))
      }

      if (needsCpuSpeed && cpuSpeedRes.status === 'fulfilled') {
        cpuCurrentSpeed.value = cpuSpeedRes.value || emptyCpuCurrentSpeedData
        setFetchState('cpuCurrentSpeed', cpuSpeedRes.value ? 'ok' : 'missing', cpuSpeedRes.value ? '' : '返回为空')
        appendMetricHistory(metricHistory.cpuSpeed, getDisplayCpuCurrentSpeedGHz(cpuCurrentSpeed.value))
        lastCpuSpeedRefreshAt = now
        hasUpdatedDynamicMetric = true
      } else if (needsCpuSpeed && cpuSpeedRes.status === 'rejected') {
        setFetchState('cpuCurrentSpeed', 'error', normalizeErrorMessage(cpuSpeedRes.reason))
      }

      if (needsCpuAux && cpuPowerRes.status === 'fulfilled') {
        cpuPower.value = cpuPowerRes.value
        setFetchState('cpuPower', cpuPowerRes.value ? 'ok' : 'missing', cpuPowerRes.value ? '' : '返回为空')
        appendMetricHistory(metricHistory.cpuPower, cpuPowerRes.value?.value || 0)
        hasUpdatedDynamicMetric = true
      } else if (needsCpuAux && cpuPowerRes.status === 'rejected') {
        setFetchState('cpuPower', 'error', normalizeErrorMessage(cpuPowerRes.reason))
      }

      if (needsCpuAux && cpuVoltageRes.status === 'fulfilled') {
        cpuVoltage.value = cpuVoltageRes.value
        setFetchState('cpuVoltage', cpuVoltageRes.value ? 'ok' : 'missing', cpuVoltageRes.value ? '' : '返回为空')
        appendMetricHistory(metricHistory.cpuVoltage, cpuVoltageRes.value?.value || 0)
        hasUpdatedDynamicMetric = true
      } else if (needsCpuAux && cpuVoltageRes.status === 'rejected') {
        setFetchState('cpuVoltage', 'error', normalizeErrorMessage(cpuVoltageRes.reason))
      }

      if (needsCpuAux && cpuFanRes.status === 'fulfilled') {
        cpuFanSpeed.value = cpuFanRes.value
        setFetchState('cpuFanSpeed', cpuFanRes.value ? 'ok' : 'missing', cpuFanRes.value ? '' : '返回为空')
        hasUpdatedDynamicMetric = true
      } else if (needsCpuAux && cpuFanRes.status === 'rejected') {
        setFetchState('cpuFanSpeed', 'error', normalizeErrorMessage(cpuFanRes.reason))
      }

      if (needsCpuAux) {
        lastCpuAuxRefreshAt = now
      }

      if (needsTime && timeRes.status === 'fulfilled') {
        timeInfo.value = timeRes.value
        setFetchState('timeInfo', timeRes.value ? 'ok' : 'missing', timeRes.value ? '' : '返回为空')
        lastTimeRefreshAt = now
        hasUpdatedDynamicMetric = true
      } else if (needsTime && timeRes.status === 'rejected') {
        setFetchState('timeInfo', 'error', normalizeErrorMessage(timeRes.reason))
      }

      if (hasUpdatedDynamicMetric) {
        lastSyncedAt.value = Date.now()
        diagnostics.markRefreshSuccess(backgroundThrottled.value)
      } else {
        diagnostics.markRefreshSkipped('no-metric-updated', backgroundThrottled.value)
      }
    } finally {
      refreshInFlight = undefined
    }
  })()

  return refreshInFlight
}

async function initProcessorHardwareData() {
  try {
    const [cpuRes, boardRes, biosRes, osRes] = await Promise.allSettled([
      readService(() => window.services.getCpuInfo(), 10000, 1),
      readService(() => window.services.getBoardData(), 8000, 1),
      readService(() => window.services.getBiosData(), 10000, 1),
      readService(() => window.services.getOsInfo(), 8000, 1),
    ])

    if (cpuRes.status === 'fulfilled') {
      cpuData.value = cpuRes.value
      setFetchState('cpuInfo', cpuRes.value ? 'ok' : 'missing', cpuRes.value ? '' : '返回为空')
    } else {
      setFetchState('cpuInfo', 'error', normalizeErrorMessage(cpuRes.reason))
    }

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

    await refreshProcessorDynamicMetrics(true)
  } finally {
    initialized.value = true
    loading.value = false
  }
}

export async function activateProcessorHardwareStore() {
  subscriberCount += 1
  diagnostics.markActivated(subscriberCount)
  syncMonitoringVisibility()

  if (!initialized.value) {
    if (!initPromise) {
      initPromise = initProcessorHardwareData().finally(() => {
        initPromise = undefined
      })
    }

    await initPromise
  }

  await ensureMonitoringRefreshSettingsLoaded()
  startPolling()
}

export async function refreshProcessorHardwareDynamicMetrics() {
  await refreshProcessorDynamicMetrics(true)
}

export async function refreshProcessorHardwareData() {
  if (!initialized.value) {
    if (!initPromise) {
      initPromise = initProcessorHardwareData().finally(() => {
        initPromise = undefined
      })
    }

    await initPromise
    return
  }

  await refreshProcessorDynamicMetrics(true)
}

export function deactivateProcessorHardwareStore() {
  subscriberCount = Math.max(0, subscriberCount - 1)
  diagnostics.markDeactivated(subscriberCount)

  if (subscriberCount <= 0) {
    stopPolling()
    return
  }

  restartPolling()
}

export const processorHardwareStore = {
  loading,
  initialized,
  lastSyncedAt,
  cpuData,
  cpuTemperature,
  cpuLoadData,
  cpuCurrentSpeed,
  cpuPower,
  cpuVoltage,
  cpuFanSpeed,
  boardData,
  biosData,
  osInfo,
  timeInfo,
  metricHistory,
  fetchState,
  monitoringRefreshSettings,
  backgroundThrottled,
  diagnostics: diagnostics.state,
}
