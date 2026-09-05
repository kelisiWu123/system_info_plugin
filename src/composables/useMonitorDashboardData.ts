import { computed, reactive, ref } from 'vue'
import {
  DEFAULT_MONITORING_REFRESH_SETTINGS,
  appendMetricHistory,
  getMonitoringRefreshIntervals,
  type MonitoringRefreshSettingsData,
} from '../utils/monitoring'
import { getDisplayMemoryUsagePercent, getStorageUsageSummary } from '../utils'
import { selectPrimaryGpu } from '../utils/gpu'
import { bindMonitoringVisibilityListeners, resolveMonitoringBackgroundThrottled } from '../utils/monitoringVisibility'
import { normalizeErrorMessage, readService } from '../utils/serviceReader'

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

const emptyStorageIo: StorageIoData = {
  readBytesPerSec: null,
  writeBytesPerSec: null,
  totalBytesPerSec: null,
  readIops: null,
  writeIops: null,
  totalIops: null,
  waitPercent: null,
}

const emptyNetworkStatus: NetworkStatusData = {
  defaultInterface: '',
  gateway: '',
  latencyMs: null,
  operstate: '',
  rxSec: null,
  txSec: null,
}

type MonitorHistoryKey =
  | 'cpuLoad'
  | 'cpuTemp'
  | 'gpuLoad'
  | 'gpuTemp'
  | 'memoryLoad'
  | 'storageLoad'
  | 'networkRx'
  | 'networkTx'
  | 'diskRead'
  | 'diskWrite'

export type MonitorTelemetryKey =
  | 'cpuLoad'
  | 'cpuTemperature'
  | 'gpu'
  | 'memory'
  | 'storage'
  | 'storageIo'
  | 'network'
  | 'processes'
  | 'time'

export interface MonitorTelemetryStatus {
  lastSuccessAt?: number
  error: string
}

export interface MonitorRefreshResult {
  failedKeys: MonitorTelemetryKey[]
  successfulKeys: MonitorTelemetryKey[]
}

const loading = ref(true)
const initialized = ref(false)
const lastSyncedAt = ref<number>()
const lastError = ref('')
const monitoringRefreshSettings = ref<MonitoringRefreshSettingsData>({ ...DEFAULT_MONITORING_REFRESH_SETTINGS })
const backgroundThrottled = ref(false)

const cpuData = ref<CpuData>()
const cpuLoad = ref(0)
const cpuTemperature = ref<CpuTemperatureData>()
const memoData = ref<MemoData>(emptyMemoData)
const gpuData = ref<GpuData[]>([])
const diskData = ref<DiskData[]>([])
const diskLayoutData = ref<DiskLayoutData[]>([])
const osInfo = ref<OsInfoData>()
const storageIoData = ref<StorageIoData>({ ...emptyStorageIo })
const networkStatus = ref<NetworkStatusData>({ ...emptyNetworkStatus })
const topProcesses = ref<TopProcessData[]>([])
const timeInfo = ref<TimeData>()

const metricHistory = reactive<Record<MonitorHistoryKey, number[]>>({
  cpuLoad: [],
  cpuTemp: [],
  gpuLoad: [],
  gpuTemp: [],
  memoryLoad: [],
  storageLoad: [],
  networkRx: [],
  networkTx: [],
  diskRead: [],
  diskWrite: [],
})

const telemetryStatus = reactive<Record<MonitorTelemetryKey, MonitorTelemetryStatus>>({
  cpuLoad: { error: '' },
  cpuTemperature: { error: '' },
  gpu: { error: '' },
  memory: { error: '' },
  storage: { error: '' },
  storageIo: { error: '' },
  network: { error: '' },
  processes: { error: '' },
  time: { error: '' },
})

const telemetryLabels: Record<MonitorTelemetryKey, string> = {
  cpuLoad: 'CPU 使用率',
  cpuTemperature: 'CPU 温度',
  gpu: 'GPU 数据',
  memory: '内存数据',
  storage: '存储用量',
  storageIo: '存储 I/O',
  network: '网络数据',
  processes: '进程列表',
  time: '系统运行时间',
}

