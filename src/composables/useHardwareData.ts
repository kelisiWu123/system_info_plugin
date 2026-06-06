import { computed, reactive, ref } from 'vue'
import { clampPercent } from '../utils'

export type FetchStatus = 'pending' | 'ok' | 'missing' | 'error'

export type OverviewServiceKey =
  | 'cpuInfo'
  | 'cpuTemperature'
  | 'cpuLoad'
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
  | 'cpuFan'
  | 'gpuClock'
  | 'gpuMemory'
  | 'gpuPower'
  | 'gpuFan'

const emptyMemoData: MemoData = {
  active: 0,
  available: 0,
  total: 0,
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
const cpuFan = ref<CpuFanData>()
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
  cpuFan: [],
  gpuClock: [],
  gpuMemory: [],
  gpuPower: [],
  gpuFan: [],
})

const fetchState = reactive<Record<OverviewServiceKey, { status: FetchStatus; note: string }>>({
  cpuInfo: { status: 'pending', note: '' },
  cpuTemperature: { status: 'pending', note: '' },
  cpuLoad: { status: 'pending', note: '' },
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
let refreshInFlight: Promise<void> | undefined
let pollingTimerId: number | undefined
let subscriberCount = 0

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

function normalizeErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : '未知错误'
}

function setFetchState(key: OverviewServiceKey, status: FetchStatus, note = '') {
  fetchState[key].status = status
  fetchState[key].note = note
}

function pushMetricHistory(key: SharedMetricHistoryKey, value: number, clamp = false) {
  const history = metricHistory[key]
  const nextValue = clamp ? clampPercent(value) : Number.isFinite(value) ? value : 0
  history.push(nextValue)
  if (history.length > 24) history.shift()
}

function gpuSelectionScore(gpu: GpuData) {
  const haystack = `${gpu.vendor || ''} ${gpu.model || ''} ${gpu.name || ''}`.toLowerCase()
  const memory = gpu.memoryTotal || gpu.vram || 0
  let score = 0

  if (gpu.utilizationGpu !== null && gpu.utilizationGpu !== undefined) score += 120
  if (gpu.temperatureGpu !== null && gpu.temperatureGpu !== undefined) score += 60
  if (gpu.powerDraw !== null && gpu.powerDraw !== undefined) score += 40
  if (gpu.bus) score += 20

  if (haystack.includes('nvidia') || haystack.includes('geforce') || haystack.includes('rtx') || haystack.includes('gtx')) score += 400
  if (haystack.includes('amd') || haystack.includes('radeon') || haystack.includes('rx ')) score += 320
  if (haystack.includes('intel')) score -= 180
  if (haystack.includes('uhd') || haystack.includes('iris') || haystack.includes('vega')) score -= 90
  if (memory >= 4096) score += 220
  else if (memory >= 2048) score += 120
  else if (memory > 0) score += 40
  if (gpu.vramDynamic) score -= 80

  return score
}

const primaryGpu = computed(() => {
  if (!gpuData.value.length) return undefined
  return [...gpuData.value].sort((left, right) => gpuSelectionScore(right) - gpuSelectionScore(left))[0]
})

const usedMemoPercent = computed(() => {
  if (!memoData.value.total) return 0
  return clampPercent((memoData.value.active / memoData.value.total) * 100)
})

const storageUsage = computed(() => {
  const list = diskData.value.filter((item) => item.size > 0)
  const total = list.reduce((sum, item) => sum + item.size, 0)
  const used = list.reduce((sum, item) => sum + item.used, 0)
  const percent = total > 0 ? clampPercent((used / total) * 100) : 0
  return { total, used, percent }
})

async function refreshDynamicMetrics() {
  if (refreshInFlight) return refreshInFlight

  refreshInFlight = (async () => {
    try {
      const [temperatureRes, cpuLoadRes, cpuLoadDataRes, cpuSpeedRes, cpuPowerRes, cpuVoltageRes, cpuFanRes, boardTelemetryRes, gpuRes, memoRes, diskRes, timeRes] = await Promise.allSettled([
        readService(() => window.services.getCpuTemperature(), 9000),
        readService(() => window.services.getCpuFullLoad(), 6000),
        readService(() => window.services.getCpuLoadData(), 7000),
        readService(() => window.services.getCpuCurrentSpeed(), 7000),
        readService(() => window.services.getCpuPower(), 7000),
        readService(() => window.services.getCpuVoltage(), 7000),
        readService(() => window.services.getCpuFanSpeed(), 7000),
        readService(() => window.services.getBoardTelemetry(), 7000),
        readService(() => window.services.getGpuInfo(), 15000),
        readService(() => window.services.getMemInfo(), 6000),
        readService(() => window.services.getDiskData(), 10000),
        readService(() => window.services.getTimeInfo(), 6000),
      ])

      if (temperatureRes.status === 'fulfilled') {
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
        pushMetricHistory('cpuTemp', nextCpuTemperatureValue || 0)
      } else {
        setFetchState('cpuTemperature', 'error', normalizeErrorMessage(temperatureRes.reason))
      }

      if (cpuLoadRes.status === 'fulfilled') {
        cpuLoad.value = cpuLoadRes.value
        setFetchState('cpuLoad', 'ok')
        pushMetricHistory('cpuLoad', cpuLoadRes.value, true)
      } else {
        setFetchState('cpuLoad', 'error', normalizeErrorMessage(cpuLoadRes.reason))
      }

      if (cpuLoadDataRes.status === 'fulfilled') {
        cpuLoadData.value = cpuLoadDataRes.value || emptyCurrentLoadData
      }

      if (cpuSpeedRes.status === 'fulfilled') {
        cpuCurrentSpeed.value = cpuSpeedRes.value || emptyCpuCurrentSpeedData
        pushMetricHistory('cpuSpeed', cpuSpeedRes.value?.avg || 0)
      }

      if (cpuPowerRes.status === 'fulfilled') {
        cpuPower.value = cpuPowerRes.value
        pushMetricHistory('cpuPower', cpuPowerRes.value?.value || 0)
      }

      if (cpuVoltageRes.status === 'fulfilled') {
        cpuVoltage.value = cpuVoltageRes.value
        pushMetricHistory('cpuVoltage', cpuVoltageRes.value?.value || 0)
      }

      if (cpuFanRes.status === 'fulfilled') {
        cpuFan.value = cpuFanRes.value
        pushMetricHistory('cpuFan', cpuFanRes.value?.value || 0)
      }

      if (boardTelemetryRes.status === 'fulfilled') {
        boardTelemetry.value = boardTelemetryRes.value
      }

      if (gpuRes.status === 'fulfilled') {
        gpuData.value = gpuRes.value || []
        setFetchState('gpuInfo', gpuRes.value.length ? 'ok' : 'missing', gpuRes.value.length ? '' : '返回空数组')

        const selectedGpu = [...(gpuRes.value || [])].sort((left, right) => gpuSelectionScore(right) - gpuSelectionScore(left))[0]
        pushMetricHistory('gpuTemp', selectedGpu?.temperatureGpu || 0)
        pushMetricHistory('gpuLoad', selectedGpu?.utilizationGpu || 0, true)
        pushMetricHistory('gpuClock', selectedGpu?.clockCore || 0)
        pushMetricHistory('gpuMemory', selectedGpu?.memoryUsed || 0)
        pushMetricHistory('gpuPower', selectedGpu?.powerDraw || 0)
        pushMetricHistory('gpuFan', selectedGpu?.fanSpeed || 0)
      } else {
        setFetchState('gpuInfo', 'error', normalizeErrorMessage(gpuRes.reason))
      }

      if (memoRes.status === 'fulfilled') {
        memoData.value = memoRes.value || emptyMemoData
        setFetchState('memInfo', memoRes.value.total > 0 ? 'ok' : 'missing', memoRes.value.total > 0 ? '' : 'total <= 0')
        pushMetricHistory('memoryLoad', usedMemoPercent.value, true)
      } else {
        setFetchState('memInfo', 'error', normalizeErrorMessage(memoRes.reason))
      }

      if (diskRes.status === 'fulfilled') {
        diskData.value = diskRes.value || []
        setFetchState('diskData', diskRes.value.length ? 'ok' : 'missing', diskRes.value.length ? '' : '返回空数组')
        pushMetricHistory('storageLoad', storageUsage.value.percent, true)
      } else {
        setFetchState('diskData', 'error', normalizeErrorMessage(diskRes.reason))
      }

      if (timeRes.status === 'fulfilled') {
        timeInfo.value = timeRes.value
        setFetchState('timeInfo', timeRes.value ? 'ok' : 'missing', timeRes.value ? '' : '返回为空')
      } else {
        setFetchState('timeInfo', 'error', normalizeErrorMessage(timeRes.reason))
      }

      lastSyncedAt.value = Date.now()
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

    await refreshDynamicMetrics()
  } finally {
    initialized.value = true
    loading.value = false
  }
}

function startPolling() {
  if (pollingTimerId) return

  if (!lastSyncedAt.value || Date.now() - lastSyncedAt.value > 3500) {
    refreshDynamicMetrics()
  }

  pollingTimerId = window.setInterval(() => {
    refreshDynamicMetrics()
  }, 4000)
}

function stopPolling() {
  if (pollingTimerId) {
    window.clearInterval(pollingTimerId)
    pollingTimerId = undefined
  }
}

export async function activateHardwareStore() {
  subscriberCount += 1

  if (!initialized.value) {
    if (!initPromise) {
      initPromise = initHardwareData().finally(() => {
        initPromise = undefined
      })
    }

    await initPromise
  }

  if (subscriberCount > 0) {
    startPolling()
  }
}

export function deactivateHardwareStore() {
  subscriberCount = Math.max(0, subscriberCount - 1)

  if (subscriberCount === 0) {
    stopPolling()
  }
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
  cpuFan,
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
  primaryGpu,
  usedMemoPercent,
  storageUsage,
}
