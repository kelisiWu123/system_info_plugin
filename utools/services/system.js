import si from 'systeminformation'
import fs from 'node:fs'
import path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const HARDWARE_SENSOR_SETTINGS_STORAGE_KEY = 'hardwareSensorSettings'
const DEFAULT_HARDWARE_SENSOR_SETTINGS = {
  enhancedSensorEnabled: false,
  openHardwareMonitorAutoStart: false,
  openHardwareMonitorPort: 18085,
}
const OPEN_HARDWARE_MONITOR_PROCESS_NAME = 'OpenHardwareMonitor.exe'
const OPEN_HARDWARE_MONITOR_HTTP_TIMEOUT_MS = 1500
const OPEN_HARDWARE_MONITOR_START_COOLDOWN_MS = 15000
const MAC_MEMORY_PRESSURE_FALLBACK = {
  level: 'unknown',
  rawLevel: null,
  availablePercent: null,
  source: 'fallback',
}

const emptyNetworkStats = {
  rx_sec: 0,
  tx_sec: 0,
}

const emptyCurrentLoadData = {
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

let gpuInfoCache = []
let gpuInfoCacheAt = 0
let gpuInfoPromise
let openHardwareMonitorLastStartAt = 0
let openHardwareMonitorStartPromise
let openHardwareMonitorManagedPid = null

async function readSystemInfo(label, fallback, reader) {
  try {
    return await reader()
  } catch (error) {
    console.warn(`[system-info] ${label} failed`, error)
    return fallback
  }
}

function normalizeJsonArray(value) {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function toNumber(value) {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : null
}

function isWindows() {
  return typeof process !== 'undefined' && process.platform === 'win32'
}

function isValidCpuTemperature(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 120
}

function toValidCpuTemperature(value) {
  const numericValue = toNumber(value)
  return isValidCpuTemperature(numericValue) ? Math.round(numericValue * 10) / 10 : null
}

function roundTemperature(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 10) / 10 : null
}

function roundVoltage(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null
}

function roundFanSpeed(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null
}

function buildBoardMetric(unit, value = null, source = 'unsupported', sensorName = undefined, max = null) {
  return {
    value,
    source,
    sensorName,
    unit,
    max,
  }
}

function createEmptyBoardTelemetry() {
  return {
    boardTemperature: buildBoardMetric('°C'),
    vrmTemperature: buildBoardMetric('°C'),
    chipsetTemperature: buildBoardMetric('°C'),
    systemFan: buildBoardMetric('RPM'),
    voltage12V: buildBoardMetric('V'),
    voltage5V: buildBoardMetric('V'),
    voltage3V: buildBoardMetric('V'),
    voltageVBat: buildBoardMetric('V'),
    pchVoltage: buildBoardMetric('V'),
  }
}

function normalizeSensorText(sensor) {
  return `${sensor.name} ${sensor.identifier} ${sensor.parent}`.toLowerCase()
}

function getHardwareSensorSettingsStorage() {
  if (typeof utools !== 'undefined' && utools?.dbStorage) {
    return utools.dbStorage
  }

  return globalThis?.utools?.dbStorage
}

function readHardwareSensorSettingsRaw() {
  const storage = getHardwareSensorSettingsStorage()

  if (storage?.getItem) {
    return storage.getItem(HARDWARE_SENSOR_SETTINGS_STORAGE_KEY)
  }

  if (typeof localStorage !== 'undefined') {
    try {
      const value = localStorage.getItem(HARDWARE_SENSOR_SETTINGS_STORAGE_KEY)
      return value ? JSON.parse(value) : null
    } catch {
      return null
    }
  }

  return null
}

function writeHardwareSensorSettingsRaw(value) {
  const storage = getHardwareSensorSettingsStorage()

  if (storage?.setItem) {
    storage.setItem(HARDWARE_SENSOR_SETTINGS_STORAGE_KEY, value)
    return
  }

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(HARDWARE_SENSOR_SETTINGS_STORAGE_KEY, JSON.stringify(value))
    } catch {
      // ignore storage fallback failures
    }
  }
}

function normalizeHardwareSensorSettings(input) {
  const portCandidate = Number(input?.openHardwareMonitorPort)
  const port = Number.isInteger(portCandidate) && portCandidate >= 1 && portCandidate <= 65535
    ? portCandidate
    : DEFAULT_HARDWARE_SENSOR_SETTINGS.openHardwareMonitorPort

  return {
    enhancedSensorEnabled: Boolean(input?.enhancedSensorEnabled),
    openHardwareMonitorAutoStart: Boolean(input?.openHardwareMonitorAutoStart),
    openHardwareMonitorPort: port,
  }
}

function getHardwareSensorSettings() {
  return normalizeHardwareSensorSettings({
    ...DEFAULT_HARDWARE_SENSOR_SETTINGS,
    ...(readHardwareSensorSettingsRaw() || {}),
  })
}

async function stopPluginManagedOpenHardwareMonitor() {
  if (!isWindows() || !openHardwareMonitorManagedPid) {
    return {
      ok: false,
      reason: 'OHM_NOT_PLUGIN_MANAGED',
    }
  }

  const targetPid = openHardwareMonitorManagedPid

  try {
    await execFileAsync('taskkill.exe', ['/PID', String(targetPid), '/T', '/F'], {
      windowsHide: true,
      timeout: 4000,
    })
    openHardwareMonitorManagedPid = null
    return {
      ok: true,
      pid: targetPid,
    }
  } catch (error) {
    const stillRunning = await isProcessRunning(OPEN_HARDWARE_MONITOR_PROCESS_NAME)
    if (!stillRunning) {
      openHardwareMonitorManagedPid = null
      return {
        ok: true,
        pid: targetPid,
      }
    }

    return {
      ok: false,
      pid: targetPid,
      reason: 'OHM_STOP_FAILED',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function updateHardwareSensorSettings(patch = {}) {
  const previous = getHardwareSensorSettings()
  const next = normalizeHardwareSensorSettings({
    ...previous,
    ...patch,
  })
  writeHardwareSensorSettingsRaw(next)

  if (previous.enhancedSensorEnabled && !next.enhancedSensorEnabled) {
    await stopPluginManagedOpenHardwareMonitor()
  }

  return next
}

async function queryWmiSensors(namespace, sensorType) {
  const script = [
    `$items = Get-CimInstance -Namespace "${namespace}" -ClassName Sensor -ErrorAction Stop`,
    `$items | Where-Object { $_.SensorType -eq "${sensorType}" } | Select-Object Name, Identifier, Value, Parent, SensorType | ConvertTo-Json -Depth 4 -Compress`,
  ].join('; ')

  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
      timeout: 7000,
    })

    const output = stdout.trim()
    if (!output) return []

    return normalizeJsonArray(JSON.parse(output))
      .map((sensor) => ({
        name: sensor.Name || '',
        identifier: sensor.Identifier || '',
        parent: sensor.Parent || '',
        sensorType: sensor.SensorType || sensorType,
        value: toNumber(sensor.Value),
        source: namespace,
      }))
      .filter((sensor) => sensor.value !== null)
  } catch {
    return []
  }
}