let subscriberCount = 0
let initPromise: Promise<void> | undefined
let refreshInFlight: Promise<MonitorRefreshResult> | undefined
let refreshInFlightIsForced = false
let queuedForceRefresh: Promise<MonitorRefreshResult> | undefined
let settingsPromise: Promise<void> | undefined
let pollingTimerId: number | undefined
let visibilityListenersBound = false

let lastCpuTempRefreshAt = 0
let lastGpuRefreshAt = 0
let lastMemoryRefreshAt = 0
let lastDiskRefreshAt = 0
let lastNetworkRefreshAt = 0
let lastProcessRefreshAt = 0
let lastTimeRefreshAt = 0

const primaryGpu = computed(() => selectPrimaryGpu(gpuData.value))
const usedMemoPercent = computed(() => getDisplayMemoryUsagePercent(memoData.value))
const storageUsage = computed(() => {
  const platform = osInfo.value?.platform?.toLowerCase?.() || ''
  return getStorageUsageSummary(diskData.value, diskLayoutData.value, platform)
})

function getRefreshIntervals() {
  return getMonitoringRefreshIntervals(monitoringRefreshSettings.value.profile, backgroundThrottled.value)
}

async function ensureRefreshSettingsLoaded() {
  if (settingsPromise) return settingsPromise

  settingsPromise = (async () => {
    try {
      monitoringRefreshSettings.value = await window.services.getMonitoringRefreshSettings()
    } catch {
      monitoringRefreshSettings.value = { ...DEFAULT_MONITORING_REFRESH_SETTINGS }
    }

    backgroundThrottled.value = resolveMonitoringBackgroundThrottled(
      monitoringRefreshSettings.value.backgroundThrottleEnabled
    )
  })().finally(() => {
    settingsPromise = undefined
  })

  return settingsPromise
}

function syncBackgroundMode() {
  const next = resolveMonitoringBackgroundThrottled(
    monitoringRefreshSettings.value.backgroundThrottleEnabled
  )
  if (next === backgroundThrottled.value) return
  backgroundThrottled.value = next
  restartPolling()
}

function bindVisibilityListeners() {
  visibilityListenersBound = bindMonitoringVisibilityListeners(visibilityListenersBound, syncBackgroundMode)
  backgroundThrottled.value = resolveMonitoringBackgroundThrottled(
    monitoringRefreshSettings.value.backgroundThrottleEnabled
  )
}

function updateTelemetryStatus(
  key: MonitorTelemetryKey,
  result: PromiseSettledResult<unknown>,
  completedAt: number
) {
  const status = telemetryStatus[key]
  if (result.status === 'fulfilled') {
    status.lastSuccessAt = completedAt
    status.error = ''
    return true
  }

  status.error = normalizeErrorMessage(result.reason)
  return false
}

function summarizeRefreshResults(
  results: ReadonlyArray<readonly [MonitorTelemetryKey, PromiseSettledResult<unknown>]>,
  completedAt: number
): MonitorRefreshResult {
  const failedKeys: MonitorTelemetryKey[] = []
  const successfulKeys: MonitorTelemetryKey[] = []

  for (const [key, result] of results) {
    if (updateTelemetryStatus(key, result, completedAt)) {
      successfulKeys.push(key)
    } else {
      failedKeys.push(key)
    }
  }

  lastError.value = (Object.keys(telemetryStatus) as MonitorTelemetryKey[])
    .filter((key) => telemetryStatus[key].error)
    .map((key) => telemetryLabels[key])
    .join('、')
  if (successfulKeys.length) lastSyncedAt.value = completedAt

  return { failedKeys, successfulKeys }
}

