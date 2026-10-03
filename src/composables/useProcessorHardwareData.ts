import { reactive, ref } from 'vue'
import { settleMetric, subscribeHardwareMetrics, hasSharedHardwareTelemetry, refreshSharedHardwareMetrics, isOlderMetricSample, getHardwareMetricState } from '../utils/metricRefresh'
import {
  appendMetricHistory,
  createMonitoringDiagnostics,
  getMonitoringRefreshIntervals,
  type MonitoringRefreshProfile,
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

async function retryMissingCpuTemperature(initial?: CpuTemperatureData) {
  const hasValue = typeof initial?.value === 'number' || typeof initial?.main === 'number'
  if (hasValue) return initial

  try {
    const retry = await readService(() => window.services.getCpuTemperature(), 3000)
    return retry && (typeof retry.value === 'number' || typeof retry.main === 'number') ? retry : initial
  } catch {
    return initial
  }
}

async function retrySystemInformationCpuSpeed(initial?: CpuCurrentSpeedData) {
  if (initial?.source !== 'systeminformation') return initial

  try {
    const retry = await readService(() => window.services.getCpuCurrentSpeed(), 3000)
    return retry?.source === 'OpenHardwareMonitor' ? retry : initial
  } catch {
    return initial
  }
}

async function retryMissingCpuPower(initial?: CpuPowerData) {
  if (typeof initial?.value === 'number' && initial.value > 0) return initial

  try {
    const retry = await readService(() => window.services.getCpuPower(), 3000)
    return retry && typeof retry.value === 'number' && retry.value > 0 ? retry : initial
  } catch {
    return initial
  }
}

async function retryMissingCpuVoltage(initial?: CpuVoltageData) {
  if (typeof initial?.value === 'number' && initial.value > 0) return initial

  try {
    const retry = await readService(() => window.services.getCpuVoltage(), 3000)
    return retry && typeof retry.value === 'number' && retry.value > 0 ? retry : initial
  } catch {
    return initial
  }
}

export interface ProcessorStoreActivationOptions {
  profile?: MonitoringRefreshProfile
  requireFocus?: boolean
  disableBackgroundThrottle?: boolean
}

interface ProcessorSubscriberSession {
  id: number
  profile: MonitoringRefreshProfile
  requireFocus: boolean
  disableBackgroundThrottle: boolean
}

let nextSubscriberSessionId = 1
const activeSubscriberSessions = new Map<number, ProcessorSubscriberSession>()

function isWatchWindowContext(): boolean {
  if (typeof window === 'undefined') return false
  const hash = (window.location?.hash || '').toLowerCase()
  const path = (window.location?.pathname || '').toLowerCase()
  return hash.includes('watch') || hash.includes('cpucores') || path.includes('watch')
}

function getEffectiveMonitoringOptions(): {
  profile: MonitoringRefreshProfile
  requireFocus: boolean
  disableBackgroundThrottle: boolean
} {
  const isWatch = isWatchWindowContext()

  if (activeSubscriberSessions.size === 0) {
    return {
      profile: isWatch ? 'realtime' : 'balanced',
      requireFocus: !isWatch,
      disableBackgroundThrottle: false,
    }
  }

  let profile: MonitoringRefreshProfile = isWatch ? 'realtime' : 'balanced'
  let requireFocus = !isWatch
  let disableBackgroundThrottle = false

  for (const session of activeSubscriberSessions.values()) {
    if (session.profile === 'realtime') {
      profile = 'realtime'
    }

    if (!session.requireFocus) {
      requireFocus = false
    }

    if (session.disableBackgroundThrottle) {
      disableBackgroundThrottle = true
    }
  }

  return { profile, requireFocus, disableBackgroundThrottle }
}

function getCurrentRefreshIntervals() {
  const { profile } = getEffectiveMonitoringOptions()
  return getMonitoringRefreshIntervals(profile, backgroundThrottled.value)
}

function setProcessorMetricState(metric: HardwareTelemetryKey, key: ProcessorServiceKey, value: unknown) {
  const state = getHardwareMetricState(metric, value)
  setFetchState(key, state.status, state.note)
}

let stopSharedTelemetry: (() => void) | undefined
function subscribeProcessorTelemetry() {
  if (stopSharedTelemetry) return
  stopSharedTelemetry = subscribeHardwareMetrics({
    cpuLoad: (value, at) => {
      cpuLoadData.value = value
      setFetchState('cpuLoadData', 'ok', '')
      appendMetricHistory(metricHistory.cpuLoad, value.currentLoad, true, 24, at)
      lastSyncedAt.value = Math.max(lastSyncedAt.value ?? 0, at)
    },
    cpuTemperature: (value, at) => {
      cpuTemperature.value = value
      setProcessorMetricState('cpuTemperature', 'cpuTemperature', value)
      if (getHardwareMetricState('cpuTemperature', value).status === 'ok') lastSyncedAt.value = Math.max(lastSyncedAt.value ?? 0, at)
      if (getHardwareMetricState('cpuTemperature', value).status === 'ok' && value) appendMetricHistory(metricHistory.cpuTemp, value.value ?? value.main ?? 0, false, 24, at)
    },
    cpuFrequency: (value, at) => {
      cpuCurrentSpeed.value = value
      setProcessorMetricState('cpuFrequency', 'cpuCurrentSpeed', value)
      if (getHardwareMetricState('cpuFrequency', value).status === 'ok') lastSyncedAt.value = Math.max(lastSyncedAt.value ?? 0, at)
      appendMetricHistory(metricHistory.cpuSpeed, getDisplayCpuCurrentSpeedGHz(value), false, 24, at)
    },
    cpuPower: (value, at) => {
      cpuPower.value = value
      setProcessorMetricState('cpuPower', 'cpuPower', value)
      if (getHardwareMetricState('cpuPower', value).status === 'ok') lastSyncedAt.value = Math.max(lastSyncedAt.value ?? 0, at)
      if (value && getHardwareMetricState('cpuPower', value).status === 'ok') appendMetricHistory(metricHistory.cpuPower, value.value ?? 0, false, 24, at)
    },
    cpuVoltage: (value, at) => {
      cpuVoltage.value = value
      setProcessorMetricState('cpuVoltage', 'cpuVoltage', value)
      if (getHardwareMetricState('cpuVoltage', value).status === 'ok') lastSyncedAt.value = Math.max(lastSyncedAt.value ?? 0, at)
      if (value && getHardwareMetricState('cpuVoltage', value).status === 'ok') appendMetricHistory(metricHistory.cpuVoltage, value.value ?? 0, false, 24, at)
    },
    fanSpeed: (value) => { cpuFanSpeed.value = value; setProcessorMetricState('fanSpeed', 'cpuFanSpeed', value) },
  }, (key, error) => {
    const keys: Partial<Record<HardwareTelemetryKey, ProcessorServiceKey>> = {
      cpuLoad: 'cpuLoadData', cpuTemperature: 'cpuTemperature', cpuFrequency: 'cpuCurrentSpeed',
      cpuPower: 'cpuPower', cpuVoltage: 'cpuVoltage', fanSpeed: 'cpuFanSpeed',
    }
    const serviceKey = keys[key]
    if (serviceKey) setFetchState(serviceKey, 'error', error)
  })
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
      try {
        await refreshProcessorDynamicMetrics()
      } catch (error) {
        console.error('处理器轮询失败:', error)
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

function computeProcessorBackgroundThrottled() {
  const { requireFocus, disableBackgroundThrottle } = getEffectiveMonitoringOptions()
  if (disableBackgroundThrottle) return false
  return resolveMonitoringBackgroundThrottled(
    true,
    typeof document === 'undefined' ? undefined : document,
    { requireFocus }
  )
}

function updateBackgroundThrottled() {
  const nextValue = computeProcessorBackgroundThrottled()
  if (backgroundThrottled.value === nextValue) return
  backgroundThrottled.value = nextValue
  restartPolling()
}

function syncMonitoringVisibility() {
  visibilityListenersBound = bindMonitoringVisibilityListeners(visibilityListenersBound, updateBackgroundThrottled)
  backgroundThrottled.value = computeProcessorBackgroundThrottled()
}

async function refreshProcessorDynamicMetrics(force = false) {
  if (refreshInFlight) return refreshInFlight

  refreshInFlight = (async () => {
    try {
      const shared = hasSharedHardwareTelemetry()
      const intervals = getCurrentRefreshIntervals()
      diagnostics.markRefreshAttempt(force, backgroundThrottled.value)
      if (!force && !hasActiveRefreshIntervals()) {
        diagnostics.markRefreshSkipped('background-paused', backgroundThrottled.value)
        return
      }

      const now = Date.now()
      const needsCpuTemp = !shared && intervals.cpuTemp > 0 && (force || now - lastCpuTempRefreshAt >= intervals.cpuTemp)
      const needsCpuLoad = !shared && intervals.cpuLoadDetail > 0 && (force || now - lastCpuLoadRefreshAt >= intervals.cpuLoadDetail)
      const needsCpuSpeed = !shared && intervals.cpuSpeed > 0 && (force || now - lastCpuSpeedRefreshAt >= intervals.cpuSpeed)
      // A forced refresh is used when a sensor helper becomes ready or the
      // user explicitly retries. It must still fetch voltage/power while the
      // page is temporarily background-throttled; otherwise these cards can
      // remain permanently pending until the next foreground transition.
      const needsCpuAux = !shared && (force || (intervals.cpuAux > 0 && now - lastCpuAuxRefreshAt >= intervals.cpuAux))
      const needsTime = intervals.time > 0 && (force || now - lastTimeRefreshAt >= intervals.time)

      if (!force && !needsCpuTemp && !needsCpuLoad && !needsCpuSpeed && !needsCpuAux && !needsTime) {
        diagnostics.markRefreshSkipped('not-due', backgroundThrottled.value)
        return
      }

      let hasUpdatedDynamicMetric = false
      await Promise.all([
        settleMetric(needsCpuTemp ? readService(() => window.services.getCpuTemperature(), 9000) : Promise.resolve(undefined), async (temperatureRes) => {
          if (needsCpuTemp && temperatureRes.status === 'fulfilled') {
            const nextCpuTemperature = await retryMissingCpuTemperature(temperatureRes.value)
            if (isOlderMetricSample(nextCpuTemperature, cpuTemperature.value)) return
            cpuTemperature.value = nextCpuTemperature
            const nextCpuTemperatureValue =
              typeof nextCpuTemperature?.value === 'number'
                ? nextCpuTemperature.value
                : typeof nextCpuTemperature?.main === 'number'
                  ? nextCpuTemperature.main
                  : 0
            setProcessorMetricState('cpuTemperature', 'cpuTemperature', nextCpuTemperature)
            if (getHardwareMetricState('cpuTemperature', nextCpuTemperature).status === 'ok') appendMetricHistory(metricHistory.cpuTemp, nextCpuTemperatureValue, false, 24, nextCpuTemperature?.sampledAt)
            lastCpuTempRefreshAt = now
            hasUpdatedDynamicMetric = true
          } else if (needsCpuTemp && temperatureRes.status === 'rejected') {
            setFetchState('cpuTemperature', 'error', normalizeErrorMessage(temperatureRes.reason))
          }

        }),
        settleMetric(needsCpuLoad ? readService(() => window.services.getCpuLoadData(), 7000) : Promise.resolve(undefined), async (cpuLoadRes) => {
          if (needsCpuLoad && cpuLoadRes.status === 'fulfilled' && !isOlderMetricSample(cpuLoadRes.value, cpuLoadData.value)) {
            cpuLoadData.value = cpuLoadRes.value || emptyCurrentLoadData
            setFetchState('cpuLoadData', cpuLoadRes.value ? 'ok' : 'missing', cpuLoadRes.value ? '' : '返回为空')
            appendMetricHistory(metricHistory.cpuLoad, cpuLoadData.value.currentLoad || 0, true, 24, cpuLoadData.value.sampledAt)
            lastCpuLoadRefreshAt = now
            hasUpdatedDynamicMetric = true
          } else if (needsCpuLoad && cpuLoadRes.status === 'rejected') {
            setFetchState('cpuLoadData', 'error', normalizeErrorMessage(cpuLoadRes.reason))
          }

        }),
        settleMetric(needsCpuSpeed ? readService(() => window.services.getCpuCurrentSpeed(), 7000) : Promise.resolve(undefined), async (cpuSpeedRes) => {
          if (needsCpuSpeed && cpuSpeedRes.status === 'fulfilled') {
            const nextCpuSpeed = await retrySystemInformationCpuSpeed(cpuSpeedRes.value)
            if (isOlderMetricSample(nextCpuSpeed, cpuCurrentSpeed.value)) return
            cpuCurrentSpeed.value = nextCpuSpeed || emptyCpuCurrentSpeedData
            setProcessorMetricState('cpuFrequency', 'cpuCurrentSpeed', nextCpuSpeed)
            appendMetricHistory(metricHistory.cpuSpeed, getDisplayCpuCurrentSpeedGHz(cpuCurrentSpeed.value), false, 24, cpuCurrentSpeed.value.sampledAt)
            lastCpuSpeedRefreshAt = now
            hasUpdatedDynamicMetric = true
          } else if (needsCpuSpeed && cpuSpeedRes.status === 'rejected') {
            setFetchState('cpuCurrentSpeed', 'error', normalizeErrorMessage(cpuSpeedRes.reason))
          }

        }),
        settleMetric(needsCpuAux ? readService(() => window.services.getCpuPower(), 7000) : Promise.resolve(undefined), async (cpuPowerRes) => {
          if (needsCpuAux && cpuPowerRes.status === 'fulfilled') {
            const nextCpuPower = await retryMissingCpuPower(cpuPowerRes.value)
            if (isOlderMetricSample(nextCpuPower, cpuPower.value)) return
            cpuPower.value = nextCpuPower
            setProcessorMetricState('cpuPower', 'cpuPower', nextCpuPower)
            if (getHardwareMetricState('cpuPower', nextCpuPower).status === 'ok') appendMetricHistory(metricHistory.cpuPower, nextCpuPower?.value || 0, false, 24, nextCpuPower?.sampledAt)
            hasUpdatedDynamicMetric = true
          } else if (needsCpuAux && cpuPowerRes.status === 'rejected') {
            setFetchState('cpuPower', 'error', normalizeErrorMessage(cpuPowerRes.reason))
          }

        }),
        settleMetric(needsCpuAux ? readService(() => window.services.getCpuVoltage(), 7000) : Promise.resolve(undefined), async (cpuVoltageRes) => {
          if (needsCpuAux && cpuVoltageRes.status === 'fulfilled') {
            const nextCpuVoltage = await retryMissingCpuVoltage(cpuVoltageRes.value)
            if (isOlderMetricSample(nextCpuVoltage, cpuVoltage.value)) return
            cpuVoltage.value = nextCpuVoltage
            setProcessorMetricState('cpuVoltage', 'cpuVoltage', nextCpuVoltage)
            if (getHardwareMetricState('cpuVoltage', nextCpuVoltage).status === 'ok') appendMetricHistory(metricHistory.cpuVoltage, nextCpuVoltage?.value || 0, false, 24, nextCpuVoltage?.sampledAt)
            hasUpdatedDynamicMetric = true
          } else if (needsCpuAux && cpuVoltageRes.status === 'rejected') {
            setFetchState('cpuVoltage', 'error', normalizeErrorMessage(cpuVoltageRes.reason))
          }

        }),
        settleMetric(needsCpuAux ? readService(() => window.services.getCpuFanSpeed(), 7000) : Promise.resolve(undefined), async (cpuFanRes) => {
          if (needsCpuAux && cpuFanRes.status === 'fulfilled') {
            cpuFanSpeed.value = cpuFanRes.value
            setProcessorMetricState('fanSpeed', 'cpuFanSpeed', cpuFanRes.value)
            hasUpdatedDynamicMetric = true
          } else if (needsCpuAux && cpuFanRes.status === 'rejected') {
            setFetchState('cpuFanSpeed', 'error', normalizeErrorMessage(cpuFanRes.reason))
          }

          if (needsCpuAux) {
            lastCpuAuxRefreshAt = now
          }

        }),
        settleMetric(needsTime ? readService(() => window.services.getTimeInfo(), 6000) : Promise.resolve(undefined), async (timeRes) => {
          if (needsTime && timeRes.status === 'fulfilled') {
            timeInfo.value = timeRes.value
            setFetchState('timeInfo', timeRes.value ? 'ok' : 'missing', timeRes.value ? '' : '返回为空')
            lastTimeRefreshAt = now
            hasUpdatedDynamicMetric = true
          } else if (needsTime && timeRes.status === 'rejected') {
            setFetchState('timeInfo', 'error', normalizeErrorMessage(timeRes.reason))
          }

        }),
      ])

      if (hasUpdatedDynamicMetric) {
        if (!shared) lastSyncedAt.value = Date.now()
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
    await Promise.all([
      settleMetric(readService(() => window.services.getCpuInfo(), 10000, 1), (cpuRes) => {
        if (cpuRes.status === 'fulfilled') {
          cpuData.value = cpuRes.value
          if (cpuRes.value) loading.value = false
          setFetchState('cpuInfo', cpuRes.value ? 'ok' : 'missing', cpuRes.value ? '' : '返回为空')
        } else {
          setFetchState('cpuInfo', 'error', normalizeErrorMessage(cpuRes.reason))
        }
      }),
      settleMetric(readService(() => window.services.getBoardData(), 8000, 1), (boardRes) => {
        if (boardRes.status === 'fulfilled') {
          boardData.value = boardRes.value
          setFetchState('boardData', boardRes.value ? 'ok' : 'missing', boardRes.value ? '' : '返回为空')
        } else {
          setFetchState('boardData', 'error', normalizeErrorMessage(boardRes.reason))
        }
      }),
      settleMetric(readService(() => window.services.getBiosData(), 10000, 1), (biosRes) => {
        if (biosRes.status === 'fulfilled') {
          biosData.value = biosRes.value
          setFetchState('biosData', biosRes.value ? 'ok' : 'missing', biosRes.value ? '' : '返回为空')
        } else {
          setFetchState('biosData', 'error', normalizeErrorMessage(biosRes.reason))
        }
      }),
      settleMetric(readService(() => window.services.getOsInfo(), 8000, 1), (osRes) => {
        if (osRes.status === 'fulfilled') {
          osInfo.value = osRes.value
          setFetchState('osInfo', osRes.value ? 'ok' : 'missing', osRes.value ? '' : '返回为空')
        } else {
          setFetchState('osInfo', 'error', normalizeErrorMessage(osRes.reason))
        }
      }),
    ])

    loading.value = false
    await refreshProcessorDynamicMetrics(true)
  } finally {
    initialized.value = true
    loading.value = false
  }
}

export async function activateProcessorHardwareStore(options?: ProcessorStoreActivationOptions): Promise<() => void> {
  const sessionId = nextSubscriberSessionId++
  const isWatch = isWatchWindowContext()

  activeSubscriberSessions.set(sessionId, {
    id: sessionId,
    profile: options?.profile || (isWatch ? 'realtime' : 'balanced'),
    requireFocus: typeof options?.requireFocus === 'boolean' ? options.requireFocus : !isWatch,
    disableBackgroundThrottle: Boolean(options?.disableBackgroundThrottle),
  })

  subscriberCount = activeSubscriberSessions.size
  subscribeProcessorTelemetry()
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

  startPolling()

  return () => {
    deactivateProcessorHardwareStore(sessionId)
  }
}

export async function refreshProcessorHardwareDynamicMetrics() {
  await refreshSharedHardwareMetrics(['cpuLoad', 'cpuTemperature', 'cpuFrequency', 'cpuPower', 'cpuVoltage', 'fanSpeed'])
  await refreshProcessorDynamicMetrics(true)
}

export async function refreshProcessorHardwareData() {
  window.services.invalidateHardwareInfoCache?.(['cpuInfo', 'boardData', 'biosData', 'osInfo'])
  await refreshSharedHardwareMetrics(['cpuLoad', 'cpuTemperature', 'cpuFrequency', 'cpuPower', 'cpuVoltage', 'fanSpeed'])
  if (initPromise) await initPromise
  if (!initPromise) {
    initPromise = initProcessorHardwareData().finally(() => { initPromise = undefined })
  }
  await initPromise
}

export function deactivateProcessorHardwareStore(sessionId?: number) {
  if (typeof sessionId === 'number') {
    activeSubscriberSessions.delete(sessionId)
  } else if (activeSubscriberSessions.size > 0) {
    const lastKey = Array.from(activeSubscriberSessions.keys()).pop()
    if (lastKey !== undefined) {
      activeSubscriberSessions.delete(lastKey)
    }
  }

  subscriberCount = activeSubscriberSessions.size
  diagnostics.markDeactivated(subscriberCount)

  if (subscriberCount <= 0) {
    stopSharedTelemetry?.()
    stopSharedTelemetry = undefined
    stopPolling()
    return
  }

  syncMonitoringVisibility()
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
  backgroundThrottled,
  diagnostics: diagnostics.state,
}
