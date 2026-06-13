import { reactive, ref } from 'vue'
import {
  DEFAULT_MONITORING_REFRESH_SETTINGS,
  appendMetricHistory,
  createMonitoringDiagnostics,
  getMonitoringRefreshIntervals,
} from '../utils/monitoring'
import { getDisplayCpuCurrentSpeedGHz } from '../utils'

type ProcessorMetricHistoryKey = 'cpuLoad' | 'cpuTemp' | 'cpuSpeed' | 'cpuVoltage' | 'cpuPower'

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
        appendMetricHistory(metricHistory.cpuTemp, nextCpuTemperatureValue)
        lastCpuTempRefreshAt = now
        hasUpdatedDynamicMetric = true
      }

      if (needsCpuLoad && cpuLoadRes.status === 'fulfilled') {
        cpuLoadData.value = cpuLoadRes.value || emptyCurrentLoadData
        appendMetricHistory(metricHistory.cpuLoad, cpuLoadData.value.currentLoad || 0, true)
        lastCpuLoadRefreshAt = now
        hasUpdatedDynamicMetric = true
      }

      if (needsCpuSpeed && cpuSpeedRes.status === 'fulfilled') {
        cpuCurrentSpeed.value = cpuSpeedRes.value || emptyCpuCurrentSpeedData
        appendMetricHistory(metricHistory.cpuSpeed, getDisplayCpuCurrentSpeedGHz(cpuCurrentSpeed.value))
        lastCpuSpeedRefreshAt = now
        hasUpdatedDynamicMetric = true
      }

      if (needsCpuAux && cpuPowerRes.status === 'fulfilled') {
        cpuPower.value = cpuPowerRes.value
        appendMetricHistory(metricHistory.cpuPower, cpuPowerRes.value?.value || 0)
        hasUpdatedDynamicMetric = true
      }

      if (needsCpuAux && cpuVoltageRes.status === 'fulfilled') {
        cpuVoltage.value = cpuVoltageRes.value
        appendMetricHistory(metricHistory.cpuVoltage, cpuVoltageRes.value?.value || 0)
        hasUpdatedDynamicMetric = true
      }

      if (needsCpuAux && cpuFanRes.status === 'fulfilled') {
        cpuFanSpeed.value = cpuFanRes.value
        hasUpdatedDynamicMetric = true
      }

      if (needsCpuAux) {
        lastCpuAuxRefreshAt = now
      }

      if (needsTime && timeRes.status === 'fulfilled') {
        timeInfo.value = timeRes.value
        lastTimeRefreshAt = now
        hasUpdatedDynamicMetric = true
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

    if (cpuRes.status === 'fulfilled') cpuData.value = cpuRes.value
    if (boardRes.status === 'fulfilled') boardData.value = boardRes.value
    if (biosRes.status === 'fulfilled') biosData.value = biosRes.value
    if (osRes.status === 'fulfilled') osInfo.value = osRes.value

    await refreshProcessorDynamicMetrics(true)
  } finally {
    initialized.value = true
    loading.value = false
  }
}

export async function activateProcessorHardwareStore() {
  subscriberCount += 1
  diagnostics.markActivated(subscriberCount)
  bindVisibilityListeners()

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
  monitoringRefreshSettings,
  backgroundThrottled,
  diagnostics: diagnostics.state,
}
