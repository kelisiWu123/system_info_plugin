import { computed, reactive, ref } from 'vue'
import {
  DEFAULT_MONITORING_REFRESH_SETTINGS,
  appendMetricHistory,
  createMonitoringDiagnostics,
  getMonitoringRefreshIntervals,
} from '../utils/monitoring'
import { getDisplayMemoryUsagePercent, getStorageUsageSummary } from '../utils'
import { selectPrimaryGpu } from '../utils/gpu'
import { bindMonitoringVisibilityListeners, resolveMonitoringBackgroundThrottled } from '../utils/monitoringVisibility'
import { normalizeErrorMessage, readService } from '../utils/serviceReader'

type FetchStatus = 'pending' | 'ok' | 'missing' | 'error'

export type OverviewLiteServiceKey =
  | 'cpuInfo'
  | 'cpuTemperature'
  | 'cpuLoad'
  | 'memInfo'
  | 'memoryLayout'
  | 'gpuInfo'
  | 'diskData'
  | 'diskLayout'
  | 'biosData'
  | 'systemData'
  | 'displaysData'
  | 'boardData'
  | 'osInfo'
  | 'audioDevices'
  | 'networkInterfaces'
  | 'timeInfo'

type OverviewMetricHistoryKey = 'cpuTemp' | 'gpuTemp' | 'cpuLoad' | 'gpuLoad' | 'memoryLoad' | 'storageLoad'

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

