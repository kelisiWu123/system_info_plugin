import { computed, reactive, ref } from 'vue'
import {
  appendMetricHistory,
  createMonitoringDiagnostics,
  getMonitoringRefreshIntervals,
} from '../utils/monitoring'
import { getDisplayMemoryUsagePercent, getStorageUsageSummary } from '../utils'
import { bindMonitoringVisibilityListeners, resolveMonitoringBackgroundThrottled } from '../utils/monitoringVisibility'
import { normalizeErrorMessage, readService } from '../utils/serviceReader'

export type SharedHardwareScope = 'board' | 'memory' | 'storage'
export type FetchStatus = 'pending' | 'ok' | 'missing' | 'error'

type SharedServiceKey =
  | 'cpuInfo'
  | 'memInfo'
  | 'memoryLayout'
  | 'diskData'
  | 'diskLayout'
  | 'biosData'
  | 'boardData'
  | 'osInfo'
  | 'audioDevices'
  | 'networkInterfaces'

type StaticServiceKey = Exclude<SharedServiceKey, 'memInfo' | 'diskData'>
type DynamicScope = Extract<SharedHardwareScope, 'memory' | 'storage'>

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

const cpuData = ref<CpuData>()
const memoData = ref<MemoData>(emptyMemoData)
const memoLayoutData = ref<MemoLayoutData[]>([])
const boardData = ref<BoardData>()
const biosData = ref<BiosInfoData>()
const diskLayoutData = ref<DiskLayoutData[]>([])
const diskData = ref<DiskData[]>([])
const storageIoData = ref<StorageIoData>({ ...emptyStorageIo })
const osInfo = ref<OsInfoData>()
const audioDevices = ref<AudioDeviceData[]>([])
const networkInterfaces = ref<NetworkInterfaceData[]>([])

const lastSyncedAt = ref<number>()
const backgroundThrottled = ref(false)
const diagnostics = createMonitoringDiagnostics('shared-detail')

const metricHistory = reactive({
  memoryLoad: [] as number[],
  storageLoad: [] as number[],
})

const fetchState = reactive<Record<SharedServiceKey, { status: FetchStatus; note: string }>>({
  cpuInfo: { status: 'pending', note: '' },
  memInfo: { status: 'pending', note: '' },
  memoryLayout: { status: 'pending', note: '' },
  diskData: { status: 'pending', note: '' },
  diskLayout: { status: 'pending', note: '' },
  biosData: { status: 'pending', note: '' },
  boardData: { status: 'pending', note: '' },
  osInfo: { status: 'pending', note: '' },
  audioDevices: { status: 'pending', note: '' },
  networkInterfaces: { status: 'pending', note: '' },
})

const activeScopeCounts = reactive<Record<SharedHardwareScope, number>>({
  board: 0,
  memory: 0,
  storage: 0,
})
const loadingScopeCounts = reactive<Record<SharedHardwareScope, number>>({
  board: 0,
  memory: 0,
  storage: 0,
})

const loadedStaticServices = new Set<StaticServiceKey>()
const staticReadsInFlight = new Map<StaticServiceKey, Promise<void>>()
const dynamicRefreshInFlight = new Map<DynamicScope, Promise<void>>()

let pollingTimerId: number | undefined
let visibilityListenersBound = false
let lastMemoryRefreshAt = 0
let lastStorageRefreshAt = 0

const loading = computed(() =>
  (Object.keys(activeScopeCounts) as SharedHardwareScope[])
    .some((scope) => activeScopeCounts[scope] > 0 && loadingScopeCounts[scope] > 0)
)
const usedMemoPercent = computed(() => getDisplayMemoryUsagePercent(memoData.value))
const storageUsage = computed(() => {
  const platform = osInfo.value?.platform?.toLowerCase?.() || ''
  return getStorageUsageSummary(diskData.value, diskLayoutData.value, platform)
})

function setFetchState(key: SharedServiceKey, status: FetchStatus, note = '') {
  fetchState[key].status = status
  fetchState[key].note = note
}

function getActiveSubscriberCount() {
  return Object.values(activeScopeCounts).reduce((sum, count) => sum + count, 0)
}

function hasActiveDynamicScope() {
  return activeScopeCounts.memory > 0 || activeScopeCounts.storage > 0
}

function getCurrentRefreshIntervals() {
  return getMonitoringRefreshIntervals('balanced', backgroundThrottled.value)
}

function updateBackgroundThrottled() {
  const next = resolveMonitoringBackgroundThrottled(true)
  if (next === backgroundThrottled.value) return
  backgroundThrottled.value = next
  restartPolling()
}

