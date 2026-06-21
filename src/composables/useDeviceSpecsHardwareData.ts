import { ref } from 'vue'
import { readService } from '../utils/serviceReader'

const loading = ref(true)
const loaded = ref(false)

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
const timeInfo = ref<TimeData>()
const audioDevices = ref<AudioDeviceData[]>([])
const networkInterfaces = ref<NetworkInterfaceData[]>([])

let loadPromise: Promise<void> | undefined

async function readDeviceSpecsHardwareData() {
  const [
    cpuRes,
    memoRes,
    memoryLayoutRes,
    gpuRes,
    diskRes,
    diskLayoutRes,
    boardRes,
    biosRes,
    systemRes,
    displaysRes,
    osRes,
    timeRes,
    audioRes,
    networkRes,
  ] = await Promise.allSettled([
    readService(() => window.services.getCpuInfo(), 10000, 1),
    readService(() => window.services.getStaticMemInfo(), 10000, 1),
    readService(() => window.services.getMemoryLayout(), 10000, 1),
    readService(() => window.services.getStaticGpuInfo(), 12000, 1),
    readService(() => window.services.getDiskData(), 10000, 1),
    readService(() => window.services.getDiskLayout(), 15000, 1),
    readService(() => window.services.getBoardData(), 8000, 1),
    readService(() => window.services.getBiosData(), 10000, 1),
    readService(() => window.services.getSystemData(), 10000, 1),
    readService(() => window.services.getDisplaysData(), 12000, 1),
    readService(() => window.services.getOsInfo(), 8000, 1),
    readService(() => window.services.getTimeInfo(), 6000, 1),
    readService(() => window.services.getAudioDevices(), 10000, 1),
    readService(() => window.services.getNetworkInterfaces(), 12000, 1),
  ])

  if (cpuRes.status === 'fulfilled') cpuData.value = cpuRes.value
  if (memoRes.status === 'fulfilled') memoData.value = memoRes.value
  if (memoryLayoutRes.status === 'fulfilled') memoLayoutData.value = memoryLayoutRes.value || []
  if (gpuRes.status === 'fulfilled') gpuData.value = gpuRes.value || []
  if (diskRes.status === 'fulfilled') diskData.value = diskRes.value || []
  if (diskLayoutRes.status === 'fulfilled') diskLayoutData.value = diskLayoutRes.value || []
  if (boardRes.status === 'fulfilled') boardData.value = boardRes.value
  if (biosRes.status === 'fulfilled') biosData.value = biosRes.value
  if (systemRes.status === 'fulfilled') systemData.value = systemRes.value
  if (displaysRes.status === 'fulfilled') displaysData.value = displaysRes.value || []
  if (osRes.status === 'fulfilled') osInfo.value = osRes.value
  if (timeRes.status === 'fulfilled') timeInfo.value = timeRes.value
  if (audioRes.status === 'fulfilled') audioDevices.value = audioRes.value || []
  if (networkRes.status === 'fulfilled') networkInterfaces.value = networkRes.value || []
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
    timeInfo,
    audioDevices,
    networkInterfaces,
    loadDeviceSpecsHardwareData,
    refreshDeviceSpecsHardwareData,
  }
}
