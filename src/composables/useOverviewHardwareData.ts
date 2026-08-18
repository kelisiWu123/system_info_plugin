import { computed, reactive, ref } from 'vue'
import {
  createMonitoringDiagnostics,
  getMonitoringRefreshIntervals,
} from '../utils/monitoring'
import { getStorageUsageSummary } from '../utils'
import { selectPrimaryGpu } from '../utils/gpu'
import { bindMonitoringVisibilityListeners, resolveMonitoringBackgroundThrottled } from '../utils/monitoringVisibility'
import { normalizeErrorMessage, readService } from '../utils/serviceReader'

type FetchStatus = 'pending' | 'ok' | 'missing' | 'error'

export type OverviewLiteServiceKey =
  | 'cpuInfo'
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
  | 'networkStatus'
  | 'timeInfo'

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
  networkStatus: '网络状态',
  timeInfo: '运行时间',
}

const loading = ref(true)
const initialized = ref(false)
const lastSyncedAt = ref<number>()
const backgroundThrottled = ref(false)

const cpuData = ref<CpuData>()
const memoData = ref<MemoData>(emptyMemoData)
const memoLayoutData = ref<MemoLayoutData[]>([])
const gpuData = ref<GpuData[]>([])
const primaryGpu = ref<GpuData>()
const diskData = ref<DiskData[]>([])
const diskLayoutData = ref<DiskLayoutData[]>([])
const boardData = ref<BoardData>()
const biosData = ref<BiosInfoData>()
const displaysData = ref<DisplayData[]>([])
const osInfo = ref<OsInfoData>()
const timeInfo = ref<TimeData>()
const audioDevices = ref<AudioDeviceData[]>([])
const networkInterfaces = ref<NetworkInterfaceData[]>([])
const networkStatus = ref<NetworkStatusData>({
  defaultInterface: '',
  gateway: '',
  latencyMs: null,
  operstate: '',
  rxSec: null,
  txSec: null,
})

const fetchState = reactive<Record<OverviewLiteServiceKey, { status: FetchStatus; note: string }>>({
  cpuInfo: { status: 'pending', note: '' },
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
  networkStatus: { status: 'pending', note: '' },
  timeInfo: { status: 'pending', note: '' },
})

let initPromise: Promise<void> | undefined
let refreshInFlight: Promise<void> | undefined
let pollingTimerId: number | undefined
let subscriberCount = 0
let lastMemoryRefreshAt = 0
let lastDiskRefreshAt = 0
let lastTimeRefreshAt = 0
let lastNetworkStatusRefreshAt = 0
let visibilityListenersBound = false
const diagnostics = createMonitoringDiagnostics('overview-lite')

function setFetchState(key: OverviewLiteServiceKey, status: FetchStatus, note = '') {
  fetchState[key].status = status
  fetchState[key].note = note
}

const storageUsage = computed(() => {
  const platform = osInfo.value?.platform?.toLowerCase?.() || ''
  return getStorageUsageSummary(diskData.value, diskLayoutData.value, platform)
})

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

function getCurrentRefreshIntervals() {
  return getMonitoringRefreshIntervals('balanced', backgroundThrottled.value)
}