function syncMonitoringVisibility() {
  visibilityListenersBound = bindMonitoringVisibilityListeners(visibilityListenersBound, updateBackgroundThrottled)
  backgroundThrottled.value = resolveMonitoringBackgroundThrottled(true)
}

async function readStaticService<T>(
  key: StaticServiceKey,
  reader: () => Promise<T>,
  apply: (value: T) => void,
  hasValue: (value: T) => boolean,
  timeoutMs: number,
  force = false
) {
  if (!force && loadedStaticServices.has(key)) return
  const existing = staticReadsInFlight.get(key)
  if (existing) return existing

  setFetchState(key, 'pending')
  const promise = (async () => {
    try {
      const value = await readService(reader, timeoutMs, 1)
      apply(value)
      loadedStaticServices.add(key)
      setFetchState(key, hasValue(value) ? 'ok' : 'missing', hasValue(value) ? '' : '返回为空')
      lastSyncedAt.value = Date.now()
    } catch (error) {
      setFetchState(key, 'error', normalizeErrorMessage(error))
    }
  })().finally(() => {
    staticReadsInFlight.delete(key)
  })

  staticReadsInFlight.set(key, promise)
  return promise
}

const staticReaders: Record<StaticServiceKey, (force?: boolean) => Promise<void>> = {
  cpuInfo: (force = false) => readStaticService(
    'cpuInfo',
    () => window.services.getCpuInfo(),
    (value) => { cpuData.value = value },
    Boolean,
    10000,
    force
  ),
  memoryLayout: (force = false) => readStaticService(
    'memoryLayout',
    () => window.services.getMemoryLayout(),
    (value) => { memoLayoutData.value = value || [] },
    (value) => Boolean(value?.length),
    10000,
    force
  ),
  diskLayout: (force = false) => readStaticService(
    'diskLayout',
    () => window.services.getDiskLayout(),
    (value) => { diskLayoutData.value = value || [] },
    (value) => Boolean(value?.length),
    15000,
    force
  ),
  biosData: (force = false) => readStaticService(
    'biosData',
    () => window.services.getBiosData(),
    (value) => { biosData.value = value },
    Boolean,
    10000,
    force
  ),
  boardData: (force = false) => readStaticService(
    'boardData',
    () => window.services.getBoardData(),
    (value) => { boardData.value = value },
    Boolean,
    8000,
    force
  ),
  osInfo: (force = false) => readStaticService(
    'osInfo',
    () => window.services.getOsInfo(),
    (value) => { osInfo.value = value },
    Boolean,
    8000,
    force
  ),
  audioDevices: (force = false) => readStaticService(
    'audioDevices',
    () => window.services.getAudioDevices(),
    (value) => { audioDevices.value = value || [] },
    (value) => Boolean(value?.length),
    10000,
    force
  ),
  networkInterfaces: (force = false) => readStaticService(
    'networkInterfaces',
    () => window.services.getNetworkInterfaces(),
    (value) => { networkInterfaces.value = value || [] },
    (value) => Boolean(value?.length),
    12000,
    force
  ),
}

const scopeStaticRequirements: Record<SharedHardwareScope, StaticServiceKey[]> = {
  memory: ['memoryLayout', 'boardData'],
  storage: ['diskLayout', 'osInfo'],
  board: [
    'cpuInfo',
    'memoryLayout',
    'boardData',
    'biosData',
    'diskLayout',
    'audioDevices',
    'networkInterfaces',
    'osInfo',
  ],
}

async function loadStaticScope(scope: SharedHardwareScope, force = false) {
  await Promise.all(scopeStaticRequirements[scope].map((key) => staticReaders[key](force)))
}

async function refreshMemory(force = false) {
  const existing = dynamicRefreshInFlight.get('memory')
  if (existing) return existing

  const intervals = getCurrentRefreshIntervals()
  const now = Date.now()
  if (!force && (intervals.memory <= 0 || now - lastMemoryRefreshAt < intervals.memory)) return

  diagnostics.markRefreshAttempt(force, backgroundThrottled.value)
  const promise = (async () => {
    setFetchState('memInfo', 'pending')
    try {
      const value = await readService(() => window.services.getMemInfo(), 6000)
      memoData.value = value || emptyMemoData
      setFetchState('memInfo', memoData.value.total > 0 ? 'ok' : 'missing', memoData.value.total > 0 ? '' : 'total <= 0')
      appendMetricHistory(metricHistory.memoryLoad, usedMemoPercent.value, true)
      lastMemoryRefreshAt = Date.now()
      lastSyncedAt.value = lastMemoryRefreshAt
      diagnostics.markRefreshSuccess(backgroundThrottled.value)
    } catch (error) {
      setFetchState('memInfo', 'error', normalizeErrorMessage(error))
    }
  })().finally(() => {
    dynamicRefreshInFlight.delete('memory')
  })

  dynamicRefreshInFlight.set('memory', promise)
  return promise
}