const CPU_SENSOR_EXCLUSION_TERMS = [
  'gpu',
  'tmpin',
  'ssd',
  'hdd',
  'nvme',
  'motherboard',
  'mainboard',
  'pch',
  'vrm',
  'chipset',
  'acpi thermal zone',
  'thermal zone',
]

function isCpuSensor(sensor) {
  const haystack = normalizeSensorText(sensor)
  if (CPU_SENSOR_EXCLUSION_TERMS.some((term) => haystack.includes(term))) return false
  return (
    haystack.includes('cpu') ||
    haystack.includes('intelcpu') ||
    haystack.includes('amdcpu') ||
    haystack.includes('package') ||
    haystack.includes('tctl') ||
    haystack.includes('tdie') ||
    /core\s*#?\d+/.test(haystack) ||
    haystack.includes('core max')
  )
}

function isGpuSensor(sensor) {
  const haystack = `${sensor.name} ${sensor.identifier} ${sensor.parent}`.toLowerCase()
  if (haystack.includes('cpu')) return false
  return (
    haystack.includes('gpu') ||
    haystack.includes('nvidia') ||
    haystack.includes('geforce') ||
    haystack.includes('radeon') ||
    haystack.includes('amd') ||
    haystack.includes('intel graphics')
  )
}

const BOARD_SENSOR_EXCLUSION_TERMS = [
  'cpu',
  'gpu',
  'ssd',
  'hdd',
  'nvme',
  'acpi thermal zone',
  'thermal zone',
]

function isBoardTelemetrySensor(sensor) {
  const haystack = normalizeSensorText(sensor)
  if (BOARD_SENSOR_EXCLUSION_TERMS.some((term) => haystack.includes(term))) return false

  return (
    haystack.includes('motherboard') ||
    haystack.includes('mainboard') ||
    haystack.includes('system') ||
    haystack.includes('board') ||
    haystack.includes('vrm') ||
    haystack.includes('mos') ||
    haystack.includes('pch') ||
    haystack.includes('chipset') ||
    haystack.includes('12v') ||
    haystack.includes('5v') ||
    haystack.includes('3.3v') ||
    haystack.includes('3vcc') ||
    haystack.includes('vbat') ||
    haystack.includes('battery') ||
    haystack.includes('chassis') ||
    haystack.includes('case fan')
  )
}

