import { computed, reactive, ref } from 'vue'
import {
  DEFAULT_MONITORING_REFRESH_SETTINGS,
  appendMetricHistory,
  createMonitoringDiagnostics,
  getDynamicMetricRequirementsForScopes,
  getMonitoringRefreshIntervals,
} from '../utils/monitoring'
import { getDisplayCpuCurrentSpeedGHz, getDisplayMemoryUsagePercent, getStorageUsageSummary } from '../utils'
import { selectPrimaryGpu } from '../utils/gpu'
import { bindMonitoringVisibilityListeners, resolveMonitoringBackgroundThrottled } from '../utils/monitoringVisibility'
import { normalizeErrorMessage, readService } from '../utils/serviceReader'

type SharedHardwareMonitorScope = 'overview' | 'board' | 'memory' | 'storage'

export type FetchStatus = 'pending' | 'ok' | 'missing' | 'error'

export type OverviewServiceKey =
  | 'cpuInfo'
  | 'cpuTemperature'
  | 'cpuLoad'
  | 'cpuFanSpeed'
  | 'memInfo'
  | 'memoryLayout'
  | 'gpuInfo'
  | 'diskData'
  | 'diskLayout'
  | 'biosData'
  | 'displaysData'
  | 'boardData'
  | 'osInfo'
  | 'audioDevices'
  | 'networkInterfaces'
  | 'timeInfo'

type SharedMetricHistoryKey =
  | 'cpuTemp'
  | 'gpuTemp'
  | 'cpuLoad'
  | 'gpuLoad'
  | 'memoryLoad'
  | 'storageLoad'
  | 'cpuSpeed'
  | 'cpuVoltage'
  | 'cpuPower'
  | 'gpuClock'
  | 'gpuMemory'
  | 'gpuPower'
  | 'gpuFan'

const emptyMemoData: MemoData = {
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
}

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

export const overviewServiceLabels: Record<OverviewServiceKey, string> = {
  cpuInfo: 'CPU 基础信息',
  cpuTemperature: 'CPU 温度',
  cpuLoad: 'CPU 负载',
  cpuFanSpeed: 'CPU 风扇',
  memInfo: '内存占用',
  memoryLayout: '内存布局',
  gpuInfo: 'GPU 信息',
  diskData: '磁盘占用',
  diskLayout: '磁盘布局',
  biosData: 'BIOS 信息',
  displaysData: '显示器信息',
  boardData: '主板信息',
  osInfo: '操作系统',
  audioDevices: '音频设备',
  networkInterfaces: '网络接口',
  timeInfo: '运行时间',
}

const loading = ref(true)
const initialized = ref(false)
const lastSyncedAt = ref<number>()

const cpuData = ref<CpuData>()
const cpuTemperature = ref<CpuTemperatureData>()
const cpuLoad = ref(0)
const cpuLoadData = ref<CurrentLoadData>(emptyCurrentLoadData)
const cpuCurrentSpeed = ref<CpuCurrentSpeedData>(emptyCpuCurrentSpeedData)
const cpuPower = ref<CpuPowerData>()
const cpuVoltage = ref<CpuVoltageData>()
const cpuFanSpeed = ref<CpuFanData>()
const boardTelemetry = ref<BoardTelemetryData>({
  boardTemperature: { value: null, source: 'unsupported', unit: '°C', max: null },
  vrmTemperature: { value: null, source: 'unsupported', unit: '°C', max: null },
  chipsetTemperature: { value: null, source: 'unsupported', unit: '°C', max: null },
  systemFan: { value: null, source: 'unsupported', unit: 'RPM', max: null },
  voltage12V: { value: null, source: 'unsupported', unit: 'V', max: null },
  voltage5V: { value: null, source: 'unsupported', unit: 'V', max: null },
  voltage3V: { value: null, source: 'unsupported', unit: 'V', max: null },
  voltageVBat: { value: null, source: 'unsupported', unit: 'V', max: null },
  pchVoltage: { value: null, source: 'unsupported', unit: 'V', max: null },
})