async function refreshMonitorMetrics(force = false): Promise<MonitorRefreshResult> {
  if (refreshInFlight) {
    if (!force || refreshInFlightIsForced) return refreshInFlight
    if (!queuedForceRefresh) {
      queuedForceRefresh = refreshInFlight
        .then(() => refreshMonitorMetrics(true))
        .finally(() => {
          queuedForceRefresh = undefined
        })
    }
    return queuedForceRefresh
  }

  refreshInFlightIsForced = force
  refreshInFlight = (async () => {
    const now = Date.now()
    const intervals = getRefreshIntervals()
    const needsCpuTemp = force || now - lastCpuTempRefreshAt >= intervals.cpuTemp
    const needsGpu = intervals.gpu > 0 && (force || now - lastGpuRefreshAt >= intervals.gpu)
    const needsMemory = force || now - lastMemoryRefreshAt >= intervals.memory
    const needsDisk = force || now - lastDiskRefreshAt >= intervals.disk
    const needsNetwork = force || now - lastNetworkRefreshAt >= Math.max(intervals.base, 3000)
    const needsProcesses = force || now - lastProcessRefreshAt >= Math.max(intervals.base * 2, 8000)
    const needsTime = force || now - lastTimeRefreshAt >= intervals.time

    const results = await Promise.allSettled([
      readService(() => window.services.getCpuFullLoad(), 6000),
      needsCpuTemp ? readService(() => window.services.getCpuTemperature(), 9000) : Promise.resolve(undefined),
      needsGpu ? readService(() => window.services.getGpuInfo(), 15000) : Promise.resolve(undefined),
      needsMemory ? readService(() => window.services.getMemInfo(), 6000) : Promise.resolve(undefined),
      needsDisk ? readService(() => window.services.getDiskData(), 10000) : Promise.resolve(undefined),
      needsDisk ? readService(() => window.services.getStorageIo(), 7000) : Promise.resolve(undefined),
      needsNetwork ? readService(() => window.services.getNetworkStatus(), 10000) : Promise.resolve(undefined),
      needsProcesses ? readService(() => window.services.getTopProcesses(), 12000) : Promise.resolve(undefined),
      needsTime ? readService(() => window.services.getTimeInfo(), 6000) : Promise.resolve(undefined),
    ])

    const [cpuLoadRes, cpuTempRes, gpuRes, memoRes, diskRes, storageIoRes, networkRes, processRes, timeRes] = results

    if (cpuLoadRes.status === 'fulfilled') {
      cpuLoad.value = cpuLoadRes.value || 0
      appendMetricHistory(metricHistory.cpuLoad, cpuLoad.value, true)
    }

    if (needsCpuTemp) {
      if (cpuTempRes.status === 'fulfilled') {
        cpuTemperature.value = cpuTempRes.value
        const value = typeof cpuTempRes.value?.value === 'number'
          ? cpuTempRes.value.value
          : typeof cpuTempRes.value?.main === 'number'
            ? cpuTempRes.value.main
            : 0
        appendMetricHistory(metricHistory.cpuTemp, value)
      }
      lastCpuTempRefreshAt = now
    }

    if (needsGpu) {
      if (gpuRes.status === 'fulfilled') {
        gpuData.value = gpuRes.value || []
        appendMetricHistory(metricHistory.gpuLoad, primaryGpu.value?.utilizationGpu || 0, true)
        appendMetricHistory(metricHistory.gpuTemp, primaryGpu.value?.temperatureGpu || 0)
      }
      lastGpuRefreshAt = now
    }

    if (needsMemory) {
      if (memoRes.status === 'fulfilled') {
        memoData.value = memoRes.value || emptyMemoData
        appendMetricHistory(metricHistory.memoryLoad, usedMemoPercent.value, true)
      }
      lastMemoryRefreshAt = now
    }

    if (needsDisk) {
      if (diskRes.status === 'fulfilled') {
        diskData.value = diskRes.value || []
        appendMetricHistory(metricHistory.storageLoad, storageUsage.value.percent, true)
      }

      if (storageIoRes.status === 'fulfilled' && storageIoRes.value) {
        storageIoData.value = storageIoRes.value
        appendMetricHistory(metricHistory.diskRead, storageIoData.value.readBytesPerSec || 0)
        appendMetricHistory(metricHistory.diskWrite, storageIoData.value.writeBytesPerSec || 0)
      }
      lastDiskRefreshAt = now
    }

    if (needsNetwork) {
      if (networkRes.status === 'fulfilled' && networkRes.value) {
        networkStatus.value = networkRes.value
        appendMetricHistory(metricHistory.networkRx, networkStatus.value.rxSec || 0)
        appendMetricHistory(metricHistory.networkTx, networkStatus.value.txSec || 0)
      }
      lastNetworkRefreshAt = now
    }

    if (needsProcesses) {
      if (processRes.status === 'fulfilled') {
        topProcesses.value = processRes.value || []
      }
      lastProcessRefreshAt = now
    }

    if (needsTime) {
      if (timeRes.status === 'fulfilled') timeInfo.value = timeRes.value
      lastTimeRefreshAt = now
    }

    const completedAt = Date.now()
    return summarizeRefreshResults([
      ['cpuLoad', cpuLoadRes],
      ...(needsCpuTemp ? [['cpuTemperature', cpuTempRes] as const] : []),
      ...(needsGpu ? [['gpu', gpuRes] as const] : []),
      ...(needsMemory ? [['memory', memoRes] as const] : []),
      ...(needsDisk
        ? [
            ['storage', diskRes] as const,
            ['storageIo', storageIoRes] as const,
          ]
        : []),
      ...(needsNetwork ? [['network', networkRes] as const] : []),
      ...(needsProcesses ? [['processes', processRes] as const] : []),
      ...(needsTime ? [['time', timeRes] as const] : []),
    ], completedAt)
  })().finally(() => {
    refreshInFlight = undefined
    refreshInFlightIsForced = false
  })

  return refreshInFlight
}