export const overviewLiteServiceLabels: Record<OverviewLiteServiceKey, string> = {
  cpuInfo: 'CPU 基础信息',
  cpuTemperature: 'CPU 温度',
  cpuLoad: 'CPU 负载',
  memInfo: '内存占用',
  memoryLayout: '内存布局',
  gpuInfo: 'GPU 信息',
  diskData: '磁盘占用',
  diskLayout: '磁盘布局',
  biosData: 'BIOS 信息',
  systemData: '整机型号',
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
const monitoringRefreshSettings = ref<MonitoringRefreshSettingsData>({ ...DEFAULT_MONITORING_REFRESH_SETTINGS })
const backgroundThrottled = ref(false)

const cpuData = ref<CpuData>()
const cpuTemperature = ref<CpuTemperatureData>()
const cpuLoad = ref(0)
const cpuCurrentSpeed = ref<CpuCurrentSpeedData>({ min: 0, max: 0, avg: 0, cores: [] })
const memoData = ref<MemoData>(emptyMemoData)
const memoLayoutData = ref<MemoLayoutData[]>([])
const gpuData = ref<GpuData[]>([])
const primaryGpu = ref<GpuData>()
const diskData = ref<DiskData[]>([])
const diskLayoutData = ref<DiskLayoutData[]>([])
const boardData = ref<BoardData>()
const biosData = ref<BiosInfoData>()
const systemData = ref<SystemData>()
const displaysData = ref<DisplayData[]>([])
const osInfo = ref<OsInfoData>()
const timeInfo = ref<TimeData>()
const audioDevices = ref<AudioDeviceData[]>([])
const networkInterfaces = ref<NetworkInterfaceData[]>([])

const metricHistory = reactive<Record<OverviewMetricHistoryKey, number[]>>({
  cpuTemp: [],
  gpuTemp: [],
  cpuLoad: [],
  gpuLoad: [],
  memoryLoad: [],
  storageLoad: [],
})

const fetchState = reactive<Record<OverviewLiteServiceKey, { status: FetchStatus; note: string }>>({
  cpuInfo: { status: 'pending', note: '' },
  cpuTemperature: { status: 'pending', note: '' },
  cpuLoad: { status: 'pending', note: '' },
  memInfo: { status: 'pending', note: '' },
  memoryLayout: { status: 'pending', note: '' },
  gpuInfo: { status: 'pending', note: '' },
  diskData: { status: 'pending', note: '' },
  diskLayout: { status: 'pending', note: '' },
  biosData: { status: 'pending', note: '' },
  systemData: { status: 'pending', note: '' },
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
let subscriberCount = 0
let lastCpuTempRefreshAt = 0
let lastCpuSpeedRefreshAt = 0
let lastGpuRefreshAt = 0
let lastMemoryRefreshAt = 0
let lastDiskRefreshAt = 0
let lastTimeRefreshAt = 0
let visibilityListenersBound = false
const diagnostics = createMonitoringDiagnostics('overview-lite')

function setFetchState(key: OverviewLiteServiceKey, status: FetchStatus, note = '') {
  fetchState[key].status = status
  fetchState[key].note = note
}

const usedMemoPercent = computed(() => getDisplayMemoryUsagePercent(memoData.value))

const storageUsage = computed(() => {
  const platform = osInfo.value?.platform?.toLowerCase?.() || ''
  return getStorageUsageSummary(diskData.value, diskLayoutData.value, platform)
})

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

function getCurrentRefreshIntervals() {
  return getMonitoringRefreshIntervals(monitoringRefreshSettings.value.profile, backgroundThrottled.value)
}

async function refreshOverviewMetrics(force = false) {
  if (refreshInFlight) return refreshInFlight

  refreshInFlight = (async () => {
    try {
      const now = Date.now()
      const intervals = getCurrentRefreshIntervals()
      diagnostics.markRefreshAttempt(force, backgroundThrottled.value)
      const needsCpuTemp = force || now - lastCpuTempRefreshAt >= intervals.cpuTemp
      const needsCpuSpeed = force || now - lastCpuSpeedRefreshAt >= intervals.cpuSpeed
      const needsGpu = intervals.gpu > 0 && (force || now - lastGpuRefreshAt >= intervals.gpu)
      const needsMemory = force || now - lastMemoryRefreshAt >= intervals.memory
      const needsDisk = force || now - lastDiskRefreshAt >= intervals.disk
      const needsTime = force || now - lastTimeRefreshAt >= intervals.time

      if (!force && !needsCpuTemp && !needsCpuSpeed && !needsGpu && !needsMemory && !needsDisk && !needsTime) {
        diagnostics.markRefreshSkipped('not-due', backgroundThrottled.value)
        return
      }

      const [temperatureRes, cpuLoadRes, cpuSpeedRes, gpuRes, memoRes, diskRes, timeRes] = await Promise.allSettled([
        needsCpuTemp ? readService(() => window.services.getCpuTemperature(), 9000) : Promise.resolve(undefined),
        readService(() => window.services.getCpuFullLoad(), 6000),
        needsCpuSpeed ? readService(() => window.services.getCpuCurrentSpeed(), 7000) : Promise.resolve(undefined),
        needsGpu ? readService(() => window.services.getGpuInfo(), 15000) : Promise.resolve(undefined),
        needsMemory ? readService(() => window.services.getMemInfo(), 6000) : Promise.resolve(undefined),
        needsDisk ? readService(() => window.services.getDiskData(), 10000) : Promise.resolve(undefined),
        needsTime ? readService(() => window.services.getTimeInfo(), 6000) : Promise.resolve(undefined),
      ])

      let hasUpdatedMetric = false

      if (needsCpuTemp && temperatureRes.status === 'fulfilled') {
        cpuTemperature.value = temperatureRes.value
        const nextValue =
          typeof temperatureRes.value?.value === 'number'
            ? temperatureRes.value.value
            : typeof temperatureRes.value?.main === 'number'
              ? temperatureRes.value.main
              : null
        setFetchState(
          'cpuTemperature',
          nextValue !== null || temperatureRes.value?.source === 'unsupported' ? 'ok' : 'missing',
          nextValue !== null ? '' : temperatureRes.value?.message || temperatureRes.value?.errorCode || 'main 为空'
        )
        appendMetricHistory(metricHistory.cpuTemp, nextValue || 0)
        lastCpuTempRefreshAt = now
        hasUpdatedMetric = true
      } else if (needsCpuTemp && temperatureRes.status === 'rejected') {
        setFetchState('cpuTemperature', 'error', normalizeErrorMessage(temperatureRes.reason))
      }

      if (cpuLoadRes.status === 'fulfilled') {
        cpuLoad.value = cpuLoadRes.value || 0
        setFetchState('cpuLoad', 'ok')
        appendMetricHistory(metricHistory.cpuLoad, cpuLoad.value, true)
        hasUpdatedMetric = true
      } else {
        setFetchState('cpuLoad', 'error', normalizeErrorMessage(cpuLoadRes.reason))
      }

      if (needsCpuSpeed && cpuSpeedRes.status === 'fulfilled') {
        cpuCurrentSpeed.value = cpuSpeedRes.value || { min: 0, max: 0, avg: 0, cores: [] }
        lastCpuSpeedRefreshAt = now
        hasUpdatedMetric = true
      }

      if (needsGpu && gpuRes.status === 'fulfilled') {
        const nextGpuData = gpuRes.value || []
        gpuData.value = nextGpuData
        primaryGpu.value = selectPrimaryGpu(nextGpuData)
        setFetchState('gpuInfo', nextGpuData.length ? 'ok' : 'missing', nextGpuData.length ? '' : '返回空数组')
        appendMetricHistory(metricHistory.gpuTemp, primaryGpu.value?.temperatureGpu || 0)
        appendMetricHistory(metricHistory.gpuLoad, primaryGpu.value?.utilizationGpu || 0, true)
        lastGpuRefreshAt = now
        hasUpdatedMetric = true
      } else if (needsGpu && gpuRes.status === 'rejected') {
        setFetchState('gpuInfo', 'error', normalizeErrorMessage(gpuRes.reason))
      }

      if (needsMemory && memoRes.status === 'fulfilled') {
        const nextMemoData = memoRes.value || emptyMemoData
        memoData.value = nextMemoData
        setFetchState('memInfo', nextMemoData.total > 0 ? 'ok' : 'missing', nextMemoData.total > 0 ? '' : 'total <= 0')
        appendMetricHistory(metricHistory.memoryLoad, usedMemoPercent.value, true)
        lastMemoryRefreshAt = now
        hasUpdatedMetric = true
      } else if (needsMemory && memoRes.status === 'rejected') {
        setFetchState('memInfo', 'error', normalizeErrorMessage(memoRes.reason))
      }

      if (needsDisk && diskRes.status === 'fulfilled') {
        const nextDiskData = diskRes.value || []
        diskData.value = nextDiskData
        setFetchState('diskData', nextDiskData.length ? 'ok' : 'missing', nextDiskData.length ? '' : '返回空数组')
        appendMetricHistory(metricHistory.storageLoad, storageUsage.value.percent, true)
        lastDiskRefreshAt = now
        hasUpdatedMetric = true
      } else if (needsDisk && diskRes.status === 'rejected') {
        setFetchState('diskData', 'error', normalizeErrorMessage(diskRes.reason))
      }

      if (needsTime && timeRes.status === 'fulfilled') {
        timeInfo.value = timeRes.value
        setFetchState('timeInfo', timeRes.value ? 'ok' : 'missing', timeRes.value ? '' : '返回为空')
        lastTimeRefreshAt = now
        hasUpdatedMetric = true
      } else if (needsTime && timeRes.status === 'rejected') {
        setFetchState('timeInfo', 'error', normalizeErrorMessage(timeRes.reason))
      }

      if (hasUpdatedMetric) {
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

async function initOverviewHardwareData() {
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
      setFetchState('memoryLayout', memoLayoutData.value.length ? 'ok' : 'missing', memoLayoutData.value.length ? '' : '返回空数组')
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

    const [diskLayoutRes, biosRes, systemRes, displaysRes, audioRes, networkRes] = await Promise.allSettled([
      readService(() => window.services.getDiskLayout(), 15000, 1),
      readService(() => window.services.getBiosData(), 10000, 1),
      readService(() => window.services.getSystemData(), 10000, 1),
      readService(() => window.services.getDisplaysData(), 12000, 1),
      readService(() => window.services.getAudioDevices(), 10000, 1),
      readService(() => window.services.getNetworkInterfaces(), 12000, 1),
    ])

    if (diskLayoutRes.status === 'fulfilled') {
      diskLayoutData.value = diskLayoutRes.value || []
      setFetchState('diskLayout', diskLayoutData.value.length ? 'ok' : 'missing', diskLayoutData.value.length ? '' : '返回空数组')
    } else {
      setFetchState('diskLayout', 'error', normalizeErrorMessage(diskLayoutRes.reason))
    }

    if (biosRes.status === 'fulfilled') {
      biosData.value = biosRes.value
      setFetchState('biosData', biosRes.value ? 'ok' : 'missing', biosRes.value ? '' : '返回为空')
    } else {
      setFetchState('biosData', 'error', normalizeErrorMessage(biosRes.reason))
    }

    if (systemRes.status === 'fulfilled') {
      systemData.value = systemRes.value
      setFetchState('systemData', systemRes.value ? 'ok' : 'missing', systemRes.value ? '' : '返回为空')
    } else {
      setFetchState('systemData', 'error', normalizeErrorMessage(systemRes.reason))
    }

    if (displaysRes.status === 'fulfilled') {
      displaysData.value = displaysRes.value || []
      setFetchState('displaysData', displaysData.value.length ? 'ok' : 'missing', displaysData.value.length ? '' : '返回空数组')
    } else {
      setFetchState('displaysData', 'error', normalizeErrorMessage(displaysRes.reason))
    }

    if (audioRes.status === 'fulfilled') {
      audioDevices.value = audioRes.value || []
      setFetchState('audioDevices', audioDevices.value.length ? 'ok' : 'missing', audioDevices.value.length ? '' : '返回空数组')
    } else {
      setFetchState('audioDevices', 'error', normalizeErrorMessage(audioRes.reason))
    }

    if (networkRes.status === 'fulfilled') {
      networkInterfaces.value = networkRes.value || []
      setFetchState('networkInterfaces', networkInterfaces.value.length ? 'ok' : 'missing', networkInterfaces.value.length ? '' : '返回空数组')
    } else {
      setFetchState('networkInterfaces', 'error', normalizeErrorMessage(networkRes.reason))
    }

    await refreshOverviewMetrics(true)
  } finally {
    initialized.value = true
    loading.value = false
  }
}

function startPolling() {
  if (pollingTimerId || subscriberCount <= 0) return

  if (!lastSyncedAt.value || Date.now() - lastSyncedAt.value > getCurrentRefreshIntervals().base) {
    refreshOverviewMetrics()
  }

  const scheduleNext = () => {
    if (subscriberCount <= 0) {
      pollingTimerId = undefined
      return
    }

    pollingTimerId = window.setTimeout(async () => {
      pollingTimerId = undefined
      await refreshOverviewMetrics()
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

export async function activateOverviewHardwareStore() {
  subscriberCount += 1
  diagnostics.markActivated(subscriberCount)
  syncMonitoringVisibility()

  if (!initialized.value) {
    if (!initPromise) {
      initPromise = initOverviewHardwareData().finally(() => {
        initPromise = undefined
      })
    }

    await initPromise
  }

  await ensureMonitoringRefreshSettingsLoaded()
  startPolling()
}

export async function refreshOverviewHardwareData() {
  if (!initialized.value) {
    if (!initPromise) {
      initPromise = initOverviewHardwareData().finally(() => {
        initPromise = undefined
      })
    }

    await initPromise
    return
  }

  await refreshOverviewMetrics(true)
}

export function deactivateOverviewHardwareStore() {
  subscriberCount = Math.max(0, subscriberCount - 1)
  diagnostics.markDeactivated(subscriberCount)
  if (subscriberCount === 0) {
    stopPolling()
  }
}

export async function updateOverviewMonitoringRefreshSettings(patch: Partial<MonitoringRefreshSettingsData>) {
  monitoringRefreshSettings.value = await window.services.updateMonitoringRefreshSettings(patch)
  backgroundThrottled.value = resolveMonitoringBackgroundThrottled(monitoringRefreshSettings.value.backgroundThrottleEnabled)
  restartPolling()
  return monitoringRefreshSettings.value
}

export const overviewHardwareStore = {
  loading,
  initialized,
  lastSyncedAt,
  monitoringRefreshSettings,
  backgroundThrottled,
  cpuData,
  cpuTemperature,
  cpuLoad,
  cpuCurrentSpeed,
  memoData,
  memoLayoutData,
  gpuData,
  primaryGpu,
  diskData,
  diskLayoutData,
  boardData,
  biosData,
  systemData,
  displaysData,
  osInfo,
  timeInfo,
  audioDevices,
  networkInterfaces,
  metricHistory,
  fetchState,
  diagnostics: diagnostics.state,
  usedMemoPercent,
  storageUsage,
}