const memoData = ref<MemoData>(emptyMemoData)
const memoLayoutData = ref<MemoLayoutData[]>([])
const gpuData = ref<GpuData[]>([])
const boardData = ref<BoardData>()
const biosData = ref<BiosInfoData>()
const diskLayoutData = ref<DiskLayoutData[]>([])
const diskData = ref<DiskData[]>([])
const displaysData = ref<DisplayData[]>([])
const osInfo = ref<OsInfoData>()
const timeInfo = ref<TimeData>()
const audioDevices = ref<AudioDeviceData[]>([])
const networkInterfaces = ref<NetworkInterfaceData[]>([])

const metricHistory = reactive<Record<SharedMetricHistoryKey, number[]>>({
  cpuTemp: [],
  gpuTemp: [],
  cpuLoad: [],
  gpuLoad: [],
  memoryLoad: [],
  storageLoad: [],
  cpuSpeed: [],
  cpuVoltage: [],
  cpuPower: [],
  gpuClock: [],
  gpuMemory: [],
  gpuPower: [],
  gpuFan: [],
})

const fetchState = reactive<Record<OverviewServiceKey, { status: FetchStatus; note: string }>>({
  cpuInfo: { status: 'pending', note: '' },
  cpuTemperature: { status: 'pending', note: '' },
  cpuLoad: { status: 'pending', note: '' },
  cpuFanSpeed: { status: 'pending', note: '' },
  memInfo: { status: 'pending', note: '' },
  memoryLayout: { status: 'pending', note: '' },
  gpuInfo: { status: 'pending', note: '' },
  diskData: { status: 'pending', note: '' },
  diskLayout: { status: 'pending', note: '' },
  biosData: { status: 'pending', note: '' },
  displaysData: { status: 'pending', note: '' },
  boardData: { status: 'pending', note: '' },
  osInfo: { status: 'pending', note: '' },
  audioDevices: { status: 'pending', note: '' },
  networkInterfaces: { status: 'pending', note: '' },
  timeInfo: { status: 'pending', note: '' },
})

let initPromise: Promise<void> | undefined
let refreshSettingsPromise: Promise<void> | undefined
let refreshInFlight: Promise<void> | undefined
let pollingTimerId: number | undefined
let lastCpuTempRefreshAt = 0
let lastCpuSpeedRefreshAt = 0
let lastCpuAuxRefreshAt = 0
let lastGpuRefreshAt = 0
let lastMemoryRefreshAt = 0
let lastDiskRefreshAt = 0
let lastTimeRefreshAt = 0
let lastCpuLoadDetailRefreshAt = 0
let visibilityListenersBound = false
const diagnostics = createMonitoringDiagnostics('shared-detail')

const activeScopeCounts = reactive<Record<SharedHardwareMonitorScope, number>>({
  overview: 0,
  board: 0,
  memory: 0,
  storage: 0,
})

const monitoringRefreshSettings = ref<MonitoringRefreshSettingsData>({ ...DEFAULT_MONITORING_REFRESH_SETTINGS })
const backgroundThrottled = ref(false)

function setFetchState(key: OverviewServiceKey, status: FetchStatus, note = '') {
  fetchState[key].status = status
  fetchState[key].note = note
}

const primaryGpu = computed(() => {
  return selectPrimaryGpu(gpuData.value)
})

const usedMemoPercent = computed(() => {
  return getDisplayMemoryUsagePercent(memoData.value)
})

const storageUsage = computed(() => {
  const platform = osInfo.value?.platform?.toLowerCase?.() || ''
  return getStorageUsageSummary(diskData.value, diskLayoutData.value, platform)
})

function getActiveScopes() {
  return (Object.keys(activeScopeCounts) as SharedHardwareMonitorScope[]).filter((scope) => activeScopeCounts[scope] > 0)
}

function hasActiveScopes() {
  return getActiveScopes().length > 0
}

function getActiveSubscriberCount() {
  return Object.values(activeScopeCounts).reduce((sum, count) => sum + count, 0)
}

function getDynamicRequirements() {
  return getDynamicMetricRequirementsForScopes(getActiveScopes())
}

function hasDynamicRequirements() {
  return Object.values(getDynamicRequirements()).some(Boolean)
}

