import { reactive, ref } from 'vue'
import { normalizeErrorMessage, readService } from '../utils/serviceReader'

type DeviceSpecsFetchStatus = 'pending' | 'ok' | 'missing' | 'error'
export type DeviceSpecsServiceKey =
  | 'cpuInfo'
  | 'memInfo'
  | 'memoryLayout'
  | 'gpuInfo'
  | 'diskData'
  | 'diskLayout'
  | 'boardData'
  | 'biosData'
  | 'systemData'
  | 'displaysData'
  | 'osInfo'
  | 'audioDevices'
  | 'networkAdapters'

const loading = ref(true)
const loaded = ref(false)
const pendingReads = ref(0)
const lastSyncedAt = ref<number>()

const cpuData = ref<CpuData>()
const memoData = ref<MemoData>({
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
})
const memoLayoutData = ref<MemoLayoutData[]>([])
const gpuData = ref<GpuData[]>([])
const diskData = ref<DiskData[]>([])
const diskLayoutData = ref<DiskLayoutData[]>([])
const boardData = ref<BoardData>()
const biosData = ref<BiosInfoData>()
const systemData = ref<SystemData>()
const displaysData = ref<DisplayData[]>([])
const osInfo = ref<OsInfoData>()
const audioDevices = ref<AudioDeviceData[]>([])
const networkAdapters = ref<NetworkAdapterSpecData[]>([])

const fetchState = reactive<Record<DeviceSpecsServiceKey, { status: DeviceSpecsFetchStatus; note: string }>>({
  cpuInfo: { status: 'pending', note: '' },
  memInfo: { status: 'pending', note: '' },
  memoryLayout: { status: 'pending', note: '' },
  gpuInfo: { status: 'pending', note: '' },
  diskData: { status: 'pending', note: '' },
  diskLayout: { status: 'pending', note: '' },
  boardData: { status: 'pending', note: '' },
  biosData: { status: 'pending', note: '' },
  systemData: { status: 'pending', note: '' },
  displaysData: { status: 'pending', note: '' },
  osInfo: { status: 'pending', note: '' },
  audioDevices: { status: 'pending', note: '' },
  networkAdapters: { status: 'pending', note: '' },
})

let loadPromise: Promise<void> | undefined

function setFetchState(key: DeviceSpecsServiceKey, status: DeviceSpecsFetchStatus, note = '') {
  fetchState[key].status = status
  fetchState[key].note = note
}

async function readAndApply<T>(
  key: DeviceSpecsServiceKey,
  reader: () => Promise<T>,
  apply: (value: T) => void,
  hasValue: (value: T) => boolean
) {
  pendingReads.value += 1
  loading.value = true
  setFetchState(key, 'pending')

  try {
    const value = await reader()
    apply(value)
    setFetchState(key, hasValue(value) ? 'ok' : 'missing', hasValue(value) ? '' : '系统未返回可用数据')
  } catch (error) {
    setFetchState(key, 'error', normalizeErrorMessage(error))
    // A specs surface should degrade per field; one unsupported source must not block the rest.
  } finally {
    pendingReads.value = Math.max(0, pendingReads.value - 1)
    if (pendingReads.value === 0) loading.value = false
  }
}

async function readDeviceSpecsHardwareData() {
  await Promise.all([
    readAndApply(
      'cpuInfo',
      () => readService(() => window.services.getCpuInfo(), 10000, 1),
      (value) => { cpuData.value = value },
      Boolean
    ),
    readAndApply(
      'memInfo',
      () => readService(() => window.services.getStaticMemInfo(), 10000, 1),
      (value) => { memoData.value = value },
      (value) => Boolean(value?.total)
    ),
    readAndApply(
      'memoryLayout',
      () => readService(() => window.services.getMemoryLayout(), 10000, 1),
      (value) => { memoLayoutData.value = value || [] },
      (value) => Boolean(value?.length)
    ),
    readAndApply(
      'gpuInfo',
      () => readService(() => window.services.getStaticGpuInfo(), 12000, 1),
      (value) => { gpuData.value = value || [] },
      (value) => Boolean(value?.length)
    ),
    readAndApply(
      'diskData',
      () => readService(() => window.services.getDiskData(), 10000, 1),
      (value) => { diskData.value = value || [] },
      (value) => Boolean(value?.length)
    ),
    readAndApply(
      'diskLayout',
      () => readService(() => window.services.getDiskLayout(), 15000, 1),
      (value) => { diskLayoutData.value = value || [] },
      (value) => Boolean(value?.length)
    ),
    readAndApply(
      'boardData',
      () => readService(() => window.services.getBoardData(), 8000, 1),
      (value) => { boardData.value = value },
      Boolean
    ),
    readAndApply(
      'biosData',
      () => readService(() => window.services.getBiosData(), 10000, 1),
      (value) => { biosData.value = value },
      Boolean
    ),
    readAndApply(
      'systemData',
      () => readService(() => window.services.getSystemData(), 10000, 1),
      (value) => { systemData.value = value },
      Boolean
    ),
    readAndApply(
      'displaysData',
      () => readService(() => window.services.getDisplaysData(), 12000, 1),
      (value) => { displaysData.value = value || [] },
      (value) => Boolean(value?.length)
    ),
    readAndApply(
      'osInfo',
      () => readService(() => window.services.getOsInfo(), 8000, 1),
      (value) => { osInfo.value = value },
      Boolean
    ),
    readAndApply(
      'audioDevices',
      () => readService(() => window.services.getAudioDevices(), 10000, 1),
      (value) => { audioDevices.value = value || [] },
      (value) => Boolean(value?.length)
    ),
    readAndApply(
      'networkAdapters',
      () => readService(() => window.services.getNetworkAdapters(), 12000, 1),
      (value) => { networkAdapters.value = value || [] },
      (value) => Boolean(value?.length)
    ),
  ])

  lastSyncedAt.value = Date.now()
}

export async function loadDeviceSpecsHardwareData(force = false) {
  if (!force && loaded.value) return
  if (loadPromise) return loadPromise

  loading.value = true
  loadPromise = (async () => {
    try {
      await readDeviceSpecsHardwareData()
      loaded.value = true
    } finally {
      loading.value = false
      loadPromise = undefined
    }
  })()

  return loadPromise
}

export async function refreshDeviceSpecsHardwareData() {
  loaded.value = false
  await loadDeviceSpecsHardwareData(true)
}

export function useDeviceSpecsHardwareData() {
  return {
    loading,
    loaded,
    pendingReads,
    lastSyncedAt,
    cpuData,
    memoData,
    memoLayoutData,
    gpuData,
    diskData,
    diskLayoutData,
    boardData,
    biosData,
    systemData,
    displaysData,
    osInfo,
    audioDevices,
    networkAdapters,
    fetchState,
    loadDeviceSpecsHardwareData,
    refreshDeviceSpecsHardwareData,
  }
}