async function initializeMonitorDashboard() {
  await ensureRefreshSettingsLoaded()
  bindVisibilityListeners()

  const staticPromise = Promise.allSettled([
    readService(() => window.services.getCpuInfo(), 10000, 1),
    readService(() => window.services.getDiskLayout(), 15000, 1),
    readService(() => window.services.getOsInfo(), 8000, 1),
  ])

  try {
    const [staticResults] = await Promise.all([
      staticPromise,
      refreshMonitorMetrics(true),
    ])

    if (staticResults[0].status === 'fulfilled') cpuData.value = staticResults[0].value
    if (staticResults[1].status === 'fulfilled') diskLayoutData.value = staticResults[1].value || []
    if (staticResults[2].status === 'fulfilled') osInfo.value = staticResults[2].value
  } finally {
    initialized.value = true
    loading.value = false
  }
}

function scheduleNextPoll() {
  if (subscriberCount <= 0 || pollingTimerId) return

  pollingTimerId = window.setTimeout(async () => {
    pollingTimerId = undefined
    if (subscriberCount <= 0) return
    try {
      await refreshMonitorMetrics()
    } catch {
      lastError.value = '监控轮询'
    } finally {
      scheduleNextPoll()
    }
  }, getRefreshIntervals().base)
}

function startPolling() {
  if (subscriberCount <= 0) return
  scheduleNextPoll()
}

function stopPolling() {
  if (!pollingTimerId) return
  window.clearTimeout(pollingTimerId)
  pollingTimerId = undefined
}

function restartPolling() {
  stopPolling()
  startPolling()
}

export async function activateMonitorDashboard() {
  subscriberCount += 1

  if (!initialized.value) {
    if (!initPromise) {
      initPromise = initializeMonitorDashboard().finally(() => {
        initPromise = undefined
      })
    }
    await initPromise
  } else {
    await ensureRefreshSettingsLoaded()
    bindVisibilityListeners()
    await refreshMonitorMetrics()
  }

  startPolling()
}

export function deactivateMonitorDashboard() {
  subscriberCount = Math.max(0, subscriberCount - 1)
  if (subscriberCount === 0) stopPolling()
}

export async function refreshMonitorDashboardData(): Promise<MonitorRefreshResult> {
  return refreshMonitorMetrics(true)
}

export async function updateMonitorRefreshSettings(patch: Partial<MonitoringRefreshSettingsData>) {
  monitoringRefreshSettings.value = await window.services.updateMonitoringRefreshSettings(patch)
  backgroundThrottled.value = resolveMonitoringBackgroundThrottled(
    monitoringRefreshSettings.value.backgroundThrottleEnabled
  )
  restartPolling()
  return monitoringRefreshSettings.value
}

export const monitorDashboardStore = {
  loading,
  initialized,
  lastSyncedAt,
  lastError,
  telemetryStatus,
  monitoringRefreshSettings,
  backgroundThrottled,
  cpuData,
  cpuLoad,
  cpuTemperature,
  memoData,
  gpuData,
  primaryGpu,
  diskData,
  diskLayoutData,
  storageIoData,
  storageUsage,
  networkStatus,
  topProcesses,
  timeInfo,
  usedMemoPercent,
  metricHistory,
}