function getCurrentRefreshIntervals() {
  return getMonitoringRefreshIntervals(monitoringRefreshSettings.value.profile, backgroundThrottled.value)
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

async function refreshDynamicMetrics(force = false) {
  if (refreshInFlight) return refreshInFlight

  refreshInFlight = (async () => {
    try {
      const requirements = getDynamicRequirements()
      diagnostics.markRefreshAttempt(force, backgroundThrottled.value)
      if (!force && !Object.values(requirements).some(Boolean)) {
        diagnostics.markRefreshSkipped('no-active-requirements', backgroundThrottled.value)
        return
      }

      const intervals = getCurrentRefreshIntervals()
      const now = Date.now()
      const needsCpuTemp = requirements.cpuTemp && intervals.cpuTemp > 0 && (force || now - lastCpuTempRefreshAt >= intervals.cpuTemp)
      const needsCpuSpeed = requirements.cpuSpeed && intervals.cpuSpeed > 0 && (force || now - lastCpuSpeedRefreshAt >= intervals.cpuSpeed)
      const needsCpuAux = requirements.cpuAux && intervals.cpuAux > 0 && (force || now - lastCpuAuxRefreshAt >= intervals.cpuAux)
      const needsCpuLoadDetail = requirements.cpuLoadDetail && intervals.cpuLoadDetail > 0 && (force || now - lastCpuLoadDetailRefreshAt >= intervals.cpuLoadDetail)
      const needsCpuLoad = requirements.cpuLoad && !needsCpuLoadDetail
      const needsGpu = requirements.gpu && intervals.gpu > 0 && (force || now - lastGpuRefreshAt >= intervals.gpu)
      const needsMemory = requirements.memory && intervals.memory > 0 && (force || now - lastMemoryRefreshAt >= intervals.memory)
      const needsDisk = requirements.disk && intervals.disk > 0 && (force || now - lastDiskRefreshAt >= intervals.disk)
      const needsTime = requirements.time && intervals.time > 0 && (force || now - lastTimeRefreshAt >= intervals.time)

      if (!force && !needsCpuTemp && !needsCpuSpeed && !needsCpuAux && !needsCpuLoadDetail && !needsCpuLoad && !needsGpu && !needsMemory && !needsDisk && !needsTime) {
        diagnostics.markRefreshSkipped('not-due', backgroundThrottled.value)
        return
      }

      const [temperatureRes, cpuLoadRes, cpuLoadDataRes, cpuSpeedRes, cpuPowerRes, cpuVoltageRes, cpuFanRes, gpuRes, memoRes, diskRes, timeRes] = await Promise.allSettled([
        needsCpuTemp ? readService(() => window.services.getCpuTemperature(), 9000) : Promise.resolve(undefined),
        needsCpuLoad ? readService(() => window.services.getCpuFullLoad(), 6000) : Promise.resolve(undefined),
        needsCpuLoadDetail ? readService(() => window.services.getCpuLoadData(), 7000) : Promise.resolve(undefined),
        needsCpuSpeed ? readService(() => window.services.getCpuCurrentSpeed(), 7000) : Promise.resolve(undefined),
        needsCpuAux ? readService(() => window.services.getCpuPower(), 7000) : Promise.resolve(undefined),
        needsCpuAux ? readService(() => window.services.getCpuVoltage(), 7000) : Promise.resolve(undefined),
        needsCpuAux ? readService(() => window.services.getCpuFanSpeed(), 7000) : Promise.resolve(undefined),
        needsGpu ? readService(() => window.services.getGpuInfo(), 15000) : Promise.resolve(undefined),
        needsMemory ? readService(() => window.services.getMemInfo(), 6000) : Promise.resolve(undefined),
        needsDisk ? readService(() => window.services.getDiskData(), 10000) : Promise.resolve(undefined),
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
              : null
        setFetchState(
          'cpuTemperature',
          nextCpuTemperatureValue !== null || temperatureRes.value?.source === 'unsupported' ? 'ok' : 'missing',
          nextCpuTemperatureValue !== null
            ? ''
            : temperatureRes.value?.source === 'unsupported'
              ? temperatureRes.value?.message || '当前机器暂不支持'
              : temperatureRes.value
                ? temperatureRes.value?.message || temperatureRes.value?.errorCode || 'main 为空'
                : '服务返回 undefined'
        )
        appendMetricHistory(metricHistory.cpuTemp, nextCpuTemperatureValue || 0)
        lastCpuTempRefreshAt = now
        hasUpdatedDynamicMetric = true
      } else if (needsCpuTemp && temperatureRes.status === 'rejected') {
        setFetchState('cpuTemperature', 'error', normalizeErrorMessage(temperatureRes.reason))
      }

      if (needsCpuLoad && cpuLoadRes.status === 'fulfilled') {
        cpuLoad.value = cpuLoadRes.value || 0
        setFetchState('cpuLoad', 'ok')
        appendMetricHistory(metricHistory.cpuLoad, cpuLoad.value, true)
        hasUpdatedDynamicMetric = true
      } else if (needsCpuLoad && cpuLoadRes.status === 'rejected') {
        setFetchState('cpuLoad', 'error', normalizeErrorMessage(cpuLoadRes.reason))
      }

      if (needsCpuLoadDetail && cpuLoadDataRes.status === 'fulfilled') {
        cpuLoadData.value = cpuLoadDataRes.value || emptyCurrentLoadData
        cpuLoad.value = Math.round(cpuLoadData.value.currentLoad || 0)
        setFetchState('cpuLoad', 'ok')
        appendMetricHistory(metricHistory.cpuLoad, cpuLoad.value, true)
        lastCpuLoadDetailRefreshAt = now
        hasUpdatedDynamicMetric = true
      }

      if (needsCpuSpeed && cpuSpeedRes.status === 'fulfilled') {
        cpuCurrentSpeed.value = cpuSpeedRes.value || emptyCpuCurrentSpeedData
        appendMetricHistory(metricHistory.cpuSpeed, getDisplayCpuCurrentSpeedGHz(cpuSpeedRes.value || emptyCpuCurrentSpeedData))
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
        setFetchState('cpuFanSpeed', cpuFanRes.value?.value ? 'ok' : cpuFanRes.value?.source === 'unsupported' ? 'ok' : 'missing', cpuFanRes.value?.message || '')
        hasUpdatedDynamicMetric = true
      }

      if (needsCpuAux) {
        lastCpuAuxRefreshAt = now
      }

      if (needsGpu && gpuRes.status === 'fulfilled') {
        const nextGpuData = gpuRes.value || []
        gpuData.value = nextGpuData
        setFetchState('gpuInfo', nextGpuData.length ? 'ok' : 'missing', nextGpuData.length ? '' : '返回空数组')

        const selectedGpu = selectPrimaryGpu(nextGpuData)
        appendMetricHistory(metricHistory.gpuTemp, selectedGpu?.temperatureGpu || 0)
        appendMetricHistory(metricHistory.gpuLoad, selectedGpu?.utilizationGpu || 0, true)
        appendMetricHistory(metricHistory.gpuClock, selectedGpu?.clockCore || 0)
        appendMetricHistory(metricHistory.gpuMemory, selectedGpu?.memoryUsed || 0)
        appendMetricHistory(metricHistory.gpuPower, selectedGpu?.powerDraw || 0)
        appendMetricHistory(metricHistory.gpuFan, selectedGpu?.fanSpeed || 0)
        lastGpuRefreshAt = now
        hasUpdatedDynamicMetric = true
      } else if (needsGpu && gpuRes.status === 'rejected') {
        setFetchState('gpuInfo', 'error', normalizeErrorMessage(gpuRes.reason))
      }

      if (needsMemory && memoRes.status === 'fulfilled') {
        const nextMemoData = memoRes.value || emptyMemoData
        memoData.value = nextMemoData
        setFetchState('memInfo', nextMemoData.total > 0 ? 'ok' : 'missing', nextMemoData.total > 0 ? '' : 'total <= 0')
        appendMetricHistory(metricHistory.memoryLoad, usedMemoPercent.value, true)
        lastMemoryRefreshAt = now
        hasUpdatedDynamicMetric = true
      } else if (needsMemory && memoRes.status === 'rejected') {
        setFetchState('memInfo', 'error', normalizeErrorMessage(memoRes.reason))
      }

      if (needsDisk && diskRes.status === 'fulfilled') {
        const nextDiskData = diskRes.value || []
        diskData.value = nextDiskData
        setFetchState('diskData', nextDiskData.length ? 'ok' : 'missing', nextDiskData.length ? '' : '返回空数组')
        appendMetricHistory(metricHistory.storageLoad, storageUsage.value.percent, true)
        lastDiskRefreshAt = now
        hasUpdatedDynamicMetric = true
      } else if (needsDisk && diskRes.status === 'rejected') {
        setFetchState('diskData', 'error', normalizeErrorMessage(diskRes.reason))
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

async function initHardwareData() {
  try {
    const [cpuRes, memoryLayoutRes, boardRes, osRes] = await Promise.allSettled([
      readService(() => window.services.getCpuInfo(), 10000, 1),
      readService(() => window.services.getMemoryLayout(), 10000, 1),
      readService(() => window.services.getBoardData(), 8000, 1),
      readService(() => window.services.getOsInfo(), 8000, 1),
    ])

    if (cpuRes.status === 'fulfilled') {
      cpuData.value = cpuRes.value
      setFetchState('cpuInfo', cpuRes.value ? 'ok' : 'missing', cpuRes.value ? '' : '返回为空')
    } else {
      setFetchState('cpuInfo', 'error', normalizeErrorMessage(cpuRes.reason))
    }

    if (memoryLayoutRes.status === 'fulfilled') {
      memoLayoutData.value = memoryLayoutRes.value || []
      setFetchState('memoryLayout', memoryLayoutRes.value.length ? 'ok' : 'missing', memoryLayoutRes.value.length ? '' : '返回空数组')
    } else {
      setFetchState('memoryLayout', 'error', normalizeErrorMessage(memoryLayoutRes.reason))
    }

    if (boardRes.status === 'fulfilled') {
      boardData.value = boardRes.value
      setFetchState('boardData', boardRes.value ? 'ok' : 'missing', boardRes.value ? '' : '返回为空')
    } else {
      setFetchState('boardData', 'error', normalizeErrorMessage(boardRes.reason))
    }

    if (osRes.status === 'fulfilled') {
      osInfo.value = osRes.value
      setFetchState('osInfo', osRes.value ? 'ok' : 'missing', osRes.value ? '' : '返回为空')
    } else {
      setFetchState('osInfo', 'error', normalizeErrorMessage(osRes.reason))
    }

    const [diskLayoutRes, biosRes, displaysRes, audioRes, networkRes] = await Promise.allSettled([
      readService(() => window.services.getDiskLayout(), 15000, 1),
      readService(() => window.services.getBiosData(), 10000, 1),
      readService(() => window.services.getDisplaysData(), 12000, 1),
      readService(() => window.services.getAudioDevices(), 10000, 1),
      readService(() => window.services.getNetworkInterfaces(), 12000, 1),
    ])

    if (diskLayoutRes.status === 'fulfilled') {
      diskLayoutData.value = diskLayoutRes.value || []
      setFetchState('diskLayout', diskLayoutRes.value.length ? 'ok' : 'missing', diskLayoutRes.value.length ? '' : '返回空数组')
    } else {
      setFetchState('diskLayout', 'error', normalizeErrorMessage(diskLayoutRes.reason))
    }

    if (biosRes.status === 'fulfilled') {
      biosData.value = biosRes.value
      setFetchState('biosData', biosRes.value ? 'ok' : 'missing', biosRes.value ? '' : '返回为空')
    } else {
      setFetchState('biosData', 'error', normalizeErrorMessage(biosRes.reason))
    }

    if (displaysRes.status === 'fulfilled') {
      displaysData.value = displaysRes.value || []
      setFetchState('displaysData', displaysRes.value.length ? 'ok' : 'missing', displaysRes.value.length ? '' : '返回空数组')
    } else {
      setFetchState('displaysData', 'error', normalizeErrorMessage(displaysRes.reason))
    }

    if (audioRes.status === 'fulfilled') {
      audioDevices.value = audioRes.value || []
      setFetchState('audioDevices', audioRes.value.length ? 'ok' : 'missing', audioRes.value.length ? '' : '返回空数组')
    } else {
      setFetchState('audioDevices', 'error', normalizeErrorMessage(audioRes.reason))
    }

    if (networkRes.status === 'fulfilled') {
      networkInterfaces.value = networkRes.value || []
      setFetchState('networkInterfaces', networkRes.value.length ? 'ok' : 'missing', networkRes.value.length ? '' : '返回空数组')
    } else {
      setFetchState('networkInterfaces', 'error', normalizeErrorMessage(networkRes.reason))
    }

    await refreshDynamicMetrics(true)
  } finally {
    initialized.value = true
    loading.value = false
  }
}

function startPolling() {
  if (pollingTimerId) return

  if (!hasActiveScopes() || !hasDynamicRequirements()) return

  if (!lastSyncedAt.value || Date.now() - lastSyncedAt.value > getCurrentRefreshIntervals().base) {
    refreshDynamicMetrics()
  }

  const scheduleNext = () => {
    if (!hasActiveScopes() || !hasDynamicRequirements()) {
      pollingTimerId = undefined
      return
    }

    pollingTimerId = window.setTimeout(async () => {
      pollingTimerId = undefined
      await refreshDynamicMetrics()
      scheduleNext()
    }, getCurrentRefreshIntervals().base)
  }

  scheduleNext()
}

function stopPolling() {
  if (pollingTimerId) {
    window.clearTimeout(pollingTimerId)
    pollingTimerId = undefined
  }
}

function restartPolling() {
  stopPolling()
  startPolling()
}

export async function activateHardwareStore(scope: SharedHardwareMonitorScope = 'overview') {
  activeScopeCounts[scope] += 1
  diagnostics.markActivated(getActiveSubscriberCount())
  syncMonitoringVisibility()

  if (!initialized.value) {
    if (!initPromise) {
      initPromise = initHardwareData().finally(() => {
        initPromise = undefined
      })
    }

    await initPromise
  }

  await ensureMonitoringRefreshSettingsLoaded()

  if (hasActiveScopes()) {
    startPolling()
  }
}

export async function refreshHardwareStoreDynamicMetrics() {
  await refreshDynamicMetrics(true)
}

export async function refreshHardwareData(_scope: SharedHardwareMonitorScope = 'overview') {
  if (!initialized.value) {
    if (!initPromise) {
      initPromise = initHardwareData().finally(() => {
        initPromise = undefined
      })
    }

    await initPromise
    return
  }

  await refreshDynamicMetrics(true)
}

export async function updateHardwareMonitorRefreshSettings(patch: Partial<MonitoringRefreshSettingsData>) {
  monitoringRefreshSettings.value = await window.services.updateMonitoringRefreshSettings(patch)
  backgroundThrottled.value = resolveMonitoringBackgroundThrottled(monitoringRefreshSettings.value.backgroundThrottleEnabled)
  restartPolling()
  return monitoringRefreshSettings.value
}

export function deactivateHardwareStore(scope: SharedHardwareMonitorScope = 'overview') {
  activeScopeCounts[scope] = Math.max(0, activeScopeCounts[scope] - 1)
  diagnostics.markDeactivated(getActiveSubscriberCount())

  if (!hasActiveScopes()) {
    stopPolling()
    return
  }

  restartPolling()
}

export const hardwareStore = {
  loading,
  initialized,
  lastSyncedAt,
  cpuData,
  cpuTemperature,
  cpuLoad,
  cpuLoadData,
  cpuCurrentSpeed,
  cpuPower,
  cpuVoltage,
  cpuFanSpeed,
  boardTelemetry,
  memoData,
  memoLayoutData,
  gpuData,
  boardData,
  biosData,
  diskLayoutData,
  diskData,
  displaysData,
  osInfo,
  timeInfo,
  audioDevices,
  networkInterfaces,
  metricHistory,
  fetchState,
  monitoringRefreshSettings,
  backgroundThrottled,
  diagnostics: diagnostics.state,
  primaryGpu,
  usedMemoPercent,
  storageUsage,
}