async function refreshStorage(force = false) {
  const existing = dynamicRefreshInFlight.get('storage')
  if (existing) return existing

  const intervals = getCurrentRefreshIntervals()
  const now = Date.now()
  if (!force && (intervals.disk <= 0 || now - lastStorageRefreshAt < intervals.disk)) return

  diagnostics.markRefreshAttempt(force, backgroundThrottled.value)
  const promise = (async () => {
    setFetchState('diskData', 'pending')
    const [diskResult, ioResult] = await Promise.allSettled([
      readService(() => window.services.getDiskData(), 10000),
      readService(() => window.services.getStorageIo(), 8000),
    ])

    if (diskResult.status === 'fulfilled') {
      diskData.value = diskResult.value || []
      setFetchState('diskData', diskData.value.length ? 'ok' : 'missing', diskData.value.length ? '' : '返回空数组')
      appendMetricHistory(metricHistory.storageLoad, storageUsage.value.percent, true)
    } else {
      setFetchState('diskData', 'error', normalizeErrorMessage(diskResult.reason))
    }

    if (ioResult.status === 'fulfilled' && ioResult.value) {
      storageIoData.value = ioResult.value
    }

    lastStorageRefreshAt = Date.now()
    lastSyncedAt.value = lastStorageRefreshAt
    if (diskResult.status === 'fulfilled' || ioResult.status === 'fulfilled') {
      diagnostics.markRefreshSuccess(backgroundThrottled.value)
    }
  })().finally(() => {
    dynamicRefreshInFlight.delete('storage')
  })

  dynamicRefreshInFlight.set('storage', promise)
  return promise
}

async function refreshDynamicScope(scope: SharedHardwareScope, force = false) {
  if (scope === 'memory') return refreshMemory(force)
  if (scope === 'storage') return refreshStorage(force)
}

async function loadScope(scope: SharedHardwareScope, force = false) {
  loadingScopeCounts[scope] += 1
  try {
    await Promise.all([
      loadStaticScope(scope, force),
      refreshDynamicScope(scope, force),
    ])
  } finally {
    loadingScopeCounts[scope] = Math.max(0, loadingScopeCounts[scope] - 1)
  }
}

async function refreshActiveDynamicScopes() {
  const tasks: Promise<void>[] = []
  if (activeScopeCounts.memory > 0) tasks.push(Promise.resolve(refreshMemory()))
  if (activeScopeCounts.storage > 0) tasks.push(Promise.resolve(refreshStorage()))
  if (!tasks.length) {
    diagnostics.markRefreshSkipped('no-active-requirements', backgroundThrottled.value)
    return
  }
  await Promise.all(tasks)
}

function scheduleNextPoll() {
  if (pollingTimerId || !hasActiveDynamicScope()) return
  pollingTimerId = window.setTimeout(async () => {
    pollingTimerId = undefined
    if (!hasActiveDynamicScope()) return
    await refreshActiveDynamicScopes()
    scheduleNextPoll()
  }, getCurrentRefreshIntervals().base)
}

function startPolling() {
  if (!hasActiveDynamicScope()) return
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

export async function activateHardwareStore(scope: SharedHardwareScope) {
  activeScopeCounts[scope] += 1
  diagnostics.markActivated(getActiveSubscriberCount())

  if (scope !== 'board') {
    syncMonitoringVisibility()
  }

  await loadScope(scope)
  startPolling()
}

export function deactivateHardwareStore(scope: SharedHardwareScope) {
  activeScopeCounts[scope] = Math.max(0, activeScopeCounts[scope] - 1)
  diagnostics.markDeactivated(getActiveSubscriberCount())
  if (!hasActiveDynamicScope()) {
    stopPolling()
    return
  }
  restartPolling()
}

export async function refreshHardwareData(scope: SharedHardwareScope) {
  await loadScope(scope, true)
}

export const hardwareStore = {
  loading,
  lastSyncedAt,
  cpuData,
  memoData,
  memoLayoutData,
  boardData,
  biosData,
  diskLayoutData,
  diskData,
  storageIoData,
  osInfo,
  audioDevices,
  networkInterfaces,
  metricHistory,
  fetchState,
  backgroundThrottled,
  diagnostics: diagnostics.state,
  storageUsage,
}