async function refreshOverviewMetrics(force = false) {
  if (refreshInFlight) return refreshInFlight

  refreshInFlight = (async () => {
    try {
      const now = Date.now()
      const intervals = getCurrentRefreshIntervals()
      diagnostics.markRefreshAttempt(force, backgroundThrottled.value)
      const needsMemory = force || now - lastMemoryRefreshAt >= intervals.memory
      const needsDisk = force || now - lastDiskRefreshAt >= intervals.disk
      const needsTime = force || now - lastTimeRefreshAt >= intervals.time
      const networkStatusInterval = Math.max(intervals.base * 2, 6000)
      const needsNetworkStatus = force || now - lastNetworkStatusRefreshAt >= networkStatusInterval

      if (!force && !needsMemory && !needsDisk && !needsTime && !needsNetworkStatus) {
        diagnostics.markRefreshSkipped('not-due', backgroundThrottled.value)
        return
      }

      const [memoRes, diskRes, timeRes, networkStatusRes] = await Promise.allSettled([
        needsMemory ? readService(() => window.services.getMemInfo(), 6000) : Promise.resolve(undefined),
        needsDisk ? readService(() => window.services.getDiskData(), 10000) : Promise.resolve(undefined),
        needsTime ? readService(() => window.services.getTimeInfo(), 6000) : Promise.resolve(undefined),
        needsNetworkStatus ? readService(() => window.services.getNetworkStatus(), 10000) : Promise.resolve(undefined),
      ])

      let hasUpdatedMetric = false

      if (needsMemory && memoRes.status === 'fulfilled') {
        const nextMemoData = memoRes.value || emptyMemoData
        memoData.value = nextMemoData
        setFetchState('memInfo', nextMemoData.total > 0 ? 'ok' : 'missing', nextMemoData.total > 0 ? '' : 'total <= 0')
        lastMemoryRefreshAt = now
        hasUpdatedMetric = true
      } else if (needsMemory && memoRes.status === 'rejected') {
        setFetchState('memInfo', 'error', normalizeErrorMessage(memoRes.reason))
      }

      if (needsDisk && diskRes.status === 'fulfilled') {
        const nextDiskData = diskRes.value || []
        diskData.value = nextDiskData
        setFetchState('diskData', nextDiskData.length ? 'ok' : 'missing', nextDiskData.length ? '' : '返回空数组')
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

      if (needsNetworkStatus && networkStatusRes.status === 'fulfilled' && networkStatusRes.value) {
        networkStatus.value = networkStatusRes.value
        setFetchState('networkStatus', networkStatusRes.value.defaultInterface ? 'ok' : 'missing', networkStatusRes.value.defaultInterface ? '' : '未识别默认网络接口')
        lastNetworkStatusRefreshAt = now
        hasUpdatedMetric = true
      } else if (needsNetworkStatus && networkStatusRes.status === 'rejected') {
        setFetchState('networkStatus', 'error', normalizeErrorMessage(networkStatusRes.reason))
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

async function runOverviewRead<T>(
  reader: () => Promise<T>,
  onSuccess: (value: T) => void,
  onError: (error: unknown) => void
) {
  try {
    onSuccess(await reader())
  } catch (error) {
    onError(error)
  }
}

async function loadOverviewCoreSummary() {
  await Promise.all([
    runOverviewRead(
      () => readService(() => window.services.getCpuInfo(), 10000, 1),
      (value) => {
        cpuData.value = value
        setFetchState('cpuInfo', value ? 'ok' : 'missing', value ? '' : '返回为空')
      },
      (error) => setFetchState('cpuInfo', 'error', normalizeErrorMessage(error))
    ),
    runOverviewRead(
      () => readService(() => window.services.getMemInfo(), 6000, 1),
      (value) => {
        memoData.value = value || emptyMemoData
        setFetchState('memInfo', memoData.value.total > 0 ? 'ok' : 'missing', memoData.value.total > 0 ? '' : 'total <= 0')
        lastMemoryRefreshAt = Date.now()
      },
      (error) => setFetchState('memInfo', 'error', normalizeErrorMessage(error))
    ),
  ])
}

async function loadOverviewEarlyEnrichment() {
  await Promise.all([
    runOverviewRead(
      () => readService(() => window.services.getOsInfo(), 8000, 1),
      (value) => {
        osInfo.value = value
        setFetchState('osInfo', value ? 'ok' : 'missing', value ? '' : '返回为空')
      },
      (error) => setFetchState('osInfo', 'error', normalizeErrorMessage(error))
    ),
    runOverviewRead(
      () => readService(() => window.services.getNetworkInterfaces(), 12000, 1),
      (value) => {
        networkInterfaces.value = value || []
        setFetchState('networkInterfaces', networkInterfaces.value.length ? 'ok' : 'missing', networkInterfaces.value.length ? '' : '返回空数组')
      },
      (error) => setFetchState('networkInterfaces', 'error', normalizeErrorMessage(error))
    ),
    runOverviewRead(
      () => readService(() => window.services.getNetworkStatus(), 10000),
      (value) => {
        networkStatus.value = value
        setFetchState('networkStatus', value.defaultInterface ? 'ok' : 'missing', value.defaultInterface ? '' : '未识别默认网络接口')
        lastNetworkStatusRefreshAt = Date.now()
      },
      (error) => setFetchState('networkStatus', 'error', normalizeErrorMessage(error))
    ),
  ])
}

async function hydrateOverviewDetails() {
  await Promise.all([
    runOverviewRead(
      () => readService(() => window.services.getMemoryLayout(), 10000, 1),
      (value) => {
        memoLayoutData.value = value || []
        setFetchState('memoryLayout', memoLayoutData.value.length ? 'ok' : 'missing', memoLayoutData.value.length ? '' : '返回空数组')
      },
      (error) => setFetchState('memoryLayout', 'error', normalizeErrorMessage(error))
    ),
    runOverviewRead(
      () => readService(() => window.services.getBoardData(), 8000, 1),
      (value) => {
        boardData.value = value
        setFetchState('boardData', value ? 'ok' : 'missing', value ? '' : '返回为空')
      },
      (error) => setFetchState('boardData', 'error', normalizeErrorMessage(error))
    ),
    runOverviewRead(
      () => readService(() => window.services.getDiskLayout(), 15000, 1),
      (value) => {
        diskLayoutData.value = value || []
        setFetchState('diskLayout', diskLayoutData.value.length ? 'ok' : 'missing', diskLayoutData.value.length ? '' : '返回空数组')
      },
      (error) => setFetchState('diskLayout', 'error', normalizeErrorMessage(error))
    ),
    runOverviewRead(
      () => readService(() => window.services.getBiosData(), 10000, 1),
      (value) => {
        biosData.value = value
        setFetchState('biosData', value ? 'ok' : 'missing', value ? '' : '返回为空')
      },
      (error) => setFetchState('biosData', 'error', normalizeErrorMessage(error))
    ),
    runOverviewRead(
      () => readService(() => window.services.getStaticGpuInfo(), 12000, 1),
      (value) => {
        gpuData.value = value || []
        primaryGpu.value = selectPrimaryGpu(gpuData.value)
        setFetchState('gpuInfo', gpuData.value.length ? 'ok' : 'missing', gpuData.value.length ? '' : '返回空数组')
      },
      (error) => setFetchState('gpuInfo', 'error', normalizeErrorMessage(error))
    ),
    runOverviewRead(
      () => readService(() => window.services.getDisplaysData(), 12000, 1),
      (value) => {
        displaysData.value = value || []
        setFetchState('displaysData', displaysData.value.length ? 'ok' : 'missing', displaysData.value.length ? '' : '返回空数组')
      },
      (error) => setFetchState('displaysData', 'error', normalizeErrorMessage(error))
    ),
    runOverviewRead(
      () => readService(() => window.services.getAudioDevices(), 10000, 1),
      (value) => {
        audioDevices.value = value || []
        setFetchState('audioDevices', audioDevices.value.length ? 'ok' : 'missing', audioDevices.value.length ? '' : '返回空数组')
      },
      (error) => setFetchState('audioDevices', 'error', normalizeErrorMessage(error))
    ),
  ])

  await refreshOverviewMetrics()
}

async function initOverviewHardwareData() {
  const earlyEnrichmentPromise = loadOverviewEarlyEnrichment().catch(() => undefined)

  try {
    await loadOverviewCoreSummary()
    loading.value = false
    await hydrateOverviewDetails()
  } finally {
    initialized.value = true
    loading.value = false
    void earlyEnrichmentPromise
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

export const overviewHardwareStore = {
  loading,
  initialized,
  lastSyncedAt,
  backgroundThrottled,
  cpuData,
  memoData,
  memoLayoutData,
  gpuData,
  primaryGpu,
  diskData,
  diskLayoutData,
  boardData,
  biosData,
  displaysData,
  osInfo,
  timeInfo,
  audioDevices,
  networkInterfaces,
  networkStatus,
  fetchState,
  diagnostics: diagnostics.state,
  storageUsage,
}