function scoreCpuTemperatureSensor(sensor) {
  const haystack = normalizeSensorText(sensor)

  if (haystack.includes('cpu package') || haystack.includes('/package/temperature')) return 160
  if (haystack.includes(' package')) return 150
  if (haystack.includes('tctl/tdie')) return 145
  if (haystack.includes('tdie')) return 140
  if (haystack.includes('tctl')) return 130
  if (haystack.includes('cpu core max')) return 120
  if (haystack.includes('core max')) return 110
  if (/core\s*#?\d+/.test(haystack)) return 100
  if (haystack.includes('cpu') || haystack.includes('processor')) return 90
  return 50
}

function scoreCpuPowerSensor(sensor) {
  const haystack = `${sensor.name} ${sensor.identifier}`.toLowerCase()

  if (haystack.includes('package')) return 100
  if (haystack.includes('total')) return 95
  if (haystack.includes('cores')) return 85
  if (haystack.includes('core')) return 75
  return 50
}

function scoreCpuVoltageSensor(sensor) {
  const haystack = `${sensor.name} ${sensor.identifier}`.toLowerCase()

  if (haystack.includes('cpu vcore') || haystack.includes('vcore')) return 120
  if (haystack.includes('vid')) return 110
  if (haystack.includes('package')) return 100
  if (haystack.includes('core')) return 90
  return 50
}

function scoreCpuFanSensor(sensor) {
  const haystack = `${sensor.name} ${sensor.identifier} ${sensor.parent}`.toLowerCase()

  if (haystack.includes('cpu opt')) return 115
  if (haystack.includes('cpu fan')) return 120
  if (haystack.includes('cpu')) return 100
  if (haystack.includes('fan')) return 70
  return 40
}

function scoreGpuTemperatureSensor(sensor) {
  const haystack = `${sensor.name} ${sensor.identifier}`.toLowerCase()
  if (haystack.includes('hot spot') || haystack.includes('hotspot')) return 92
  if (haystack.includes('core')) return 100
  if (haystack.includes('gpu temperature')) return 96
  if (haystack.includes('temperature')) return 88
  if (haystack.includes('memory')) return 65
  return 50
}

function scoreGpuLoadSensor(sensor) {
  const haystack = `${sensor.name} ${sensor.identifier}`.toLowerCase()
  if (haystack.includes('core')) return 100
  if (haystack.includes('gpu')) return 95
  if (haystack.includes('3d')) return 90
  if (haystack.includes('memory')) return 60
  return 50
}

function scoreGpuPowerSensor(sensor) {
  const haystack = `${sensor.name} ${sensor.identifier}`.toLowerCase()
  if (haystack.includes('package')) return 100
  if (haystack.includes('total')) return 95
  if (haystack.includes('power')) return 90
  return 50
}

function scoreBoardTemperatureSensor(sensor, target) {
  const haystack = normalizeSensorText(sensor)

  if (target === 'board') {
    if (haystack.includes('motherboard')) return 130
    if (haystack.includes('mainboard')) return 126
    if (haystack.includes('system')) return 118
    if (haystack.includes('board')) return 112
  }

  if (target === 'vrm') {
    if (haystack.includes('vrm mos')) return 134
    if (haystack.includes('vrm')) return 130
    if (haystack.includes('mos')) return 118
  }

  if (target === 'chipset') {
    if (haystack.includes('chipset')) return 132
    if (haystack.includes('pch')) return 128
    if (haystack.includes('southbridge')) return 120
  }

  return 0
}

function scoreBoardVoltageSensor(sensor, target) {
  const haystack = normalizeSensorText(sensor)

  if (target === '12v') {
    if (haystack.includes('12v')) return 130
  }

  if (target === '5v') {
    if (haystack.includes('5v')) return 130
  }

  if (target === '3v') {
    if (haystack.includes('3.3v')) return 132
    if (haystack.includes('3vcc')) return 128
    if (haystack.includes('3v')) return 118
  }

  if (target === 'vbat') {
    if (haystack.includes('vbat')) return 132
    if (haystack.includes('battery')) return 120
  }

  if (target === 'pch') {
    if (haystack.includes('pch')) return 132
    if (haystack.includes('chipset')) return 122
  }

  return 0
}

function scoreBoardFanSensor(sensor) {
  const haystack = normalizeSensorText(sensor)
  if (haystack.includes('system fan')) return 132
  if (haystack.includes('chassis')) return 126
  if (haystack.includes('case fan')) return 122
  if (haystack.includes('system')) return 114
  if (haystack.includes('fan')) return 90
  return 0
}

async function queryHardwareMonitorSensors(namespace, sensorType) {
  if (typeof process === 'undefined' || process.platform !== 'win32') return []
  if (!['Temperature', 'Load', 'Power', 'Voltage', 'Fan'].includes(sensorType)) return []

  return queryWmiSensors(namespace, sensorType)
}

async function getHardwareMonitorSensors(sensorType) {
  if (typeof process === 'undefined' || process.platform !== 'win32') return []

  return [
    ...(await queryHardwareMonitorSensors('root\\LibreHardwareMonitor', sensorType)),
    ...(await queryHardwareMonitorSensors('root\\OpenHardwareMonitor', sensorType)),
  ]
}

function extractSystemInformationCpuTemperatureValue(temperature) {
  const anyTemperature = temperature || {}
  const main = toValidCpuTemperature(anyTemperature.main)
  if (main !== null) return { value: main, sensorName: 'main' }

  const packageValue = toValidCpuTemperature(anyTemperature.package ?? anyTemperature.packageTemperature ?? anyTemperature.cpuPackage)
  if (packageValue !== null) return { value: packageValue, sensorName: 'package' }

  const tdieValue = toValidCpuTemperature(anyTemperature.tdie ?? anyTemperature.tDie)
  if (tdieValue !== null) return { value: tdieValue, sensorName: 'tdie' }

  const tctlValue = toValidCpuTemperature(anyTemperature.tctl ?? anyTemperature.tCtl)
  if (tctlValue !== null) return { value: tctlValue, sensorName: 'tctl' }

  const maxValue = toValidCpuTemperature(anyTemperature.max)
  if (maxValue !== null) return { value: maxValue, sensorName: 'max' }

  const coreValues = Array.isArray(anyTemperature.cores)
    ? anyTemperature.cores.map(toValidCpuTemperature).filter((value) => value !== null)
    : []
  if (coreValues.length) {
    const maximum = Math.max(...coreValues)
    if (Number.isFinite(maximum)) {
      return { value: roundTemperature(maximum), sensorName: 'cores-max', cores: coreValues }
    }

    const average = coreValues.reduce((sum, value) => sum + value, 0) / coreValues.length
    if (Number.isFinite(average)) {
      return { value: roundTemperature(average), sensorName: 'cores-avg', cores: coreValues }
    }
  }

  return { value: null, sensorName: undefined, cores: coreValues }
}

function buildCpuTemperatureResult(base, source, sensorName, value) {
  const anyBase = base || {}
  const normalizedValue = value === null ? null : toValidCpuTemperature(value)
  const coreValues = Array.isArray(anyBase.cores) ? anyBase.cores.map(toValidCpuTemperature).filter((item) => item !== null) : []
  const maxCandidates = [
    toValidCpuTemperature(anyBase.max),
    ...(coreValues.length ? [Math.max(...coreValues)] : []),
    normalizedValue,
  ].filter((item) => item !== null)

  return {
    ...anyBase,
    ok: normalizedValue !== null,
    main: normalizedValue,
    value: normalizedValue,
    cores: coreValues,
    max: maxCandidates.length ? roundTemperature(Math.max(...maxCandidates)) : null,
    socket: Array.isArray(anyBase.socket) ? anyBase.socket : [],
    chipset: anyBase.chipset ?? null,
    source,
    sensorName,
    unit: anyBase.unit ?? '°C',
    confidence: value === null && source === 'unsupported' ? 'unsupported' : anyBase.confidence,
    errorCode: anyBase.errorCode,
    reason: anyBase.reason,
    message: anyBase.message,
    suggestion: anyBase.suggestion,
    hardwareName: anyBase.hardwareName,
    identifier: anyBase.identifier,
    allCpuTemperatureSensors: anyBase.allCpuTemperatureSensors,
    raw: anyBase.raw,
  }
}

function pickBestCpuTemperatureSensor(sensors) {
  if (!sensors.length) return undefined
  return [...sensors].sort((a, b) => scoreCpuTemperatureSensor(b) - scoreCpuTemperatureSensor(a))[0]
}

function inferCpuTemperatureConfidence(sensor) {
  if (!sensor) return undefined
  const score = scoreCpuTemperatureSensor(sensor)
  if (score >= 130) return 'high'
  if (score >= 100) return 'medium'
  return 'low'
}

function uniquePaths(paths) {
  return [...new Set(paths.filter((item) => typeof item === 'string' && item.trim()))]
}

function getOpenHardwareMonitorDirectoryCandidates() {
  const cwd = typeof process?.cwd === 'function' ? process.cwd() : ''
  const dirname = typeof __dirname === 'string' ? __dirname : ''
  const resourcesPath = typeof process?.resourcesPath === 'string' ? process.resourcesPath : ''

  return uniquePaths([
    cwd ? path.join(cwd, 'vendor', 'openhardwaremonitor') : '',
    cwd ? path.join(cwd, 'dist', 'vendor', 'openhardwaremonitor') : '',
    cwd ? path.join(cwd, 'dist-electron', 'vendor', 'openhardwaremonitor') : '',
    dirname ? path.join(dirname, 'vendor', 'openhardwaremonitor') : '',
    dirname ? path.join(dirname, '..', 'vendor', 'openhardwaremonitor') : '',
    dirname ? path.join(dirname, '..', '..', 'vendor', 'openhardwaremonitor') : '',
    dirname ? path.join(dirname, '..', '..', '..', 'vendor', 'openhardwaremonitor') : '',
    resourcesPath ? path.join(resourcesPath, 'vendor', 'openhardwaremonitor') : '',
  ])
}

function resolveOpenHardwareMonitorExecutable() {
  const candidates = getOpenHardwareMonitorDirectoryCandidates()

  for (const directoryPath of candidates) {
    const executablePath = path.join(directoryPath, OPEN_HARDWARE_MONITOR_PROCESS_NAME)
    if (fs.existsSync(executablePath)) {
      return {
        directoryPath,
        executablePath,
        exists: true,
        candidates,
      }
    }
  }

  return {
    directoryPath: candidates[0] || '',
    executablePath: candidates[0] ? path.join(candidates[0], OPEN_HARDWARE_MONITOR_PROCESS_NAME) : '',
    exists: false,
    candidates,
  }
}

function getBundledOpenHardwareMonitorDirectory() {
  return resolveOpenHardwareMonitorExecutable().directoryPath
}

function getBundledOpenHardwareMonitorPath() {
  return resolveOpenHardwareMonitorExecutable().executablePath
}

async function isProcessRunning(processName) {
  if (!isWindows()) return false

  try {
    const { stdout } = await execFileAsync('tasklist.exe', ['/FI', `IMAGENAME eq ${processName}`], {
      windowsHide: true,
      timeout: 2000,
    })

    return stdout.toLowerCase().includes(processName.toLowerCase())
  } catch {
    return false
  }
}

function buildOpenHardwareMonitorStatusResult(overrides = {}) {
  const settings = overrides.settings || getHardwareSensorSettings()
  const resolved = overrides.resolved || resolveOpenHardwareMonitorExecutable()
  const executablePath = overrides.executablePath || resolved.executablePath

  return {
    platform: isWindows() ? 'win32' : 'other',
    settings,
    running: Boolean(overrides.running),
    executableExists: typeof overrides.executableExists === 'boolean' ? overrides.executableExists : Boolean(resolved.exists),
    executablePath,
    executableDirectory: overrides.executableDirectory || resolved.directoryPath,
    port: settings.openHardwareMonitorPort,
    started: Boolean(overrides.started),
    reason: overrides.reason,
    suggestion: overrides.suggestion,
  }
}

async function getOpenHardwareMonitorStatus() {
  const settings = getHardwareSensorSettings()
  const resolved = resolveOpenHardwareMonitorExecutable()

  if (!isWindows()) {
    return buildOpenHardwareMonitorStatusResult({
      settings,
      resolved,
      running: false,
      executableExists: false,
      reason: 'NOT_WINDOWS',
    })
  }

  const executablePath = resolved.executablePath
  const executableExists = resolved.exists
  const running = await isProcessRunning(OPEN_HARDWARE_MONITOR_PROCESS_NAME)

  return buildOpenHardwareMonitorStatusResult({
    settings,
    resolved,
    running,
    executableExists,
    executablePath,
    reason: running ? undefined : executableExists ? 'OHM_NOT_RUNNING' : 'OHM_EXE_NOT_FOUND',
    suggestion: executableExists ? undefined : 'OpenHardwareMonitor 组件不存在，请检查 vendor/openhardwaremonitor 打包产物',
  })
}

async function startBundledOpenHardwareMonitor() {
  const resolved = resolveOpenHardwareMonitorExecutable()

  if (!isWindows()) {
    return buildOpenHardwareMonitorStatusResult({
      resolved,
      reason: 'NOT_WINDOWS',
    })
  }

  const executablePath = resolved.executablePath

  if (!resolved.exists) {
    return buildOpenHardwareMonitorStatusResult({
      resolved,
      executableExists: false,
      executablePath,
      reason: 'OHM_EXE_NOT_FOUND',
      suggestion: 'OpenHardwareMonitor 组件不存在，请检查 vendor/openhardwaremonitor 打包产物',
    })
  }

  try {
    const startScript = [
      `$p = Start-Process -FilePath '${executablePath.replace(/'/g, "''")}'`,
      `-WorkingDirectory '${path.dirname(executablePath).replace(/'/g, "''")}'`,
      '-WindowStyle Normal -PassThru',
      '; $p.Id',
    ].join(' ')

    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', startScript], {
      windowsHide: false,
      timeout: 5000,
    })

    const startedPid = Number.parseInt(String(stdout).trim(), 10)
    openHardwareMonitorManagedPid = Number.isFinite(startedPid) && startedPid > 0 ? startedPid : null

    openHardwareMonitorLastStartAt = Date.now()

    return buildOpenHardwareMonitorStatusResult({
      resolved,
      executableExists: true,
      executablePath,
      started: true,
    })
  } catch (error) {
    return buildOpenHardwareMonitorStatusResult({
      resolved,
      executableExists: true,
      executablePath,
      reason: 'OHM_START_FAILED',
      suggestion: '可能需要管理员权限，或被安全软件拦截',
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function ensureOpenHardwareMonitorRunning() {
  const settings = getHardwareSensorSettings()
  const resolved = resolveOpenHardwareMonitorExecutable()

  if (!isWindows()) {
    return buildOpenHardwareMonitorStatusResult({
      settings,
      resolved,
      reason: 'NOT_WINDOWS',
    })
  }

  const running = await isProcessRunning(OPEN_HARDWARE_MONITOR_PROCESS_NAME)
  if (running) {
    return buildOpenHardwareMonitorStatusResult({
      settings,
      resolved,
      running: true,
      executableExists: resolved.exists,
    })
  }

  if (!settings.enhancedSensorEnabled || !settings.openHardwareMonitorAutoStart) {
    return buildOpenHardwareMonitorStatusResult({
      settings,
      resolved,
      running: false,
      executableExists: resolved.exists,
      reason: 'OHM_AUTOSTART_DISABLED',
      suggestion: '开启增强模式后，可再启用自动启动 OpenHardwareMonitor',
    })
  }

  const now = Date.now()
  if (openHardwareMonitorStartPromise) {
    return openHardwareMonitorStartPromise
  }

  if (now - openHardwareMonitorLastStartAt < OPEN_HARDWARE_MONITOR_START_COOLDOWN_MS) {
    return buildOpenHardwareMonitorStatusResult({
      settings,
      resolved,
      running: false,
      executableExists: resolved.exists,
      reason: 'OHM_START_COOLDOWN',
      suggestion: '刚刚尝试过启动 OpenHardwareMonitor，请稍后再试',
    })
  }

  openHardwareMonitorStartPromise = Promise.resolve(startBundledOpenHardwareMonitor())
    .finally(() => {
      openHardwareMonitorStartPromise = undefined
    })

  return openHardwareMonitorStartPromise
}

function parseTemperatureValue(value) {
  if (typeof value === 'number') {
    return isValidCpuTemperature(value) ? Math.round(value * 10) / 10 : null
  }

  if (typeof value === 'string') {
    const match = value.match(/(-?\d+(?:\.\d+)?)\s*(?:°C|C)?/i)
    if (!match) return null
    const parsed = Number(match[1])
    return isValidCpuTemperature(parsed) ? Math.round(parsed * 10) / 10 : null
  }

  return null
}

function walkOpenHardwareMonitorSensorTree(node, pathStack = []) {
  if (!node || typeof node !== 'object') return []

  const name = String(node.Text || node.text || node.Name || node.name || '').trim()
  const nextPath = name ? [...pathStack, name] : pathStack
  const pathText = nextPath.join(' / ')
  const lowerPathText = pathText.toLowerCase()
  const rows = []
  const parsedValue = parseTemperatureValue(node.Value ?? node.value)
  const isTemperaturePath = /temperature|temperatures|温度/i.test(pathText)
  const looksLikeCpu = /cpu|core|package|ccd|tdie|tctl|intel|amd|ryzen|processor/i.test(pathText)
  const isExcluded = CPU_SENSOR_EXCLUSION_TERMS.some((term) => lowerPathText.includes(term))

  if (parsedValue !== null && isTemperaturePath && looksLikeCpu && !isExcluded) {
    rows.push({
      name: name || 'Temperature',
      path: pathText,
      value: parsedValue,
      unit: 'C',
    })
  }

  const children = Array.isArray(node.Children) ? node.Children : Array.isArray(node.children) ? node.children : []
  for (const child of children) {
    rows.push(...walkOpenHardwareMonitorSensorTree(child, nextPath))
  }

  return rows
}

function parseOpenHardwareMonitorData(data) {
  const sensors = walkOpenHardwareMonitorSensorTree(data)
  const rankedSensors = sensors
    .map((sensor) => ({
      ...sensor,
      score: scoreCpuTemperatureSensor({
        name: sensor.name,
        identifier: sensor.path,
        parent: sensor.path,
      }),
    }))
    .sort((a, b) => b.score - a.score)

  const values = rankedSensors.map((item) => item.value).filter(isValidCpuTemperature)

  if (!values.length) {
    return buildCpuTemperatureResult(
      {
        cores: [],
        confidence: 'unsupported',
        errorCode: 'OHM_NO_CPU_TEMP_SENSOR',
        reason: 'OHM_NO_CPU_TEMP_SENSOR',
        suggestion: 'OpenHardwareMonitor 已运行，但没有返回可信的 CPU 温度传感器',
        allCpuTemperatureSensors: [],
        raw: data,
      },
      'OpenHardwareMonitor',
      undefined,
      null
    )
  }

  const mainSensor = rankedSensors[0]
  const coreValues = rankedSensors
    .filter((sensor) => /core\s*#?\d+|core max/i.test(sensor.path))
    .map((sensor) => sensor.value)
    .filter(isValidCpuTemperature)

  return buildCpuTemperatureResult(
    {
      cores: coreValues,
      max: Math.max(...values),
      confidence: mainSensor.score >= 130 ? 'high' : mainSensor.score >= 100 ? 'medium' : 'low',
      hardwareName: 'OpenHardwareMonitor Remote Web Server',
      identifier: mainSensor.path,
      allCpuTemperatureSensors: rankedSensors.map((sensor) => ({
        name: sensor.name,
        identifier: sensor.path,
        hardwareName: 'OpenHardwareMonitor Remote Web Server',
        value: sensor.value,
      })),
      raw: data,
    },
    'OpenHardwareMonitor',
    mainSensor.name,
    mainSensor.value
  )
}

async function readOpenHardwareMonitorHttp(port = DEFAULT_HARDWARE_SENSOR_SETTINGS.openHardwareMonitorPort) {
  if (typeof fetch !== 'function') {
    return buildCpuTemperatureResult(
      {
        confidence: 'unsupported',
        errorCode: 'OHM_HTTP_FETCH_UNAVAILABLE',
        reason: 'OHM_HTTP_UNAVAILABLE',
        suggestion: '当前运行环境不支持本地 HTTP 读取',
      },
      'OpenHardwareMonitor',
      undefined,
      null
    )
  }

  const url = `http://127.0.0.1:${port}/data.json`
  const controller = typeof AbortController === 'function' ? new AbortController() : undefined
  const timer = controller
    ? setTimeout(() => controller.abort(), OPEN_HARDWARE_MONITOR_HTTP_TIMEOUT_MS)
    : undefined

  try {
    const response = await fetch(url, {
      signal: controller?.signal,
    })

    if (!response.ok) {
      return buildCpuTemperatureResult(
        {
          confidence: 'unsupported',
          errorCode: 'OHM_HTTP_BAD_STATUS',
          reason: 'OHM_HTTP_BAD_STATUS',
          message: `OpenHardwareMonitor 本地服务返回状态 ${response.status}`,
          suggestion: '请确认 OpenHardwareMonitor 已运行，并启用本地 Remote Web Server',
        },
        'OpenHardwareMonitor',
        undefined,
        null
      )
    }

    const data = await response.json()
    return parseOpenHardwareMonitorData(data)
  } catch (error) {
    return buildCpuTemperatureResult(
      {
        confidence: 'unsupported',
        errorCode: 'OHM_HTTP_UNAVAILABLE',
        reason: 'OHM_HTTP_UNAVAILABLE',
        message: error instanceof Error ? error.message : String(error),
        suggestion: '请确认 OpenHardwareMonitor 已运行，并启用本地 Remote Web Server',
      },
      'OpenHardwareMonitor',
      undefined,
      null
    )
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function startOpenHardwareMonitorManually() {
  const settings = getHardwareSensorSettings()
  const resolved = resolveOpenHardwareMonitorExecutable()

  if (!isWindows()) {
    return buildOpenHardwareMonitorStatusResult({
      settings,
      resolved,
      reason: 'NOT_WINDOWS',
    })
  }

  if (!settings.enhancedSensorEnabled) {
    return buildOpenHardwareMonitorStatusResult({
      settings,
      resolved,
      executableExists: resolved.exists,
      reason: 'ENHANCED_SENSOR_DISABLED',
      suggestion: '请先开启硬件传感器增强模式',
    })
  }

  const running = await isProcessRunning(OPEN_HARDWARE_MONITOR_PROCESS_NAME)
  if (running) {
    return buildOpenHardwareMonitorStatusResult({
      settings,
      resolved,
      running: true,
      executableExists: resolved.exists,
    })
  }

  const startResult = await startBundledOpenHardwareMonitor()
  if (!startResult.started) {
    return startResult
  }

  await new Promise((resolve) => setTimeout(resolve, 1200))
  const startedRunning = await isProcessRunning(OPEN_HARDWARE_MONITOR_PROCESS_NAME)

  return buildOpenHardwareMonitorStatusResult({
    settings,
    resolved,
    running: startedRunning,
    executableExists: resolved.exists,
    executablePath: resolved.executablePath,
    started: startedRunning,
    reason: startedRunning ? undefined : 'OHM_START_FAILED',
    suggestion: startedRunning ? undefined : '插件尝试启动失败。请手动打开一次 OpenHardwareMonitor，确认没有被权限或安全软件拦截。',
  })
}

async function openOpenHardwareMonitorDirectory() {
  if (!isWindows()) return false

  const resolved = resolveOpenHardwareMonitorExecutable()
  const directoryPath = resolved.directoryPath

  if (!directoryPath || !fs.existsSync(directoryPath)) {
    return false
  }

  try {
    const child = spawn('explorer.exe', [directoryPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    })
    child.unref()
    return true
  } catch {
    return false
  }
}

async function getHardwareMonitorCpuTemperatureFromNamespace(namespace) {
  if (typeof process === 'undefined' || process.platform !== 'win32') return undefined

  const sensors = (await queryHardwareMonitorSensors(namespace, 'Temperature')).filter(isCpuSensor)

  if (!sensors.length) return undefined

  const mainSensor = pickBestCpuTemperatureSensor(sensors)
  const coreSensors = sensors.filter((sensor) => /core\s*#?\d+/.test(normalizeSensorText(sensor)))
  const coreValues = coreSensors.map((sensor) => toValidCpuTemperature(sensor.value)).filter((value) => value !== null)
  const allValues = sensors.map((sensor) => toValidCpuTemperature(sensor.value)).filter((value) => value !== null)
  const source = namespace.includes('LibreHardwareMonitor') ? 'LibreHardwareMonitor' : 'OpenHardwareMonitor'

  return buildCpuTemperatureResult(
    {
      cores: coreValues,
      max: allValues.length ? Math.max(...allValues) : null,
      socket: [],
      chipset: null,
      hardwareName: mainSensor?.parent || undefined,
      identifier: mainSensor?.identifier || undefined,
      confidence: inferCpuTemperatureConfidence(mainSensor),
      allCpuTemperatureSensors: sensors.map((sensor) => ({
        name: sensor.name,
        identifier: sensor.identifier,
        hardwareName: sensor.parent || undefined,
        value: toValidCpuTemperature(sensor.value),
      })),
    },
    source,
    mainSensor?.name || undefined,
    mainSensor ? toValidCpuTemperature(mainSensor.value) : null
  )
}

async function getHardwareMonitorCpuTemperature() {
  const libreResult = await getHardwareMonitorCpuTemperatureFromNamespace('root\\LibreHardwareMonitor')
  if (libreResult?.value !== null) return libreResult

  const openResult = await getHardwareMonitorCpuTemperatureFromNamespace('root\\OpenHardwareMonitor')
  if (openResult?.value !== null) return openResult

  return libreResult || openResult
}

async function getHardwareMonitorCpuPower() {
  const sensors = (await getHardwareMonitorSensors('Power')).filter(isCpuSensor)

  if (!sensors.length) return undefined

  const sortedSensors = [...sensors].sort((a, b) => scoreCpuPowerSensor(b) - scoreCpuPowerSensor(a))
  const mainSensor = sortedSensors[0]

  return {
    value: Math.round(mainSensor.value * 10) / 10,
    source: mainSensor.source.includes('LibreHardwareMonitor') ? 'LibreHardwareMonitor' : 'OpenHardwareMonitor',
    sensorName: mainSensor.name,
    sensors: sensors.map((sensor) => ({
      name: sensor.name,
      value: Math.round(sensor.value * 10) / 10,
    })),
  }
}

async function getHardwareMonitorCpuVoltage() {
  const sensors = (await getHardwareMonitorSensors('Voltage')).filter(isCpuSensor)

  if (!sensors.length) {
    return {
      value: null,
      source: 'unsupported',
      unit: 'V',
      max: null,
    }
  }

  const mainSensor = [...sensors].sort((a, b) => scoreCpuVoltageSensor(b) - scoreCpuVoltageSensor(a))[0]

  return {
    value: mainSensor ? Math.round(mainSensor.value * 100) / 100 : null,
    source: mainSensor.source.includes('LibreHardwareMonitor') ? 'LibreHardwareMonitor' : 'OpenHardwareMonitor',
    sensorName: mainSensor?.name,
    unit: 'V',
    max: Math.max(...sensors.map((sensor) => sensor.value)),
  }
}

async function getHardwareMonitorCpuFanSpeed() {
  const sensors = (await getHardwareMonitorSensors('Fan')).filter((sensor) => {
    const haystack = `${sensor.name} ${sensor.identifier} ${sensor.parent}`.toLowerCase()
    if (haystack.includes('gpu') || haystack.includes('system') || haystack.includes('chassis') || haystack.includes('case') || haystack.includes('pump')) {
      return false
    }
    return haystack.includes('cpu') || haystack.includes('fan')
  })

  if (!sensors.length) {
    return {
      value: null,
      source: 'unsupported',
      unit: 'RPM',
      max: null,
    }
  }

  const mainSensor = [...sensors].sort((a, b) => scoreCpuFanSensor(b) - scoreCpuFanSensor(a))[0]

  return {
    value: mainSensor ? Math.round(mainSensor.value) : null,
    source: mainSensor.source.includes('LibreHardwareMonitor') ? 'LibreHardwareMonitor' : 'OpenHardwareMonitor',
    sensorName: mainSensor?.name,
    unit: 'RPM',
    max: Math.max(...sensors.map((sensor) => sensor.value)),
  }
}

function pickBestBoardSensor(sensors, scorer, rounder, unit) {
  if (!sensors.length) {
    return buildBoardMetric(unit)
  }

  const scored = sensors
    .map((sensor) => ({
      sensor,
      score: scorer(sensor),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)

  if (!scored.length) {
    return buildBoardMetric(unit)
  }

  const { sensor } = scored[0]
  const values = sensors.map((item) => item.value).filter((value) => typeof value === 'number')
  const source = sensor.source.includes('LibreHardwareMonitor') ? 'LibreHardwareMonitor' : 'OpenHardwareMonitor'

  return buildBoardMetric(
    unit,
    rounder(sensor.value),
    source,
    sensor.name,
    values.length
      ? unit === 'RPM'
        ? roundFanSpeed(Math.max(...values))
        : unit === 'V'
          ? roundVoltage(Math.max(...values))
          : roundTemperature(Math.max(...values))
      : null
  )
}

async function getBoardTelemetry() {
  const [temperatureSensors, voltageSensors, fanSensors] = await Promise.all([
    getHardwareMonitorSensors('Temperature'),
    getHardwareMonitorSensors('Voltage'),
    getHardwareMonitorSensors('Fan'),
  ])

  const candidateTemperatures = temperatureSensors.filter(isBoardTelemetrySensor)
  const candidateVoltages = voltageSensors.filter(isBoardTelemetrySensor)
  const candidateFans = fanSensors.filter((sensor) => {
    const haystack = normalizeSensorText(sensor)
    if (haystack.includes('cpu') || haystack.includes('gpu') || haystack.includes('pump')) return false
    return isBoardTelemetrySensor(sensor) || haystack.includes('system fan') || haystack.includes('chassis') || haystack.includes('case fan')
  })

  const telemetry = createEmptyBoardTelemetry()

  telemetry.boardTemperature = pickBestBoardSensor(candidateTemperatures, (sensor) => scoreBoardTemperatureSensor(sensor, 'board'), roundTemperature, '°C')
  telemetry.vrmTemperature = pickBestBoardSensor(candidateTemperatures, (sensor) => scoreBoardTemperatureSensor(sensor, 'vrm'), roundTemperature, '°C')
  telemetry.chipsetTemperature = pickBestBoardSensor(candidateTemperatures, (sensor) => scoreBoardTemperatureSensor(sensor, 'chipset'), roundTemperature, '°C')
  telemetry.systemFan = pickBestBoardSensor(candidateFans, scoreBoardFanSensor, roundFanSpeed, 'RPM')
  telemetry.voltage12V = pickBestBoardSensor(candidateVoltages, (sensor) => scoreBoardVoltageSensor(sensor, '12v'), roundVoltage, 'V')
  telemetry.voltage5V = pickBestBoardSensor(candidateVoltages, (sensor) => scoreBoardVoltageSensor(sensor, '5v'), roundVoltage, 'V')
  telemetry.voltage3V = pickBestBoardSensor(candidateVoltages, (sensor) => scoreBoardVoltageSensor(sensor, '3v'), roundVoltage, 'V')
  telemetry.voltageVBat = pickBestBoardSensor(candidateVoltages, (sensor) => scoreBoardVoltageSensor(sensor, 'vbat'), roundVoltage, 'V')
  telemetry.pchVoltage = pickBestBoardSensor(candidateVoltages, (sensor) => scoreBoardVoltageSensor(sensor, 'pch'), roundVoltage, 'V')

  return telemetry
}

async function getCpuTemperature() {
  try {
    const temperature = await si.cpuTemperature()
    const systemInfoValue = extractSystemInformationCpuTemperatureValue(temperature)
    const sensorSettings = getHardwareSensorSettings()
    const enhancedSensorEnabled = isWindows() && sensorSettings.enhancedSensorEnabled

    if (systemInfoValue.value !== null) {
      return buildCpuTemperatureResult(temperature, 'systeminformation', systemInfoValue.sensorName, systemInfoValue.value)
    }

    const libreTemperature = await getHardwareMonitorCpuTemperatureFromNamespace('root\\LibreHardwareMonitor')
    if (libreTemperature && libreTemperature.value !== null) {
      return libreTemperature
    }

    const openTemperature = enhancedSensorEnabled
      ? await getHardwareMonitorCpuTemperatureFromNamespace('root\\OpenHardwareMonitor')
      : undefined
    if (openTemperature && openTemperature.value !== null) {
      return openTemperature
    }

    const baseDiagnostics = [
      'systeminformation 未提供有效 CPU 温度',
      libreTemperature?.value === null ? 'LibreHardwareMonitor WMI: 无可用温度' : 'LibreHardwareMonitor WMI: 未命中',
      openTemperature?.value === null ? 'OpenHardwareMonitor WMI: 无可用温度' : 'OpenHardwareMonitor WMI: 未命中',
    ]

    if (!isWindows()) {
      return buildCpuTemperatureResult(
        {
          ...temperature,
          errorCode: 'CPU_TEMPERATURE_UNAVAILABLE',
          reason: 'TEMPERATURE_UNAVAILABLE',
          message: baseDiagnostics.join(' | '),
          suggestion: '当前系统未返回可用 CPU 温度',
          confidence: 'unsupported',
        },
        'unsupported',
        undefined,
        null
      )
    }

    if (!enhancedSensorEnabled) {
      return buildCpuTemperatureResult(
        {
          ...temperature,
          errorCode: 'ENHANCED_SENSOR_DISABLED',
          reason: 'ENHANCED_SENSOR_DISABLED',
          message: baseDiagnostics.join(' | '),
          suggestion: 'Windows 下可在处理器页开启硬件传感器增强模式',
          confidence: 'unsupported',
        },
        'unsupported',
        undefined,
        null
      )
    }

    let openHardwareMonitorStatus
    if (sensorSettings.openHardwareMonitorAutoStart) {
      openHardwareMonitorStatus = await ensureOpenHardwareMonitorRunning()
    }

    const ohmResult = await readOpenHardwareMonitorHttp(sensorSettings.openHardwareMonitorPort)
    if (ohmResult?.value !== null) {
      return ohmResult
    }

    const diagnostics = [
      ...baseDiagnostics,
      openHardwareMonitorStatus?.reason ? `OHM 启动状态: ${openHardwareMonitorStatus.reason}` : 'OHM 启动状态: 未尝试自动启动',
      ohmResult?.reason ? `OHM 读取结果: ${ohmResult.reason}` : 'OHM 读取结果: 无结果',
    ]

    return buildCpuTemperatureResult(
      {
        ...temperature,
        errorCode: ohmResult?.errorCode || 'CPU_TEMPERATURE_UNAVAILABLE',
        reason: ohmResult?.reason || 'TEMPERATURE_UNAVAILABLE',
        message: diagnostics.join(' | '),
        suggestion: ohmResult?.suggestion || openHardwareMonitorStatus?.suggestion || '请确认 OpenHardwareMonitor 已运行，并启用本地 Remote Web Server，必要时以管理员权限运行',
        confidence: 'unsupported',
      },
      'unsupported',
      undefined,
      null
    )
  } catch (error) {
    return buildCpuTemperatureResult(
      {
        errorCode: 'CPU_TEMPERATURE_EXCEPTION',
        message: error instanceof Error ? error.message : 'CPU 温度服务执行失败',
        confidence: 'unsupported',
      },
      'unsupported',
      undefined,
      null
    )
  }
}

// Reserved integration point for future in-process native hosting, separate from the helper executable.
async function getEmbeddedLibreHardwareMonitorCpuTemperature() {
  return undefined
}

async function getHardwareMonitorGpuTelemetry() {
  const [temperatureSensors, loadSensors, powerSensors] = await Promise.all([
    getHardwareMonitorSensors('Temperature'),
    getHardwareMonitorSensors('Load'),
    getHardwareMonitorSensors('Power'),
  ])

  const gpuTemperatureSensors = temperatureSensors.filter(isGpuSensor)
  const gpuLoadSensors = loadSensors.filter(isGpuSensor)
  const gpuPowerSensors = powerSensors.filter(isGpuSensor)

  const bestTemperature = [...gpuTemperatureSensors].sort((a, b) => scoreGpuTemperatureSensor(b) - scoreGpuTemperatureSensor(a))[0]
  const bestLoad = [...gpuLoadSensors].sort((a, b) => scoreGpuLoadSensor(b) - scoreGpuLoadSensor(a))[0]
  const bestPower = [...gpuPowerSensors].sort((a, b) => scoreGpuPowerSensor(b) - scoreGpuPowerSensor(a))[0]

  if (!bestTemperature && !bestLoad && !bestPower) {
    return undefined
  }

  return {
    temperatureGpu: bestTemperature ? Math.round(bestTemperature.value * 10) / 10 : null,
    utilizationGpu: bestLoad ? Math.round(bestLoad.value * 10) / 10 : null,
    powerDraw: bestPower ? Math.round(bestPower.value * 10) / 10 : null,
  }
}

function normalizeDiskUsage(disk) {
  return {
    ...disk,
    name: disk.fs || disk.mount || '未知磁盘',
    type: disk.type || 'unknown',
    used: disk.used || 0,
    available: disk.available || 0,
    size: disk.size || 0,
    mount: disk.mount || '',
  }
}

async function readSysctlNumber(name) {
  try {
    const { stdout } = await execFileAsync('/usr/sbin/sysctl', ['-n', name], {
      timeout: 1000,
      windowsHide: true,
    })

    const value = Number(String(stdout).trim())
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

function mapMacMemoryPressureLevel(rawLevel) {
  switch (rawLevel) {
    case 1:
      return 'normal'
    case 2:
      return 'warning'
    case 4:
      return 'critical'
    default:
      return 'unknown'
  }
}

async function getMacMemoryPressure() {
  if (process.platform !== 'darwin') {
    return MAC_MEMORY_PRESSURE_FALLBACK
  }

  const [rawLevel, availablePercent] = await Promise.all([
    // macOS memory pressure level.
    // Common values used by Firefox/Chromium style implementations:
    // 1 = normal, 2 = warning, 4 = critical.
    // This is more suitable for macOS user-facing memory status than
    // systeminformation.mem().available, which is only an estimated
    // potentially available value.
    readSysctlNumber('kern.memorystatus_vm_pressure_level'),
    readSysctlNumber('kern.memorystatus_level'),
  ])

  return {
    level: mapMacMemoryPressureLevel(rawLevel),
    rawLevel,
    availablePercent,
    source: rawLevel == null ? 'fallback' : 'sysctl-memorystatus',
  }
}

function normalizeMemoryInfo(memory, pressure = MAC_MEMORY_PRESSURE_FALLBACK) {
  const total = Number.isFinite(memory?.total) ? memory.total : 0
  const free = Number.isFinite(memory?.free) ? memory.free : 0
  const used = Number.isFinite(memory?.used) ? memory.used : 0
  const active = Number.isFinite(memory?.active) ? memory.active : 0
  const available = Number.isFinite(memory?.available) ? memory.available : 0
  const swaptotal = Number.isFinite(memory?.swaptotal) ? memory.swaptotal : 0
  const swapused = Number.isFinite(memory?.swapused) ? memory.swapused : 0
  const swapfree = Number.isFinite(memory?.swapfree) ? memory.swapfree : 0
  const platform = typeof process !== 'undefined' ? process.platform : ''

  if (platform === 'darwin') {
    return {
      ...memory,
      total,
      free,
      used,
      rawActive: active,
      rawAvailable: available,
      swaptotal,
      swapused,
      swapfree,
      active,
      available,
      normalizedPlatform: 'darwin',
      pressure,
    }
  }

  return {
    ...memory,
    total,
    free,
    used,
    rawActive: active,
    rawAvailable: available,
    swaptotal,
    swapused,
    swapfree,
    active: active > 0 ? active : used,
    available: available > 0 ? available : free,
    normalizedPlatform: platform || 'unknown',
    pressure,
  }
}

async function readGpuInfo() {
  return readSystemInfo('graphics', [], async () => {
    const graphics = await si.graphics()
    const fallbackTelemetry = await getHardwareMonitorGpuTelemetry()
    const isMacOS = typeof process !== 'undefined' && process.platform === 'darwin'

    function hasGpuIdentity(controller) {
      return Boolean(
        (typeof controller.model === 'string' && controller.model.trim())
        || (typeof controller.name === 'string' && controller.name.trim())
        || (typeof controller.vendor === 'string' && controller.vendor.trim())
      )
    }

    function isLikelyGpuController(controller) {
      if (!hasGpuIdentity(controller)) return false

      const haystack = `${controller.vendor || ''} ${controller.model || ''} ${controller.name || ''} ${controller.bus || ''}`.toLowerCase()

      if (haystack.includes('displaylink') || haystack.includes('virtual display') || haystack.includes('vmware') || haystack.includes('parallels')) {
        return false
      }

      if (isMacOS) {
        return true
      }

      return (controller.vram || 0) >= 1 || Boolean(controller.bus) || Boolean(controller.driverVersion)
    }

    return graphics.controllers
      .filter(isLikelyGpuController)
      .map((controller) => ({
        ...controller,
        vram: controller.vram || 0,
        bus: controller.bus || '',
        vendor: controller.vendor || '',
        subVendor: controller.subVendor || '',
        vendorId: controller.vendorId || '',
        deviceId: controller.deviceId || '',
        cores: controller.cores ?? null,
        memoryTotal: controller.memoryTotal ?? controller.vram ?? 0,
        memoryUsed: controller.memoryUsed ?? null,
        memoryFree: controller.memoryFree ?? null,
        utilizationGpu: controller.utilizationGpu ?? fallbackTelemetry?.utilizationGpu ?? null,
        utilizationMemory: controller.utilizationMemory ?? null,
        temperatureGpu: controller.temperatureGpu ?? fallbackTelemetry?.temperatureGpu ?? null,
        temperatureMemory: controller.temperatureMemory ?? null,
        powerDraw: controller.powerDraw ?? fallbackTelemetry?.powerDraw ?? null,
        powerLimit: controller.powerLimit ?? null,
        clockCore: controller.clockCore ?? null,
        clockMemory: controller.clockMemory ?? null,
        fanSpeed: controller.fanSpeed ?? null,
        driverVersion: controller.driverVersion || '',
        pciBus: controller.pciBus || '',
      }))
  })
}

async function getGpuInfo() {
  const now = Date.now()

  if (gpuInfoPromise) {
    return gpuInfoPromise
  }

  if (gpuInfoCache.length && now - gpuInfoCacheAt < 2000) {
    return gpuInfoCache
  }

  gpuInfoPromise = readGpuInfo()
    .then((result) => {
      gpuInfoCache = result
      gpuInfoCacheAt = Date.now()
      return result
    })
    .finally(() => {
      gpuInfoPromise = undefined
    })

  return gpuInfoPromise
}

export const systemService = {
  getHardwareSensorSettings: async () => getHardwareSensorSettings(),

  updateHardwareSensorSettings: async (patch) => updateHardwareSensorSettings(patch),

  getOpenHardwareMonitorStatus,

  startOpenHardwareMonitor: startOpenHardwareMonitorManually,

  openOpenHardwareMonitorDirectory,

  getCpuInfo: () => readSystemInfo('cpu', undefined, () => si.cpu()),

  getCpuFullLoad: () =>
    readSystemInfo('currentLoad', 0, async () => {
      const current = await si.currentLoad()
      return Math.round(current.currentLoad)
    }),

  getCpuTemperature: () =>
    readSystemInfo(
      'cpuTemperature',
      buildCpuTemperatureResult(
        {
          errorCode: 'CPU_TEMPERATURE_SERVICE_FALLBACK',
          message: 'readSystemInfo 捕获到未处理异常',
          confidence: 'unsupported',
        },
        'unsupported',
        undefined,
        null
      ),
      getCpuTemperature
    ),

  getCpuPower: () => readSystemInfo('cpuPower', undefined, getHardwareMonitorCpuPower),

  getCpuCurrentSpeed: () => readSystemInfo('cpuCurrentSpeed', { min: 0, max: 0, avg: 0, cores: [] }, () => si.cpuCurrentSpeed()),

  getCpuLoadData: () => readSystemInfo('currentLoadData', emptyCurrentLoadData, () => si.currentLoad()),

  getCpuVoltage: () => readSystemInfo('cpuVoltage', { value: null, source: 'unsupported', unit: 'V', max: null }, getHardwareMonitorCpuVoltage),

  getCpuFanSpeed: () => readSystemInfo('cpuFanSpeed', { value: null, source: 'unsupported', unit: 'RPM', max: null }, getHardwareMonitorCpuFanSpeed),

  getBoardTelemetry: () => readSystemInfo('boardTelemetry', createEmptyBoardTelemetry(), getBoardTelemetry),

  getMemInfo: () => readSystemInfo(
    'mem',
    {
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
      pressure: MAC_MEMORY_PRESSURE_FALLBACK,
    },
    async () => {
      const memory = await si.mem()
      const pressure = await getMacMemoryPressure()
      return normalizeMemoryInfo(memory, pressure)
    }
  ),

  getMemoryLayout: () => readSystemInfo('memLayout', [], () => si.memLayout()),

  getGpuInfo,

  getNetworkInfo: () =>
    readSystemInfo('networkStats', emptyNetworkStats, async () => {
      const [networkInterface] = await si.networkStats()
      return networkInterface || emptyNetworkStats
    }),

  getWifiInterfaces: () => readSystemInfo('wifiInterfaces', [], () => si.wifiInterfaces()),

  getWifiConnections: () => readSystemInfo('wifiConnections', [], () => si.wifiConnections()),

  getNetworkInterfaces: () => readSystemInfo('networkInterfaces', [], () => si.networkInterfaces()),

  getDiskData: () =>
    readSystemInfo('fsSize', [], async () => {
      const disks = await si.fsSize()
      return disks.map(normalizeDiskUsage)
    }),

  getDiskLayout: () => readSystemInfo('diskLayout', [], () => si.diskLayout()),

  getBiosData: () => readSystemInfo('bios', undefined, () => si.bios()),

  getDisplaysData: () =>
    readSystemInfo('displays', [], async () => {
      const graphics = await si.graphics()
      return graphics.displays || []
    }),

  getBoardData: () => readSystemInfo('baseboard', undefined, () => si.baseboard()),

  getBatteryInfo: () => readSystemInfo('battery', undefined, () => si.battery()),

  getUsbDevices: () => readSystemInfo('usb', [], () => si.usb()),

  getAudioDevices: () => readSystemInfo('audio', [], () => si.audio()),

  getBluetoothDevices: () => readSystemInfo('bluetoothDevices', [], () => si.bluetoothDevices()),

  getPrinterInfo: () => readSystemInfo('printer', [], () => si.printer()),

  getOsInfo: () => readSystemInfo('osInfo', undefined, () => si.osInfo()),

  getSysEnv: () => readSystemInfo('versions', {}, () => si.versions()),
  getTimeInfo: () => readSystemInfo('time', undefined, () => si.time()),
}
