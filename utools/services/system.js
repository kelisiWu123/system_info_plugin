import si from 'systeminformation'
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import macSensors from './macSensors.cjs'
import {
  WINDOWS_SENSOR_HELPER_PROCESS_NAME,
  getWindowsSensorHelperSensors,
  getWindowsSensorHelperStatus,
  readWindowsSensorHelperDiagnosticSnapshot,
  startWindowsSensorHelper,
  stopWindowsSensorHelper,
} from './windowsSensorHelper'

const execFileAsync = promisify(execFile)
const {
  buildMacGpuTemperatureFallbackDiagnostics,
  pickPreferredMacGpuTemperature,
  readMacCpuTemperature,
  readMacGpuTemperature,
  readMacPowermetricsHelperCpuPower,
  readMacPowermetricsHelperCpuSpeed,
  readMacPowermetricsHelperGpuTelemetry,
  readMacPowermetricsCpuSpeed,
  readMacSmcCpuTemperature,
  readMacSmcGpuTemperature,
  readMacSmcFanSpeed,
} = macSensors
const MAC_POWERMETRICS_HELPER_LABEL = 'com.hwinfox.powermetrics-helper'
const MAC_POWERMETRICS_HELPER_INSTALL_DIR = '/Library/Application Support/HWInfoX'
const MAC_POWERMETRICS_HELPER_BINARY_PATH = `${MAC_POWERMETRICS_HELPER_INSTALL_DIR}/hwinfox-powermetrics-helper`
const MAC_POWERMETRICS_HELPER_PLIST_PATH = `/Library/LaunchDaemons/${MAC_POWERMETRICS_HELPER_LABEL}.plist`
const MAC_POWERMETRICS_HELPER_SOCKET_PATH = '/var/run/hwinfox-powermetrics-helper.sock'
const HARDWARE_SENSOR_SETTINGS_STORAGE_KEY = 'hardwareSensorSettings'
const MONITORING_REFRESH_SETTINGS_STORAGE_KEY = 'monitoringRefreshSettings'
const FLOATING_MONITOR_SETTINGS_STORAGE_KEY = 'floatingMonitorSettings'
const APP_THEME_SETTINGS_STORAGE_KEY = 'appThemeSettings'
const DEFAULT_HARDWARE_SENSOR_SETTINGS = {
  enhancedSensorEnabled: false,
  openHardwareMonitorAutoStart: false,
  openHardwareMonitorPort: 18085,
}
const DEFAULT_MONITORING_REFRESH_SETTINGS = {
  profile: 'balanced',
  backgroundThrottleEnabled: true,
}
const DEFAULT_FLOATING_MONITOR_SETTINGS = {
  mode: 'standard',
  pinned: true,
  standardSize: { width: 432, height: 398 },
  superLiteSize: { width: 200, height: 200 },
}
const DEFAULT_APP_THEME_SETTINGS = {
  preference: 'system',
}
const OPEN_HARDWARE_MONITOR_PROCESS_NAME = 'OpenHardwareMonitor.exe'
const OPEN_HARDWARE_MONITOR_WMI_NAMESPACE = 'root\\OpenHardwareMonitor'
const OPEN_HARDWARE_MONITOR_HTTP_TIMEOUT_MS = 1500
const OPEN_HARDWARE_MONITOR_START_COOLDOWN_MS = 15000
const OPEN_HARDWARE_MONITOR_START_LOCK_STALE_MS = 30000
const OPEN_HARDWARE_MONITOR_START_WAIT_MS = 7000
const OPEN_HARDWARE_MONITOR_START_POLL_MS = 350
const CPU_CLOCK_ANOMALY_MAX_GHZ = 7.5
const CPU_CLOCK_SPEEDMAX_TOLERANCE_GHZ = 0.5
const CPU_CLOCK_OUTLIER_DELTA_GHZ = 1.0
const CPU_CLOCK_OUTLIER_MEDIAN_DELTA_GHZ = 1.2
const CPU_CLOCK_DISPLAY_ACCEPTED_DELTA_GHZ = 0.35
const CPU_CLOCK_VALUE_MATCH_TOLERANCE_GHZ = 0.05
const CPU_CLOCK_SPEEDMAX_TRUST_DELTA_GHZ = 0.8
const MAC_MEMORY_PRESSURE_FALLBACK = {
  level: 'unknown',
  rawLevel: null,
  availablePercent: null,
  source: 'fallback',
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

const OPEN_HARDWARE_MONITOR_TELEMETRY_CACHE_KEYS = [
  'cpuTemperature',
  'cpuPower',
  'cpuCurrentSpeed',
  'cpuVoltage',
  'gpuInfo',
]

let openHardwareMonitorLastStartAt = 0
let openHardwareMonitorStartPromise
let openHardwareMonitorManagedPid = null
let openHardwareMonitorKnownRunning = false
let configuredPluginRoot = ''
let configuredUtoolsRuntime
const runtimeServiceCache = new Map()
const runtimeServicePromiseCache = new Map()
const runtimeServiceCacheRevision = new Map()

async function readSystemInfo(label, fallback, reader) {
  try {
    return await reader()
  } catch (error) {
    console.warn(`[system-info] ${label} failed`, error)
    return fallback
  }
}

function isRuntimeCacheFresh(entry, maxAgeMs) {
  return Boolean(entry && Number.isFinite(entry.cachedAt) && Date.now() - entry.cachedAt < maxAgeMs)
}

function getRuntimeServiceCacheRevision(cacheKey) {
  return runtimeServiceCacheRevision.get(cacheKey) || 0
}

function invalidateRuntimeServiceCache(...cacheKeyInputs) {
  const cacheKeys = cacheKeyInputs.flat().filter((cacheKey) => typeof cacheKey === 'string' && cacheKey)
  for (const cacheKey of cacheKeys) {
    runtimeServiceCacheRevision.set(cacheKey, getRuntimeServiceCacheRevision(cacheKey) + 1)
    runtimeServiceCache.delete(cacheKey)
    runtimeServicePromiseCache.delete(cacheKey)
  }
}

function recordOpenHardwareMonitorRunningState(running) {
  const nextRunning = Boolean(running)
  if (nextRunning !== openHardwareMonitorKnownRunning) {
    invalidateRuntimeServiceCache(OPEN_HARDWARE_MONITOR_TELEMETRY_CACHE_KEYS)
    openHardwareMonitorKnownRunning = nextRunning
  }
  return nextRunning
}

async function readCachedServiceValue(cacheKey, maxAgeMs, reader) {
  const revision = getRuntimeServiceCacheRevision(cacheKey)
  const memoryEntry = runtimeServiceCache.get(cacheKey)
  if (isRuntimeCacheFresh(memoryEntry, maxAgeMs)) {
    return memoryEntry.value
  }

  const runningEntry = runtimeServicePromiseCache.get(cacheKey)
  if (runningEntry?.revision === revision) {
    return runningEntry.promise
  }

  const nextPromise = (async () => {
    const value = await reader()
    if (getRuntimeServiceCacheRevision(cacheKey) === revision) {
      const entry = {
        cachedAt: Date.now(),
        value,
      }
      runtimeServiceCache.set(cacheKey, entry)
    }
    return value
  })()
  const nextEntry = { revision, promise: nextPromise }

  runtimeServicePromiseCache.set(cacheKey, nextEntry)
  try {
    return await nextPromise
  } finally {
    if (runtimeServicePromiseCache.get(cacheKey) === nextEntry) {
      runtimeServicePromiseCache.delete(cacheKey)
    }
  }
}

export function configureSystemServiceContext({ pluginRoot, utools } = {}) {
  configuredPluginRoot = typeof pluginRoot === 'string' && pluginRoot.trim()
    ? path.resolve(pluginRoot)
    : ''
  configuredUtoolsRuntime = utools
}

function normalizeJsonArray(value) {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function toNumber(value) {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : null
}

function toPositiveInteger(value) {
  const numericValue = toNumber(value)
  if (numericValue === null || numericValue <= 0) return 0
  return Math.max(0, Math.round(numericValue))
}

function isWindows() {
  return typeof process !== 'undefined' && process.platform === 'win32'
}

function isMacOS() {
  return typeof process !== 'undefined' && process.platform === 'darwin'
}

function hasValidCpuClockCoreValues(cores) {
  return Array.isArray(cores)
    && cores.some((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)
}

function hasCpuSpeedValue(speed) {
  return Boolean(
    hasValidCpuClockCoreValues(speed?.cores)
    || (typeof speed?.avg === 'number' && Number.isFinite(speed.avg) && speed.avg > 0)
  )
}

function getValidCpuClockGhzValues(cores) {
  return Array.isArray(cores)
    ? cores.filter((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)
    : []
}

function getCpuCurrentSpeedDisplayDecision(speed) {
  const validCoreSpeeds = getValidCpuClockGhzValues(speed?.cores)
  if (validCoreSpeeds.length) {
    return {
      displayValueGHz: Math.max(...validCoreSpeeds),
      displayChosenFrom: 'max_core',
      validCoreCount: validCoreSpeeds.length,
    }
  }

  const avgValue = typeof speed?.avg === 'number' && Number.isFinite(speed.avg) && speed.avg > 0
    ? speed.avg
    : null

  return {
    displayValueGHz: avgValue,
    displayChosenFrom: avgValue === null ? 'unavailable' : 'avg_fallback',
    validCoreCount: 0,
  }
}

function isApproximatelyEqualCpuClockGhz(left, right, tolerance = CPU_CLOCK_VALUE_MATCH_TOLERANCE_GHZ) {
  return typeof left === 'number'
    && Number.isFinite(left)
    && typeof right === 'number'
    && Number.isFinite(right)
    && Math.abs(left - right) <= tolerance
}

function buildCpuCurrentSpeedDiagnostics(speed, { cpuSpeedMaxGhz } = {}) {
  const displayDecision = getCpuCurrentSpeedDisplayDecision(speed)
  const rawSensors = Array.isArray(speed?.allCpuClockSensors)
    ? speed.allCpuClockSensors.filter(Boolean)
    : []
  const acceptedSensors = rawSensors.filter((sensor) =>
    sensor?.accepted !== false
    && typeof sensor.value === 'number'
    && Number.isFinite(sensor.value)
    && sensor.value > 0
  )
  const ignoredSensors = rawSensors.filter((sensor) => sensor?.accepted === false)
  const anomalyRelevantIgnoredSensors = ignoredSensors.filter((sensor) => sensor?.filterReason !== 'EFFECTIVE_CLOCK_IGNORED')
  const ignoredSensorValues = ignoredSensors
    .map((sensor) => sensor.value)
    .filter((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)
  const maxAcceptedCoreGHz = acceptedSensors.length
    ? Math.max(...acceptedSensors.map((sensor) => sensor.value))
    : null
  const maxIgnoredCoreGHz = ignoredSensorValues.length
    ? Math.max(...ignoredSensorValues)
    : null
  const referenceSpeedMaxGHz = typeof cpuSpeedMaxGhz === 'number' && Number.isFinite(cpuSpeedMaxGhz) && cpuSpeedMaxGhz > 0
    ? cpuSpeedMaxGhz
    : null
  const trustedReferenceSpeedMaxGHz = referenceSpeedMaxGHz !== null && (
    rawSensors.length === 0
    || maxAcceptedCoreGHz === null
    || maxAcceptedCoreGHz <= referenceSpeedMaxGHz + CPU_CLOCK_SPEEDMAX_TRUST_DELTA_GHZ
  )
    ? referenceSpeedMaxGHz
    : null
  const avgGHz = typeof speed?.avg === 'number' && Number.isFinite(speed.avg) && speed.avg > 0
    ? speed.avg
    : null
  const anomalyReasons = []

  if (anomalyRelevantIgnoredSensors.length) {
    anomalyReasons.push('IGNORED_OHM_SENSORS_PRESENT')
  }

  if (displayDecision.displayChosenFrom === 'avg_fallback' && anomalyRelevantIgnoredSensors.length) {
    anomalyReasons.push('AVG_FALLBACK_WITH_IGNORED_OHM_SENSORS')
  }

  if (displayDecision.displayValueGHz !== null) {
    if (trustedReferenceSpeedMaxGHz !== null && displayDecision.displayValueGHz > trustedReferenceSpeedMaxGHz + CPU_CLOCK_SPEEDMAX_TOLERANCE_GHZ) {
      anomalyReasons.push('DISPLAY_EXCEEDS_CPU_SPEEDMAX')
    }

    if (typeof maxAcceptedCoreGHz === 'number' && displayDecision.displayValueGHz > maxAcceptedCoreGHz + CPU_CLOCK_DISPLAY_ACCEPTED_DELTA_GHZ) {
      anomalyReasons.push('DISPLAY_EXCEEDS_ACCEPTED_CORE_MAX')
    }

    if (ignoredSensors.some((sensor) => isApproximatelyEqualCpuClockGhz(sensor?.value, displayDecision.displayValueGHz))) {
      anomalyReasons.push('DISPLAY_MATCHES_IGNORED_OHM_SENSOR')
    }
  }

  if (
    displayDecision.displayValueGHz === null
    && rawSensors.length === 0
    && referenceSpeedMaxGHz === null
    && avgGHz === null
  ) {
    return undefined
  }

  return {
    displayValueGHz: displayDecision.displayValueGHz,
    displayChosenFrom: displayDecision.displayChosenFrom,
    telemetrySource: speed?.source || 'unknown',
    validCoreCount: displayDecision.validCoreCount,
    avgGHz,
    cpuSpeedMaxGHz: referenceSpeedMaxGHz,
    maxAcceptedCoreGHz,
    maxIgnoredCoreGHz,
    rawSensorCount: rawSensors.length,
    ignoredSensorCount: ignoredSensors.length,
    anomalyDetected: anomalyReasons.length > 0,
    anomalyReasons: [...new Set(anomalyReasons)],
  }
}

function attachCpuCurrentSpeedDiagnostics(speed, { cpuSpeedMaxGhz } = {}) {
  if (!speed || typeof speed !== 'object') return speed

  return {
    ...speed,
    frequencyDiagnostics: buildCpuCurrentSpeedDiagnostics(speed, { cpuSpeedMaxGhz }),
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function getBundledMacPowermetricsHelperPath() {
  const root = configuredPluginRoot || path.resolve(__dirname, '../..')
  return path.resolve(root, 'vendor/macos/hwinfox-powermetrics-helper')
}

function ensurePhysicalMacPowermetricsHelper() {
  const bundledPath = getBundledMacPowermetricsHelperPath()
  const baseResult = {
    bundledPath,
    runtimePath: bundledPath,
    exists: fs.existsSync(bundledPath),
    insideAsar: isAsarPath(bundledPath),
  }

  if (!baseResult.exists) {
    return {
      ...baseResult,
      reason: 'MACOS_POWERMETRICS_HELPER_BUNDLE_MISSING',
      suggestion: '请先重新构建插件，确保 vendor/macos/hwinfox-powermetrics-helper 存在。',
    }
  }

  if (!baseResult.insideAsar) {
    return baseResult
  }

  const utoolsRuntime = getUtoolsRuntime()
  const userDataPath = utoolsRuntime?.getPath?.('userData')
  if (!userDataPath) {
    return {
      ...baseResult,
      exists: false,
      reason: 'MACOS_POWERMETRICS_HELPER_USERDATA_UNAVAILABLE',
      suggestion: '当前环境无法解析 uTools userData 目录，不能从 asar 解包 helper。',
    }
  }

  const runtimeDirectoryPath = path.join(userDataPath, 'system-info-plugin', 'vendor', 'macos')
  const runtimePath = path.join(runtimeDirectoryPath, 'hwinfox-powermetrics-helper')

  try {
    fs.mkdirSync(runtimeDirectoryPath, { recursive: true })
    fs.writeFileSync(runtimePath, fs.readFileSync(bundledPath))
    fs.chmodSync(runtimePath, 0o755)
  } catch (error) {
    return {
      ...baseResult,
      runtimePath,
      exists: false,
      reason: 'MACOS_POWERMETRICS_HELPER_RUNTIME_COPY_FAILED',
      suggestion: error instanceof Error ? error.message : 'helper 从 asar 解包失败。',
    }
  }

  return {
    ...baseResult,
    runtimePath,
    exists: fs.existsSync(runtimePath),
    reason: fs.existsSync(runtimePath) ? undefined : 'MACOS_POWERMETRICS_HELPER_RUNTIME_COPY_FAILED',
    suggestion: fs.existsSync(runtimePath) ? undefined : 'helper 从 asar 解包失败。',
  }
}

function buildMacPowermetricsHelperPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${MAC_POWERMETRICS_HELPER_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${MAC_POWERMETRICS_HELPER_BINARY_PATH}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/var/log/hwinfox-powermetrics-helper.log</string>
  <key>StandardErrorPath</key>
  <string>/var/log/hwinfox-powermetrics-helper.log</string>
</dict>
</plist>
`
}

function buildMacPowermetricsHelperInstallScript() {
  const helper = ensurePhysicalMacPowermetricsHelper()
  const bundledHelperPath = helper.runtimePath
  const plistContent = buildMacPowermetricsHelperPlist()

  return [
    'set -e',
    `/bin/mkdir -p ${shellQuote(MAC_POWERMETRICS_HELPER_INSTALL_DIR)}`,
    `/usr/sbin/chown root:wheel ${shellQuote(MAC_POWERMETRICS_HELPER_INSTALL_DIR)}`,
    `/bin/chmod 755 ${shellQuote(MAC_POWERMETRICS_HELPER_INSTALL_DIR)}`,
    `/usr/bin/install -o root -g wheel -m 755 ${shellQuote(bundledHelperPath)} ${shellQuote(MAC_POWERMETRICS_HELPER_BINARY_PATH)}`,
    `/bin/cat > ${shellQuote(MAC_POWERMETRICS_HELPER_PLIST_PATH)} <<'HWINFOX_PLIST'`,
    plistContent,
    'HWINFOX_PLIST',
    `/usr/sbin/chown root:wheel ${shellQuote(MAC_POWERMETRICS_HELPER_PLIST_PATH)}`,
    `/bin/chmod 644 ${shellQuote(MAC_POWERMETRICS_HELPER_PLIST_PATH)}`,
    `/bin/launchctl bootout system ${shellQuote(MAC_POWERMETRICS_HELPER_PLIST_PATH)} >/dev/null 2>&1 || true`,
    `/bin/launchctl bootstrap system ${shellQuote(MAC_POWERMETRICS_HELPER_PLIST_PATH)}`,
    `/bin/launchctl enable system/${MAC_POWERMETRICS_HELPER_LABEL}`,
    `/bin/launchctl kickstart -k system/${MAC_POWERMETRICS_HELPER_LABEL}`,
  ].join('\n')
}

function buildMacPowermetricsHelperUninstallScript() {
  return [
    'set -e',
    `/bin/launchctl bootout system ${shellQuote(MAC_POWERMETRICS_HELPER_PLIST_PATH)} >/dev/null 2>&1 || true`,
    `/bin/rm -f ${shellQuote(MAC_POWERMETRICS_HELPER_SOCKET_PATH)}`,
    `/bin/rm -f ${shellQuote(MAC_POWERMETRICS_HELPER_PLIST_PATH)}`,
    `/bin/rm -f ${shellQuote(MAC_POWERMETRICS_HELPER_BINARY_PATH)}`,
  ].join('\n')
}

async function runAppleScriptAsAdministrator(shellScript) {
  return execFileAsync('/usr/bin/osascript', [
    '-e',
    'on run argv',
    '-e',
    'do shell script item 1 of argv with administrator privileges',
    '-e',
    'end run',
    shellScript,
  ], {
    timeout: 30000,
    windowsHide: true,
  })
}

async function isMacPowermetricsHelperLoaded() {
  if (!isMacOS()) return false

  try {
    await execFileAsync('/bin/launchctl', ['print', `system/${MAC_POWERMETRICS_HELPER_LABEL}`], {
      timeout: 1500,
      windowsHide: true,
    })
    return true
  } catch {
    return false
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function getMacPowermetricsHelperStatus() {
  const platform = process.platform === 'darwin' ? 'darwin' : 'other'
  const bundledHelper = isMacOS() ? ensurePhysicalMacPowermetricsHelper() : {
    bundledPath: getBundledMacPowermetricsHelperPath(),
    runtimePath: getBundledMacPowermetricsHelperPath(),
    exists: false,
  }
  const bundledExists = isMacOS() && bundledHelper.exists
  const installed = isMacOS() && fs.existsSync(MAC_POWERMETRICS_HELPER_BINARY_PATH) && fs.existsSync(MAC_POWERMETRICS_HELPER_PLIST_PATH)
  const socketExists = isMacOS() && fs.existsSync(MAC_POWERMETRICS_HELPER_SOCKET_PATH)
  const loaded = installed ? await isMacPowermetricsHelperLoaded() : false

  return {
    platform,
    supported: isMacOS(),
    label: MAC_POWERMETRICS_HELPER_LABEL,
    bundledExists,
    bundledPath: bundledHelper.bundledPath,
    runtimePath: bundledHelper.runtimePath,
    insideAsar: Boolean(bundledHelper.insideAsar),
    installed,
    loaded,
    socketExists,
    installPath: MAC_POWERMETRICS_HELPER_BINARY_PATH,
    plistPath: MAC_POWERMETRICS_HELPER_PLIST_PATH,
    socketPath: MAC_POWERMETRICS_HELPER_SOCKET_PATH,
    reason: !isMacOS()
      ? 'MACOS_POWERMETRICS_HELPER_UNSUPPORTED_PLATFORM'
      : !bundledExists
        ? bundledHelper.reason || 'MACOS_POWERMETRICS_HELPER_BUNDLE_MISSING'
        : installed && loaded && socketExists
          ? 'MACOS_POWERMETRICS_HELPER_READY'
          : installed
            ? 'MACOS_POWERMETRICS_HELPER_INSTALLED_NOT_READY'
            : 'MACOS_POWERMETRICS_HELPER_NOT_INSTALLED',
    suggestion: !isMacOS()
      ? 'powermetrics helper 仅支持 macOS。'
      : !bundledExists
        ? bundledHelper.suggestion || '请先重新构建插件，确保 vendor/macos/hwinfox-powermetrics-helper 存在。'
        : installed && loaded && socketExists
          ? ''
          : installed
            ? 'helper 已安装但未就绪，可尝试重新安装。'
            : '安装 helper 后可免每次授权读取 powermetrics CPU 频率。',
  }
}

async function waitForMacPowermetricsHelperReady(timeoutMs = 5000) {
  const startedAt = Date.now()
  let latestStatus = await getMacPowermetricsHelperStatus()

  while (Date.now() - startedAt < timeoutMs) {
    if (latestStatus.loaded && latestStatus.socketExists) {
      return latestStatus
    }

    await sleep(350)
    latestStatus = await getMacPowermetricsHelperStatus()
  }

  return latestStatus
}

async function installMacPowermetricsHelper() {
  if (!isMacOS()) {
    return {
      ...(await getMacPowermetricsHelperStatus()),
      ok: false,
      reason: 'MACOS_POWERMETRICS_HELPER_UNSUPPORTED_PLATFORM',
      suggestion: 'powermetrics helper 仅支持 macOS。',
    }
  }

  const bundledHelper = ensurePhysicalMacPowermetricsHelper()
  if (!bundledHelper.exists) {
    return {
      ...(await getMacPowermetricsHelperStatus()),
      ok: false,
      reason: bundledHelper.reason || 'MACOS_POWERMETRICS_HELPER_BUNDLE_MISSING',
      suggestion: bundledHelper.suggestion || '缺少 bundled helper，请先运行 npm run build。',
    }
  }

  try {
    await runAppleScriptAsAdministrator(buildMacPowermetricsHelperInstallScript())
    const status = await waitForMacPowermetricsHelperReady()
    invalidateRuntimeServiceCache('cpuCurrentSpeed')
    return {
      ...status,
      ok: status.loaded && status.socketExists,
      reason: status.loaded && status.socketExists
        ? 'MACOS_POWERMETRICS_HELPER_READY'
        : 'MACOS_POWERMETRICS_HELPER_INSTALLED_NOT_READY',
      suggestion: status.loaded && status.socketExists
        ? 'HWInfoX powermetrics helper 已安装并运行。'
        : 'helper 已安装，但 LaunchDaemon 或 socket 还未就绪，请稍后检测状态。',
    }
  } catch (error) {
    return {
      ...(await getMacPowermetricsHelperStatus()),
      ok: false,
      reason: /User canceled|-128/i.test(String(error?.stderr || error?.message || error))
        ? 'MACOS_POWERMETRICS_HELPER_INSTALL_CANCELLED'
        : 'MACOS_POWERMETRICS_HELPER_INSTALL_FAILED',
      suggestion: error instanceof Error ? error.message : String(error),
    }
  }
}

async function uninstallMacPowermetricsHelper() {
  if (!isMacOS()) {
    return {
      ...(await getMacPowermetricsHelperStatus()),
      ok: false,
      reason: 'MACOS_POWERMETRICS_HELPER_UNSUPPORTED_PLATFORM',
      suggestion: 'powermetrics helper 仅支持 macOS。',
    }
  }

  try {
    await runAppleScriptAsAdministrator(buildMacPowermetricsHelperUninstallScript())
    invalidateRuntimeServiceCache('cpuCurrentSpeed')
    return {
      ...(await getMacPowermetricsHelperStatus()),
      ok: true,
      reason: 'MACOS_POWERMETRICS_HELPER_UNINSTALLED',
      suggestion: 'HWInfoX powermetrics helper 已卸载。',
    }
  } catch (error) {
    return {
      ...(await getMacPowermetricsHelperStatus()),
      ok: false,
      reason: /User canceled|-128/i.test(String(error?.stderr || error?.message || error))
        ? 'MACOS_POWERMETRICS_HELPER_UNINSTALL_CANCELLED'
        : 'MACOS_POWERMETRICS_HELPER_UNINSTALL_FAILED',
      suggestion: error instanceof Error ? error.message : String(error),
    }
  }
}

function getDefaultHardwareSensorSettings() {
  const enhancedSensorEnabled = isWindows() || isMacOS()

  return {
    enhancedSensorEnabled,
    openHardwareMonitorAutoStart: isWindows(),
    openHardwareMonitorPort: DEFAULT_HARDWARE_SENSOR_SETTINGS.openHardwareMonitorPort,
  }
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

function readMonitoringRefreshSettingsRaw() {
  const storage = getHardwareSensorSettingsStorage()

  if (storage?.getItem) {
    return storage.getItem(MONITORING_REFRESH_SETTINGS_STORAGE_KEY)
  }

  if (typeof localStorage !== 'undefined') {
    try {
      const value = localStorage.getItem(MONITORING_REFRESH_SETTINGS_STORAGE_KEY)
      return value ? JSON.parse(value) : null
    } catch {
      return null
    }
  }

  return null
}

function writeMonitoringRefreshSettingsRaw(value) {
  const storage = getHardwareSensorSettingsStorage()

  if (storage?.setItem) {
    storage.setItem(MONITORING_REFRESH_SETTINGS_STORAGE_KEY, value)
    return
  }

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(MONITORING_REFRESH_SETTINGS_STORAGE_KEY, JSON.stringify(value))
    } catch {
      // ignore storage fallback failures
    }
  }
}

function readFloatingMonitorSettingsRaw() {
  const storage = getHardwareSensorSettingsStorage()

  if (storage?.getItem) {
    return storage.getItem(FLOATING_MONITOR_SETTINGS_STORAGE_KEY)
  }

  if (typeof localStorage !== 'undefined') {
    try {
      const value = localStorage.getItem(FLOATING_MONITOR_SETTINGS_STORAGE_KEY)
      return value ? JSON.parse(value) : null
    } catch {
      return null
    }
  }

  return null
}

function writeFloatingMonitorSettingsRaw(value) {
  const storage = getHardwareSensorSettingsStorage()

  if (storage?.setItem) {
    storage.setItem(FLOATING_MONITOR_SETTINGS_STORAGE_KEY, value)
    return
  }

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(FLOATING_MONITOR_SETTINGS_STORAGE_KEY, JSON.stringify(value))
    } catch {
      // ignore storage fallback failures
    }
  }
}

function readAppThemeSettingsRaw() {
  const storage = getHardwareSensorSettingsStorage()

  if (storage?.getItem) {
    return storage.getItem(APP_THEME_SETTINGS_STORAGE_KEY)
  }

  if (typeof localStorage !== 'undefined') {
    try {
      const value = localStorage.getItem(APP_THEME_SETTINGS_STORAGE_KEY)
      return value ? JSON.parse(value) : null
    } catch {
      return null
    }
  }

  return null
}

function writeAppThemeSettingsRaw(value) {
  const storage = getHardwareSensorSettingsStorage()

  if (storage?.setItem) {
    storage.setItem(APP_THEME_SETTINGS_STORAGE_KEY, value)
    return
  }

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(APP_THEME_SETTINGS_STORAGE_KEY, JSON.stringify(value))
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

function normalizeMonitoringRefreshSettings(input) {
  const profile = input?.profile === 'eco' || input?.profile === 'balanced' || input?.profile === 'realtime'
    ? input.profile
    : DEFAULT_MONITORING_REFRESH_SETTINGS.profile

  return {
    profile,
    backgroundThrottleEnabled:
      typeof input?.backgroundThrottleEnabled === 'boolean'
        ? input.backgroundThrottleEnabled
        : DEFAULT_MONITORING_REFRESH_SETTINGS.backgroundThrottleEnabled,
  }
}

function normalizeFloatingMonitorSettings(input = {}) {
  const mode = input?.mode === 'super-lite' ? 'super-lite' : 'standard'

  return {
    ...DEFAULT_FLOATING_MONITOR_SETTINGS,
    ...input,
    mode,
    pinned: typeof input?.pinned === 'boolean' ? input.pinned : DEFAULT_FLOATING_MONITOR_SETTINGS.pinned,
    standardSize: DEFAULT_FLOATING_MONITOR_SETTINGS.standardSize,
    superLiteSize: DEFAULT_FLOATING_MONITOR_SETTINGS.superLiteSize,
  }
}

function normalizeAppThemeSettings(input = {}) {
  const preference = input?.preference === 'light' || input?.preference === 'dark'
    ? input.preference
    : DEFAULT_APP_THEME_SETTINGS.preference

  return { preference }
}

function getHardwareSensorSettings() {
  if (!isWindows() && !isMacOS()) {
    return normalizeHardwareSensorSettings(getDefaultHardwareSensorSettings())
  }

  return normalizeHardwareSensorSettings({
    ...getDefaultHardwareSensorSettings(),
    ...(readHardwareSensorSettingsRaw() || {}),
  })
}

function getMonitoringRefreshSettings() {
  return normalizeMonitoringRefreshSettings(readMonitoringRefreshSettingsRaw() || {})
}

function getFloatingMonitorSettings() {
  return normalizeFloatingMonitorSettings(readFloatingMonitorSettingsRaw() || {})
}

function getAppThemeSettings() {
  return normalizeAppThemeSettings(readAppThemeSettingsRaw() || {})
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
  if (!isWindows() && !isMacOS()) {
    return normalizeHardwareSensorSettings(getDefaultHardwareSensorSettings())
  }

  const previous = getHardwareSensorSettings()
  const next = normalizeHardwareSensorSettings({
    ...previous,
    ...patch,
  })
  writeHardwareSensorSettingsRaw(next)

  if (isWindows() && previous.enhancedSensorEnabled !== next.enhancedSensorEnabled) {
    invalidateRuntimeServiceCache(OPEN_HARDWARE_MONITOR_TELEMETRY_CACHE_KEYS)
  }

  if (isWindows() && previous.enhancedSensorEnabled && !next.enhancedSensorEnabled) {
    await stopWindowsSensorHelper()
    await stopPluginManagedOpenHardwareMonitor()
    recordOpenHardwareMonitorRunningState(false)
  }

  return next
}

function updateMonitoringRefreshSettings(patch = {}) {
  const next = normalizeMonitoringRefreshSettings({
    ...getMonitoringRefreshSettings(),
    ...patch,
  })
  writeMonitoringRefreshSettingsRaw(next)
  return next
}

function updateFloatingMonitorSettings(patch = {}) {
  const next = normalizeFloatingMonitorSettings({
    ...getFloatingMonitorSettings(),
    ...patch,
  })
  writeFloatingMonitorSettingsRaw(next)
  return next
}

function updateAppThemeSettings(patch = {}) {
  const next = normalizeAppThemeSettings({
    ...getAppThemeSettings(),
    ...patch,
  })
  writeAppThemeSettingsRaw(next)
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

function scoreCpuClockSensor(sensor) {
  const haystack = normalizeSensorText(sensor)

  if (haystack.includes('bus speed') || haystack.includes('bclk') || haystack.includes('base clock')) return 5
  if (haystack.includes('effective')) return 20
  if (haystack.includes('core max')) return 130
  if (/core\s*#?\d+/.test(haystack)) return 125
  if (haystack.includes('average') || haystack.includes('avg')) return 120
  if (haystack.includes('cpu core')) return 115
  if (haystack.includes('package')) return 105
  if (haystack.includes('core')) return 100
  if (haystack.includes('cpu') || haystack.includes('processor')) return 90
  return 40
}

function isNumberedCpuCoreClockSensor(sensor) {
  return /core\s*#?\d+\b/i.test(normalizeSensorText(sensor))
}

function getCpuCoreClockSensorIndex(sensor) {
  const match = normalizeSensorText(sensor).match(/core\s*#?(\d+)\b/i)
  if (!match) return null

  const coreIndex = Number.parseInt(match[1], 10)
  return Number.isInteger(coreIndex) && coreIndex > 0 ? coreIndex : null
}

function isEffectiveCpuClockSensor(sensor) {
  return normalizeSensorText(sensor).includes('effective')
}

function roundCpuClockGHz(value) {
  return Math.round(value * 100) / 100
}

function normalizeCpuClockGHzValue(value) {
  const numericValue = typeof value === 'number' && Number.isFinite(value) ? value : null
  if (numericValue === null || numericValue <= 0) return null

  const ghzValue = numericValue > 20 ? numericValue / 1000 : numericValue
  if (!Number.isFinite(ghzValue) || ghzValue <= 0 || ghzValue > CPU_CLOCK_ANOMALY_MAX_GHZ) return null
  return roundCpuClockGHz(ghzValue)
}

function getMedianValue(values) {
  if (!values.length) return null

  const sortedValues = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sortedValues.length / 2)

  if (sortedValues.length % 2 === 0) {
    return (sortedValues[middle - 1] + sortedValues[middle]) / 2
  }

  return sortedValues[middle]
}

function getExpectedCpuPhysicalCoreCount(cpuInfo) {
  const physicalCores = toPositiveInteger(cpuInfo?.physicalCores)
  if (physicalCores > 0) return physicalCores

  const performanceCores = toPositiveInteger(cpuInfo?.performanceCores)
  const efficiencyCores = toPositiveInteger(cpuInfo?.efficiencyCores)
  const hybridTotal = performanceCores > 0 && efficiencyCores > 0 ? performanceCores + efficiencyCores : 0
  if (hybridTotal > 0) return hybridTotal

  return 0
}

function sanitizeNumberedCpuCoreClockSensors(sensors, cpuSpeedMaxGhz, expectedCoreCount) {
  if (!sensors.length) {
    return {
      sensors: [],
      displaySensors: [],
      acceptedSensors: [],
    }
  }

  const orderedSensors = [...sensors].sort((left, right) => {
    const leftIndex = left.coreIndex ?? Number.MAX_SAFE_INTEGER
    const rightIndex = right.coreIndex ?? Number.MAX_SAFE_INTEGER
    return leftIndex - rightIndex
  })
  const candidateSensors = expectedCoreCount > 0
    ? orderedSensors.filter((sensor) => (sensor.coreIndex || Number.MAX_SAFE_INTEGER) <= expectedCoreCount)
    : orderedSensors
  const ignoredSensors = expectedCoreCount > 0
    ? orderedSensors.filter((sensor) => (sensor.coreIndex || Number.MAX_SAFE_INTEGER) > expectedCoreCount)
    : []

  if (!candidateSensors.length) {
    return {
      sensors: ignoredSensors.map((sensor) => ({
        ...sensor,
        accepted: false,
        filterReason: 'BEYOND_EXPECTED_CORE_COUNT',
        displayGhzValue: sensor.ghzValue,
      })),
      displaySensors: [],
      acceptedSensors: [],
    }
  }

  const ghzValues = candidateSensors.map((sensor) => sensor.ghzValue)
  const medianValue = getMedianValue(ghzValues) || Math.max(...ghzValues)
  const sortedValues = [...ghzValues].sort((left, right) => left - right)
  const secondHighestValue = sortedValues.length > 1 ? sortedValues[sortedValues.length - 2] : sortedValues[0]
  const trustedCpuSpeedMaxGhz = typeof cpuSpeedMaxGhz === 'number'
    && Number.isFinite(cpuSpeedMaxGhz)
    && cpuSpeedMaxGhz > 0
    && cpuSpeedMaxGhz >= medianValue - 0.4
    ? cpuSpeedMaxGhz
    : null
  const plausibleHighGhz = Math.max(
    secondHighestValue + CPU_CLOCK_OUTLIER_DELTA_GHZ,
    medianValue + CPU_CLOCK_OUTLIER_MEDIAN_DELTA_GHZ,
    trustedCpuSpeedMaxGhz !== null ? trustedCpuSpeedMaxGhz + CPU_CLOCK_SPEEDMAX_TOLERANCE_GHZ : 0
  )

  const sanitizedSensors = candidateSensors.map((sensor) => {
    if (sensor.ghzValue <= plausibleHighGhz) {
      return {
        ...sensor,
        accepted: true,
        filterReason: null,
        displayGhzValue: sensor.ghzValue,
      }
    }

    return {
      ...sensor,
      accepted: false,
      filterReason: 'OUTLIER_HIGH',
      displayGhzValue: null,
    }
  })
  const sanitizedIgnoredSensors = ignoredSensors.map((sensor) => ({
    ...sensor,
    accepted: false,
    filterReason: 'BEYOND_EXPECTED_CORE_COUNT',
    displayGhzValue: sensor.ghzValue,
  }))

  const acceptedSensors = sanitizedSensors.filter((sensor) => sensor.accepted)

  return {
    sensors: [...sanitizedSensors, ...sanitizedIgnoredSensors],
    displaySensors: sanitizedSensors,
    acceptedSensors,
  }
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

async function queryHardwareMonitorSensors(namespace, sensorType) {
  if (typeof process === 'undefined' || process.platform !== 'win32') return []
  if (!['Temperature', 'Load', 'Power', 'Voltage', 'Fan', 'Clock'].includes(sensorType)) return []

  const sensorSettings = getHardwareSensorSettings()
  if (namespace === OPEN_HARDWARE_MONITOR_WMI_NAMESPACE && sensorSettings.enhancedSensorEnabled) {
    const helperSensors = await getWindowsSensorHelperSensors(sensorType)
    if (helperSensors.length) return helperSensors
  }

  return queryWmiSensors(namespace, sensorType)
}

async function getHardwareMonitorSensors(sensorType) {
  if (typeof process === 'undefined' || process.platform !== 'win32') return []

  return queryHardwareMonitorSensors(OPEN_HARDWARE_MONITOR_WMI_NAMESPACE, sensorType)
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

function normalizeWindowsFilePath(pathnameValue = '') {
  if (!pathnameValue) return ''
  const decodedPath = decodeURIComponent(pathnameValue)
  return decodedPath.replace(/^\/([A-Za-z]:[\\/])/, '$1')
}

function getRuntimeRootCandidates() {
  const dirname = typeof __dirname === 'string' ? __dirname : ''
  const filenameDir = typeof __filename === 'string' ? path.dirname(__filename) : ''
  const resourcesPath = typeof process?.resourcesPath === 'string' ? process.resourcesPath : ''
  const locationPathname = typeof globalThis?.location?.pathname === 'string'
    ? normalizeWindowsFilePath(globalThis.location.pathname)
    : ''
  const locationDir = locationPathname ? path.dirname(locationPathname) : ''

  const baseCandidates = uniquePaths([
    locationDir,
    filenameDir,
    dirname,
    resourcesPath,
  ])

  const pluginRoots = []

  for (const baseCandidate of baseCandidates) {
    let current = path.resolve(baseCandidate)

    for (let depth = 0; depth < 6; depth += 1) {
      if (
        fs.existsSync(path.join(current, 'plugin.json'))
        || fs.existsSync(path.join(current, 'preload.js'))
      ) {
        pluginRoots.push(current)
      }

      const parent = path.dirname(current)
      if (!parent || parent === current) {
        break
      }
      current = parent
    }
  }

  return {
    configuredPluginRoot,
    locationDir,
    dirname,
    filenameDir,
    resourcesPath,
    pluginRoots: uniquePaths(pluginRoots),
  }
}

function getOpenHardwareMonitorDirectoryCandidates() {
  const runtimeRoots = getRuntimeRootCandidates()
  const rootCandidates = uniquePaths([
    runtimeRoots.configuredPluginRoot,
    ...runtimeRoots.pluginRoots,
    runtimeRoots.locationDir,
    runtimeRoots.filenameDir,
    runtimeRoots.dirname,
    runtimeRoots.resourcesPath,
  ])

  return uniquePaths([
    ...rootCandidates.map((rootPath) => path.join(rootPath, 'vendor', 'openhardwaremonitor')),
    ...rootCandidates.map((rootPath) => path.join(rootPath, 'dist', 'vendor', 'openhardwaremonitor')),
    ...rootCandidates.map((rootPath) => path.join(rootPath, 'dist-electron', 'vendor', 'openhardwaremonitor')),
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

function resolveWindowsSensorHelperExecutable(resolvedOpenHardwareMonitor) {
  const resolved = resolvedOpenHardwareMonitor || ensurePhysicalOpenHardwareMonitor(resolveOpenHardwareMonitorExecutable())
  const rootDirectoryPath = resolved.runtimeDirectoryPath || resolved.directoryPath || ''
  const directoryPath = rootDirectoryPath ? path.join(rootDirectoryPath, 'sensor-helper') : ''
  const executablePath = directoryPath ? path.join(directoryPath, WINDOWS_SENSOR_HELPER_PROCESS_NAME) : ''
  return {
    directoryPath,
    executablePath,
    exists: Boolean(executablePath && fs.existsSync(executablePath)),
  }
}

function hasBundledWindowsSensorHelper(resolvedOpenHardwareMonitor) {
  const resolved = resolvedOpenHardwareMonitor || resolveOpenHardwareMonitorExecutable()
  const directoryPath = resolved.directoryPath || ''
  const executablePath = directoryPath
    ? path.join(directoryPath, 'sensor-helper', WINDOWS_SENSOR_HELPER_PROCESS_NAME)
    : ''
  return Boolean(executablePath && fs.existsSync(executablePath))
}

function getUtoolsRuntime() {
  return configuredUtoolsRuntime || globalThis?.utools || (typeof utools !== 'undefined' ? utools : undefined)
}

function isAsarPath(targetPath = '') {
  return /(^|[\\/])[^\\/]+\.asar([\\/]|$)/i.test(targetPath)
}

function readTextIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8').trim()
  } catch {
    return ''
  }
}

function readFirstLineIfExists(filePath) {
  const text = readTextIfExists(filePath)
  if (!text) return ''
  return text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || ''
}

function safePathSegment(value) {
  return String(value || 'default')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 64)
}

function getOpenHardwareMonitorBundleVersion(sourceDirectoryPath) {
  const versionFile = path.join(sourceDirectoryPath, 'VERSION.txt')
  const firstLine = readFirstLineIfExists(versionFile)
  const versionMatch = firstLine.match(/\b\d+(?:\.\d+){1,3}\b/)

  if (versionMatch) {
    return versionMatch[0]
  }

  const fullText = readTextIfExists(versionFile)
  const labeledMatch = fullText.match(/Version:\s*([0-9]+(?:\.[0-9]+){1,3})/i)
  if (labeledMatch?.[1]) {
    return labeledMatch[1]
  }

  return 'default'
}

function getOpenHardwareMonitorRuntimeBundleKey(sourceDirectoryPath) {
  const version = getOpenHardwareMonitorBundleVersion(sourceDirectoryPath)
  const helperFingerprint = readFirstLineIfExists(
    path.join(sourceDirectoryPath, 'sensor-helper', 'HWInfoXSensorHelper.source.sha256')
  )
  const helperVersion = /^[a-f0-9]{16,}$/i.test(helperFingerprint)
    ? helperFingerprint.slice(0, 16)
    : 'legacy'
  return safePathSegment(`${version}-${helperVersion}`)
}

function copyDirectoryRecursive(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true })

  const entries = fs.readdirSync(sourceDir, { withFileTypes: true })
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name)
    const targetPath = path.join(targetDir, entry.name)

    if (entry.isDirectory()) {
      copyDirectoryRecursive(sourcePath, targetPath)
      continue
    }

    if (entry.isFile()) {
      fs.writeFileSync(targetPath, fs.readFileSync(sourcePath))
    }
  }
}

function ensurePhysicalOpenHardwareMonitor(resolved = resolveOpenHardwareMonitorExecutable()) {
  const baseResult = {
    ...resolved,
    insideAsar: isAsarPath(resolved.executablePath),
    runtimeDirectoryPath: resolved.directoryPath,
    runtimeExecutablePath: resolved.executablePath,
    runtimeExists: resolved.exists,
  }

  if (!resolved.exists) {
    return {
      ...baseResult,
      reason: 'OHM_EXE_NOT_FOUND',
      suggestion: 'OpenHardwareMonitor 组件不存在，请检查 vendor/openhardwaremonitor 打包产物',
    }
  }

  if (!baseResult.insideAsar) {
    return baseResult
  }

  const utoolsRuntime = getUtoolsRuntime()
  const userDataPath = utoolsRuntime?.getPath?.('userData')

  if (!userDataPath) {
    return {
      ...baseResult,
      runtimeExists: false,
      reason: 'OHM_USERDATA_UNAVAILABLE',
      suggestion: '当前环境无法解析 uTools userData 目录，不能从 asar 解包 OHM',
    }
  }

  const runtimeBundleKey = getOpenHardwareMonitorRuntimeBundleKey(resolved.directoryPath)
  const runtimeDirectoryPath = path.join(userDataPath, 'system-info-plugin', 'vendor', `openhardwaremonitor-${runtimeBundleKey}`)
  const runtimeExecutablePath = path.join(runtimeDirectoryPath, OPEN_HARDWARE_MONITOR_PROCESS_NAME)

  if (!fs.existsSync(runtimeExecutablePath)) {
    copyDirectoryRecursive(resolved.directoryPath, runtimeDirectoryPath)
  }

  return {
    ...baseResult,
    runtimeDirectoryPath,
    runtimeExecutablePath,
    runtimeExists: fs.existsSync(runtimeExecutablePath),
    reason: fs.existsSync(runtimeExecutablePath) ? undefined : 'OHM_RUNTIME_COPY_FAILED',
    suggestion: fs.existsSync(runtimeExecutablePath) ? undefined : 'OpenHardwareMonitor 从插件包复制到本地目录失败',
  }
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

async function isOpenHardwareMonitorHttpReachable(port) {
  if (!isWindows() || typeof fetch !== 'function') return false

  const controller = typeof AbortController === 'function' ? new AbortController() : undefined
  const timer = controller
    ? setTimeout(() => controller.abort(), OPEN_HARDWARE_MONITOR_HTTP_TIMEOUT_MS)
    : undefined

  try {
    const response = await fetch(`http://127.0.0.1:${port}/data.json`, {
      signal: controller?.signal,
    })
    await response.body?.cancel?.()
    return response.ok
  } catch {
    return false
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function isLegacyOpenHardwareMonitorRunning(settings = getHardwareSensorSettings()) {
  if (!isWindows()) return false
  if (await isProcessRunning(OPEN_HARDWARE_MONITOR_PROCESS_NAME)) return true
  return isOpenHardwareMonitorHttpReachable(settings.openHardwareMonitorPort)
}

async function isOpenHardwareMonitorRunning(settings = getHardwareSensorSettings()) {
  if (!isWindows()) return false

  const helperStatus = await getWindowsSensorHelperStatus()
  if (helperStatus?.running) {
    return recordOpenHardwareMonitorRunningState(true)
  }

  return recordOpenHardwareMonitorRunningState(await isLegacyOpenHardwareMonitorRunning(settings))
}

function getOpenHardwareMonitorStateDirectory() {
  if (!isWindows()) return ''

  const userDataPath = getUtoolsRuntime()?.getPath?.('userData')
  if (!userDataPath) return ''

  return path.join(userDataPath, 'system-info-plugin')
}

function getOpenHardwareMonitorStartLockPath() {
  const stateDirectory = getOpenHardwareMonitorStateDirectory()
  return stateDirectory ? path.join(stateDirectory, 'openhardwaremonitor-start.lock') : ''
}

function getOpenHardwareMonitorStartCooldownPath() {
  const stateDirectory = getOpenHardwareMonitorStateDirectory()
  return stateDirectory ? path.join(stateDirectory, 'openhardwaremonitor-start.timestamp') : ''
}

function readOpenHardwareMonitorSharedLastStartAt() {
  const cooldownPath = getOpenHardwareMonitorStartCooldownPath()
  if (!cooldownPath) return 0

  try {
    const value = Number(fs.readFileSync(cooldownPath, 'utf8').trim())
    return Number.isFinite(value) && value > 0 ? value : 0
  } catch {
    return 0
  }
}

function markOpenHardwareMonitorStartAttempt(startedAt = Date.now()) {
  openHardwareMonitorLastStartAt = startedAt

  const cooldownPath = getOpenHardwareMonitorStartCooldownPath()
  if (!cooldownPath) return

  try {
    fs.mkdirSync(path.dirname(cooldownPath), { recursive: true })
    fs.writeFileSync(cooldownPath, String(startedAt), 'utf8')
  } catch {
    // in-memory cooldown still protects the current preload context
  }
}

function acquireOpenHardwareMonitorStartLock() {
  const lockPath = getOpenHardwareMonitorStartLockPath()
  if (!lockPath) {
    return { acquired: true, lockPath: '', fileHandle: null }
  }

  try {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true })
  } catch {
    return { acquired: true, lockPath: '', fileHandle: null }
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fileHandle = fs.openSync(lockPath, 'wx')
      fs.writeFileSync(fileHandle, `${process.pid}:${Date.now()}`)
      return { acquired: true, lockPath, fileHandle }
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        return { acquired: true, lockPath: '', fileHandle: null }
      }

      try {
        const stat = fs.statSync(lockPath)
        if (Date.now() - stat.mtimeMs <= OPEN_HARDWARE_MONITOR_START_LOCK_STALE_MS) {
          return { acquired: false, lockPath, fileHandle: null }
        }
        fs.unlinkSync(lockPath)
      } catch {
        return { acquired: false, lockPath, fileHandle: null }
      }
    }
  }

  return { acquired: false, lockPath, fileHandle: null }
}

function releaseOpenHardwareMonitorStartLock(lock) {
  if (!lock?.lockPath) return

  try {
    if (lock.fileHandle !== null && lock.fileHandle !== undefined) {
      fs.closeSync(lock.fileHandle)
    }
  } catch {
    // best effort only
  }

  try {
    fs.unlinkSync(lock.lockPath)
  } catch {
    // best effort only
  }
}

async function isPreferredWindowsSensorBackendRunning(settings, bundledHelperAvailable) {
  const helperStatus = await getWindowsSensorHelperStatus()
  if (helperStatus?.running) return true
  if (bundledHelperAvailable) return false
  return isLegacyOpenHardwareMonitorRunning(settings)
}

async function waitForOpenHardwareMonitorRunning(
  settings,
  timeoutMs = OPEN_HARDWARE_MONITOR_START_WAIT_MS,
  bundledHelperAvailable = false
) {
  const deadline = Date.now() + timeoutMs

  do {
    if (await isPreferredWindowsSensorBackendRunning(settings, bundledHelperAvailable)) return true
    await new Promise((resolve) => setTimeout(resolve, OPEN_HARDWARE_MONITOR_START_POLL_MS))
  } while (Date.now() < deadline)

  return false
}

function buildOpenHardwareMonitorStatusResult(overrides = {}) {
  const settings = overrides.settings || getHardwareSensorSettings()
  const resolved = overrides.resolved || resolveOpenHardwareMonitorExecutable()
  const helperResolved = overrides.helperResolved || resolveWindowsSensorHelperExecutable(resolved)
  const helperRunning = Boolean(overrides.helperRunning)
  const legacyRunning = Boolean(overrides.legacyRunning)
  const running = typeof overrides.running === 'boolean' ? overrides.running : helperRunning || legacyRunning
  const backend = overrides.backend || (helperRunning ? 'helper' : legacyRunning ? 'legacy-ohm' : 'none')
  const executablePath = overrides.executablePath
    || (backend === 'helper' ? helperResolved.executablePath : resolved.runtimeExecutablePath || resolved.executablePath)

  return {
    platform: isWindows() ? 'win32' : 'other',
    settings,
    running,
    backend,
    helperAvailable: Boolean(helperResolved.exists),
    helperRunning,
    legacyFallback: backend === 'legacy-ohm',
    executableExists: typeof overrides.executableExists === 'boolean'
      ? overrides.executableExists
      : backend === 'helper'
        ? Boolean(helperResolved.exists)
        : Boolean(resolved.runtimeExists ?? resolved.exists),
    executablePath,
    executableDirectory: overrides.executableDirectory || helperResolved.directoryPath || resolved.runtimeDirectoryPath || resolved.directoryPath,
    port: settings.openHardwareMonitorPort,
    started: Boolean(overrides.started),
    reason: overrides.reason,
    suggestion: overrides.suggestion,
  }
}

async function getOpenHardwareMonitorStatus() {
  const settings = getHardwareSensorSettings()
  const resolved = ensurePhysicalOpenHardwareMonitor(resolveOpenHardwareMonitorExecutable())
  const helperResolved = resolveWindowsSensorHelperExecutable(resolved)

  if (!isWindows()) {
    return buildOpenHardwareMonitorStatusResult({
      settings,
      resolved,
      helperResolved,
      running: false,
      executableExists: false,
      reason: 'NOT_WINDOWS',
    })
  }

  const helperStatus = await getWindowsSensorHelperStatus()
  const helperRunning = Boolean(helperStatus?.running)
  const legacyRunning = helperRunning ? false : await isLegacyOpenHardwareMonitorRunning(settings)
  const running = recordOpenHardwareMonitorRunningState(helperRunning || legacyRunning)
  const backend = helperRunning ? 'helper' : legacyRunning ? 'legacy-ohm' : 'none'

  return buildOpenHardwareMonitorStatusResult({
    settings,
    resolved,
    helperResolved,
    helperRunning,
    legacyRunning,
    running,
    backend,
    executableExists: helperResolved.exists || resolved.runtimeExists,
    executablePath: helperRunning ? helperResolved.executablePath : resolved.runtimeExecutablePath,
    executableDirectory: resolved.runtimeDirectoryPath,
    reason: running
      ? undefined
      : helperResolved.exists
        ? 'WINDOWS_SENSOR_HELPER_NOT_RUNNING'
        : resolved.runtimeExists
          ? 'WINDOWS_SENSOR_HELPER_NOT_BUILT'
          : resolved.reason || 'OHM_EXE_NOT_FOUND',
    suggestion: running
      ? undefined
      : helperResolved.exists
        ? '传感器增强组件尚未运行'
        : resolved.runtimeExists
          ? '当前包未包含 Windows 无界面 helper，将使用兼容模式'
          : resolved.suggestion || 'Windows 传感器后端组件不存在',
  })
}

function countWindowsSensorRowsByField(rows, fieldName) {
  const counts = {}
  for (const row of rows) {
    const key = typeof row?.[fieldName] === 'string' && row[fieldName].trim()
      ? row[fieldName].trim()
      : 'Unknown'
    counts[key] = (counts[key] || 0) + 1
  }
  return counts
}

function isWindowsDiagnosticCpuSensor(sensor) {
  const hardwareType = typeof sensor?.hardwareType === 'string' ? sensor.hardwareType.toLowerCase() : ''
  return hardwareType.includes('cpu') || isCpuSensor(sensor)
}

function buildWindowsSensorDiagnosticSamples(rows) {
  const prioritized = [...rows].sort((left, right) => {
    const score = (sensor) => {
      let value = 0
      if (isWindowsDiagnosticCpuSensor(sensor)) value += 100
      if (sensor?.sensorType === 'Temperature') value += 50
      if (sensor?.sensorType === 'Voltage') value += 45
      if (sensor?.sensorType === 'Clock') value += 30
      if (sensor?.sensorType === 'Power') value += 20
      return value
    }
    return score(right) - score(left)
  })

  return prioritized.slice(0, 30).map((sensor) => ({
    name: typeof sensor?.name === 'string' ? sensor.name : '',
    identifier: typeof sensor?.identifier === 'string' ? sensor.identifier : '',
    parent: typeof sensor?.parent === 'string' ? sensor.parent : '',
    parentIdentifier: typeof sensor?.parentIdentifier === 'string' ? sensor.parentIdentifier : '',
    hardwareType: typeof sensor?.hardwareType === 'string' ? sensor.hardwareType : '',
    sensorType: typeof sensor?.sensorType === 'string' ? sensor.sensorType : '',
    value: typeof sensor?.value === 'number' && Number.isFinite(sensor.value) ? sensor.value : null,
  }))
}

function resolveWindowsSensorDiagnosticFailure({
  status,
  snapshot,
  processPresent,
  crashLog,
  sensorCount,
  cpuHardwareSensorCount,
  cpuFilterMatchCount,
  cpuTemperatureCount,
}) {
  if (!status?.running) {
    if (processPresent && !snapshot?.received) {
      return {
        code: 'WINDOWS_SENSOR_HELPER_PIPE_UNREACHABLE',
        message: 'helper 进程仍在运行，但 Named Pipe 没有响应；优先检查 Pipe 创建失败、权限/MIC 或 helper 卡在初始化阶段',
      }
    }

    if (crashLog) {
      return {
        code: 'WINDOWS_SENSOR_HELPER_CRASHED',
        message: 'helper 启动后已退出，并写入了异常日志；请复制完整诊断中的 crashLog',
      }
    }

    if (snapshot?.error === 'WINDOWS_SENSOR_HELPER_SNAPSHOT_NO_RESPONSE') {
      return {
        code: 'WINDOWS_SENSOR_HELPER_EXITED_EARLY',
        message: 'helper 启动后未保持运行，也没有建立 Named Pipe；可能在程序集加载或 Computer 初始化早期退出',
      }
    }

    return {
      code: status?.reason || 'WINDOWS_SENSOR_BACKEND_NOT_RUNNING',
      message: status?.suggestion || 'Windows 传感器增强后端尚未运行',
    }
  }

  if (status.backend !== 'helper') {
    return {
      code: 'WINDOWS_SENSOR_LEGACY_BACKEND_ACTIVE',
      message: '当前仍在使用兼容后端，没有走内置 Named Pipe helper',
    }
  }

  if (!snapshot?.received) {
    return {
      code: snapshot?.error || 'WINDOWS_SENSOR_HELPER_SNAPSHOT_NO_RESPONSE',
      message: 'helper 已运行，但 snapshot 请求没有收到响应',
    }
  }

  if (!snapshot.ok) {
    return {
      code: 'WINDOWS_SENSOR_HELPER_SNAPSHOT_FAILED',
      message: snapshot.error || 'helper snapshot 执行失败',
    }
  }

  if (sensorCount === 0) {
    return {
      code: 'WINDOWS_SENSOR_HELPER_SNAPSHOT_EMPTY',
      message: 'helper snapshot 成功，但 OpenHardwareMonitorLib 没有返回任何有值的传感器',
    }
  }

  if (cpuHardwareSensorCount === 0) {
    return {
      code: 'WINDOWS_SENSOR_HELPER_CPU_NOT_ENUMERATED',
      message: 'helper 返回了传感器，但没有识别到 CPU 硬件传感器',
    }
  }

  if (cpuFilterMatchCount === 0) {
    return {
      code: 'WINDOWS_SENSOR_CPU_FILTER_MISMATCH',
      message: 'helper 返回了 CPU 类型传感器，但现有 CPU 名称/标识过滤规则没有命中',
    }
  }

  if (cpuTemperatureCount === 0) {
    return {
      code: 'WINDOWS_SENSOR_HELPER_CPU_TEMPERATURE_MISSING',
      message: 'helper 已返回 CPU 传感器，但其中没有可用 Temperature 项',
    }
  }

  return {
    code: '',
    message: 'helper 已返回可用 CPU 温度传感器；如果界面仍为空，问题位于后续归一化或缓存链路',
  }
}

async function getWindowsSensorEnhancementDiagnostics() {
  const status = await getOpenHardwareMonitorStatus()
  const bundledResolved = resolveOpenHardwareMonitorExecutable()
  const physicalResolved = ensurePhysicalOpenHardwareMonitor(bundledResolved)
  const helperResolved = resolveWindowsSensorHelperExecutable(physicalResolved)
  const helperStatus = isWindows() ? await getWindowsSensorHelperStatus() : null
  const processPresent = isWindows() ? await isProcessRunning(WINDOWS_SENSOR_HELPER_PROCESS_NAME) : false
  const crashLogPath = helperResolved.directoryPath
    ? path.join(helperResolved.directoryPath, 'HWInfoXSensorHelper.error.log')
    : ''
  const rawCrashLog = crashLogPath ? readTextIfExists(crashLogPath) : ''
  const crashLog = rawCrashLog.length > 12000 ? rawCrashLog.slice(-12000) : rawCrashLog
  const snapshot = isWindows() && (helperResolved.exists || helperStatus?.running || processPresent)
    ? await readWindowsSensorHelperDiagnosticSnapshot()
    : {
        received: false,
        ok: false,
        sensors: [],
        error: isWindows() ? 'WINDOWS_SENSOR_HELPER_NOT_AVAILABLE' : 'NOT_WINDOWS',
      }
  const sensors = Array.isArray(snapshot?.sensors) ? snapshot.sensors : []
  const cpuHardwareSensors = sensors.filter(isWindowsDiagnosticCpuSensor)
  const cpuFilterSensors = sensors.filter(isCpuSensor)
  const cpuTemperatureSensors = cpuFilterSensors.filter((sensor) => sensor?.sensorType === 'Temperature')
  const cpuClockSensors = cpuFilterSensors.filter((sensor) => sensor?.sensorType === 'Clock')
  const cpuPowerSensors = cpuFilterSensors.filter((sensor) => sensor?.sensorType === 'Power')
  const cpuVoltageSensors = cpuFilterSensors.filter((sensor) => sensor?.sensorType === 'Voltage')
  const usableCpuVoltageSensors = cpuVoltageSensors.filter((sensor) => (
    typeof sensor?.value === 'number'
    && Number.isFinite(sensor.value)
    && sensor.value > 0
  ))
  const cpuFanSensors = cpuFilterSensors.filter((sensor) => sensor?.sensorType === 'Fan')
  const rawTemperatureSensors = sensors.filter((sensor) => sensor?.sensorType === 'Temperature')
  const failure = resolveWindowsSensorDiagnosticFailure({
    status,
    snapshot,
    processPresent,
    crashLog,
    sensorCount: sensors.length,
    cpuHardwareSensorCount: cpuHardwareSensors.length,
    cpuFilterMatchCount: cpuFilterSensors.length,
    cpuTemperatureCount: cpuTemperatureSensors.length,
  })

  return {
    generatedAt: Date.now(),
    status,
    helper: {
      bundledAvailable: hasBundledWindowsSensorHelper(bundledResolved),
      runtimeAvailable: helperResolved.exists,
      executablePath: helperResolved.executablePath,
      executableDirectory: helperResolved.directoryPath,
      running: Boolean(helperStatus?.running),
      processPresent,
      elevated: Boolean(helperStatus?.elevated ?? snapshot?.elevated),
      helperVersion: helperStatus?.helperVersion || snapshot?.helperVersion || '',
      backend: helperStatus?.backend || snapshot?.backend || '',
      processId: helperStatus?.processId ?? null,
      crashLogPath,
      crashLogExists: Boolean(crashLog),
      crashLog,
      snapshotReceived: Boolean(snapshot?.received),
      snapshotOk: Boolean(snapshot?.ok),
      snapshotGeneratedAt: Number.isFinite(snapshot?.generatedAt) ? snapshot.generatedAt : null,
      snapshotError: snapshot?.error || '',
    },
    sensors: {
      total: sensors.length,
      rawTemperatureCount: rawTemperatureSensors.length,
      cpuHardwareSensorCount: cpuHardwareSensors.length,
      cpuFilterMatchCount: cpuFilterSensors.length,
      cpuTemperatureCount: cpuTemperatureSensors.length,
      cpuClockCount: cpuClockSensors.length,
      cpuPowerCount: cpuPowerSensors.length,
      cpuVoltageCount: cpuVoltageSensors.length,
      cpuVoltageUsableCount: usableCpuVoltageSensors.length,
      cpuVoltageSamples: usableCpuVoltageSensors.map((sensor) => ({
        name: typeof sensor?.name === 'string' ? sensor.name : '',
        identifier: typeof sensor?.identifier === 'string' ? sensor.identifier : '',
        value: typeof sensor?.value === 'number' && Number.isFinite(sensor.value) ? sensor.value : null,
      })),
      cpuFanCount: cpuFanSensors.length,
      sensorTypeCounts: countWindowsSensorRowsByField(sensors, 'sensorType'),
      hardwareTypeCounts: countWindowsSensorRowsByField(sensors, 'hardwareType'),
      samples: buildWindowsSensorDiagnosticSamples(sensors),
    },
    failureCode: failure.code,
    failureMessage: failure.message,
  }
}

async function startBundledOpenHardwareMonitor() {
  const resolved = ensurePhysicalOpenHardwareMonitor(resolveOpenHardwareMonitorExecutable())

  if (!isWindows()) {
    return buildOpenHardwareMonitorStatusResult({
      resolved,
      reason: 'NOT_WINDOWS',
    })
  }

  const executablePath = resolved.runtimeExecutablePath

  if (!resolved.runtimeExists) {
    return buildOpenHardwareMonitorStatusResult({
      resolved,
      executableExists: false,
      executablePath,
      executableDirectory: resolved.runtimeDirectoryPath,
      reason: resolved.reason || 'OHM_EXE_NOT_FOUND',
      suggestion: resolved.suggestion || 'OpenHardwareMonitor 组件不存在，请检查 vendor/openhardwaremonitor 打包产物',
    })
  }

  try {
    const startScript = [
      `$p = Start-Process -FilePath '${executablePath.replace(/'/g, "''")}'`,
      `-WorkingDirectory '${path.dirname(executablePath).replace(/'/g, "''")}'`,
      '-WindowStyle Hidden -PassThru',
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
        executableDirectory: resolved.runtimeDirectoryPath,
        started: true,
      })
  } catch (error) {
    return buildOpenHardwareMonitorStatusResult({
        resolved,
        executableExists: true,
        executablePath,
        executableDirectory: resolved.runtimeDirectoryPath,
        reason: 'OHM_START_FAILED',
        suggestion: '可能需要管理员权限，或被安全软件拦截',
        error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function startPreferredWindowsSensorBackend() {
  const bundledResolved = resolveOpenHardwareMonitorExecutable()
  const bundledHelperAvailable = hasBundledWindowsSensorHelper(bundledResolved)
  const resolved = ensurePhysicalOpenHardwareMonitor(bundledResolved)
  const helperResolved = resolveWindowsSensorHelperExecutable(resolved)

  if (helperResolved.exists) {
    const helperResult = await startWindowsSensorHelper({
      executablePath: helperResolved.executablePath,
      workingDirectory: helperResolved.directoryPath,
    })

    return buildOpenHardwareMonitorStatusResult({
      resolved,
      helperResolved,
      helperRunning: Boolean(helperResult.running),
      running: Boolean(helperResult.running),
      backend: helperResult.running ? 'helper' : 'none',
      executableExists: true,
      executablePath: helperResolved.executablePath,
      executableDirectory: helperResolved.directoryPath,
      started: Boolean(helperResult.started && helperResult.running),
      reason: helperResult.running ? undefined : helperResult.reason || 'WINDOWS_SENSOR_HELPER_START_FAILED',
      suggestion: helperResult.running ? undefined : helperResult.suggestion || 'Windows 传感器增强组件启动失败',
    })
  }

  if (bundledHelperAvailable && !helperResolved.exists) {
    return buildOpenHardwareMonitorStatusResult({
      resolved,
      helperResolved,
      running: false,
      backend: 'none',
      executableExists: false,
      executablePath: helperResolved.executablePath,
      executableDirectory: helperResolved.directoryPath,
      reason: 'WINDOWS_SENSOR_HELPER_RUNTIME_MISSING',
      suggestion: 'Windows 传感器增强组件已随插件提供，但运行时复制不完整；请重启插件后重试',
    })
  }

  if (!bundledHelperAvailable) {
    const legacyResult = await startBundledOpenHardwareMonitor()
    return {
      ...legacyResult,
      backend: legacyResult.started ? 'legacy-ohm' : 'none',
      legacyFallback: true,
      helperAvailable: false,
      suggestion: legacyResult.started
        ? '当前包未包含无界面 helper，已使用后台兼容模式'
        : legacyResult.suggestion,
    }
  }

  return buildOpenHardwareMonitorStatusResult({
    resolved,
    helperResolved,
    running: false,
    backend: 'none',
    reason: 'WINDOWS_SENSOR_HELPER_UNAVAILABLE',
    suggestion: 'Windows 传感器增强组件不可用',
  })
}

async function ensureOpenHardwareMonitorRunning(options = {}) {
  const settings = getHardwareSensorSettings()
  const bundledResolved = resolveOpenHardwareMonitorExecutable()
  const bundledHelperAvailable = hasBundledWindowsSensorHelper(bundledResolved)
  const resolved = ensurePhysicalOpenHardwareMonitor(bundledResolved)
  const allowStartWithoutAutoStart = Boolean(options.allowStartWithoutAutoStart)

  if (!isWindows()) {
    return buildOpenHardwareMonitorStatusResult({
      settings,
      resolved,
      reason: 'NOT_WINDOWS',
    })
  }

  const preferredBackendRunning = await isPreferredWindowsSensorBackendRunning(settings, bundledHelperAvailable)
  if (preferredBackendRunning) {
    return getOpenHardwareMonitorStatus()
  }

  if (!settings.enhancedSensorEnabled) {
    return buildOpenHardwareMonitorStatusResult({
      settings,
      resolved,
      running: false,
      executableExists: resolved.runtimeExists,
      executableDirectory: resolved.runtimeDirectoryPath,
      executablePath: resolved.runtimeExecutablePath,
      reason: resolved.runtimeExists ? 'ENHANCED_SENSOR_DISABLED' : (resolved.reason || 'OHM_EXE_NOT_FOUND'),
      suggestion: '请先启用 Windows 传感器增强',
    })
  }

  if (!settings.openHardwareMonitorAutoStart && !allowStartWithoutAutoStart) {
    return buildOpenHardwareMonitorStatusResult({
      settings,
      resolved,
      running: false,
      executableExists: resolved.runtimeExists,
      executableDirectory: resolved.runtimeDirectoryPath,
      executablePath: resolved.runtimeExecutablePath,
      reason: resolved.runtimeExists ? 'OHM_AUTOSTART_DISABLED' : (resolved.reason || 'OHM_EXE_NOT_FOUND'),
      suggestion: '传感器增强自动准备已关闭',
    })
  }

  if (openHardwareMonitorStartPromise) {
    return openHardwareMonitorStartPromise
  }

  const now = Date.now()
  const lastStartAt = Math.max(openHardwareMonitorLastStartAt, readOpenHardwareMonitorSharedLastStartAt())
  if (now - lastStartAt < OPEN_HARDWARE_MONITOR_START_COOLDOWN_MS) {
    const runningAfterCooldownCheck = await isPreferredWindowsSensorBackendRunning(settings, bundledHelperAvailable)
    if (runningAfterCooldownCheck) return getOpenHardwareMonitorStatus()
    return buildOpenHardwareMonitorStatusResult({
      settings,
      resolved,
      running: false,
      executableExists: resolved.runtimeExists,
      executableDirectory: resolved.runtimeDirectoryPath,
      executablePath: resolved.runtimeExecutablePath,
      reason: 'WINDOWS_SENSOR_START_COOLDOWN',
      suggestion: '刚刚尝试过准备传感器增强组件，请稍后再试',
    })
  }

  const startLock = acquireOpenHardwareMonitorStartLock()
  if (!startLock.acquired) {
    const runningAfterWait = await waitForOpenHardwareMonitorRunning(
      settings,
      OPEN_HARDWARE_MONITOR_START_WAIT_MS,
      bundledHelperAvailable
    )
    if (runningAfterWait) return getOpenHardwareMonitorStatus()
    return buildOpenHardwareMonitorStatusResult({
      settings,
      resolved,
      running: false,
      executableExists: resolved.runtimeExists,
      executableDirectory: resolved.runtimeDirectoryPath,
      executablePath: resolved.runtimeExecutablePath,
      reason: 'WINDOWS_SENSOR_START_IN_PROGRESS',
      suggestion: '另一个窗口正在准备传感器增强组件，请稍后再试',
    })
  }

  openHardwareMonitorStartPromise = (async () => {
    try {
      if (await isPreferredWindowsSensorBackendRunning(settings, bundledHelperAvailable)) {
        return getOpenHardwareMonitorStatus()
      }

      markOpenHardwareMonitorStartAttempt()
      const startResult = await startPreferredWindowsSensorBackend()
      if (!startResult.started && !startResult.running) {
        return startResult
      }

      const startedRunning = await waitForOpenHardwareMonitorRunning(
        settings,
        OPEN_HARDWARE_MONITOR_START_WAIT_MS,
        bundledHelperAvailable
      )
      const latestStatus = await getOpenHardwareMonitorStatus()
      return {
        ...latestStatus,
        running: startedRunning,
        started: Boolean(startResult.started && startedRunning),
        reason: startedRunning ? undefined : startResult.reason || 'WINDOWS_SENSOR_BACKEND_START_FAILED',
        suggestion: startedRunning ? undefined : startResult.suggestion || 'Windows 传感器增强组件未能就绪，请重试或检查安全软件拦截',
      }
    } finally {
      releaseOpenHardwareMonitorStartLock(startLock)
    }
  })().finally(() => {
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
  return ensureOpenHardwareMonitorRunning({ allowStartWithoutAutoStart: true })
}

async function openOpenHardwareMonitorDirectory() {
  if (!isWindows()) return false

  const resolved = ensurePhysicalOpenHardwareMonitor(resolveOpenHardwareMonitorExecutable())
  const directoryPath = resolved.runtimeDirectoryPath

  if (!directoryPath || !resolved.runtimeExists || !fs.existsSync(directoryPath)) {
    return {
      ok: false,
      directoryPath,
      reason: resolved.reason || 'OHM_EXE_NOT_FOUND',
      suggestion: resolved.suggestion || 'OpenHardwareMonitor 目录不可用',
    }
  }

  try {
    const utoolsRuntime = getUtoolsRuntime()
    if (utoolsRuntime && typeof utoolsRuntime.shellOpenPath === 'function') {
      utoolsRuntime.shellOpenPath(directoryPath)
      return {
        ok: true,
        directoryPath,
      }
    }

    await execFileAsync('explorer.exe', [path.normalize(directoryPath)], {
      windowsHide: false,
      timeout: 4000,
    })
    return {
      ok: true,
      directoryPath,
    }
  } catch (error) {
    return {
      ok: false,
      directoryPath,
      reason: 'OHM_OPEN_DIRECTORY_FAILED',
      suggestion: error instanceof Error ? error.message : String(error),
    }
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
    'OpenHardwareMonitor',
    mainSensor?.name || undefined,
    mainSensor ? toValidCpuTemperature(mainSensor.value) : null
  )
}

async function getHardwareMonitorCpuTemperature() {
  return getHardwareMonitorCpuTemperatureFromNamespace(OPEN_HARDWARE_MONITOR_WMI_NAMESPACE)
}

async function getHardwareMonitorCpuPower() {
  if (isMacOS()) {
    const macCpuPower = await readMacPowermetricsHelperCpuPower()
    if (typeof macCpuPower?.value === 'number' && macCpuPower.value > 0) {
      return macCpuPower
    }
  }

  const sensors = (await getHardwareMonitorSensors('Power')).filter(isCpuSensor)

  if (!sensors.length) return undefined

  const sortedSensors = [...sensors].sort((a, b) => scoreCpuPowerSensor(b) - scoreCpuPowerSensor(a))
  const mainSensor = sortedSensors[0]

  return {
    value: Math.round(mainSensor.value * 10) / 10,
    source: 'OpenHardwareMonitor',
    sensorName: mainSensor.name,
    sensors: sensors.map((sensor) => ({
      name: sensor.name,
      value: Math.round(sensor.value * 10) / 10,
    })),
  }
}

async function getHardwareMonitorCpuVoltage() {
  const sensors = (await getHardwareMonitorSensors('Voltage')).filter(isCpuSensor)
  const usableSensors = sensors.filter((sensor) => (
    typeof sensor.value === 'number'
    && Number.isFinite(sensor.value)
    && sensor.value > 0
  ))

  if (!usableSensors.length) {
    return {
      value: null,
      source: 'unsupported',
      unit: 'V',
      max: null,
    }
  }

  const mainSensor = [...usableSensors].sort((a, b) => scoreCpuVoltageSensor(b) - scoreCpuVoltageSensor(a))[0]

  return {
    value: mainSensor ? Math.round(mainSensor.value * 100) / 100 : null,
    source: 'OpenHardwareMonitor',
    sensorName: mainSensor?.name,
    unit: 'V',
    max: Math.max(...usableSensors.map((sensor) => sensor.value)),
  }
}

async function getHardwareMonitorCpuFanSpeed() {
  if (isMacOS()) {
    const macFanSpeed = readMacSmcFanSpeed({ pluginRoot: configuredPluginRoot })
    if (macFanSpeed) return macFanSpeed
  }

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
    source: 'OpenHardwareMonitor',
    sensorName: mainSensor?.name,
    unit: 'RPM',
    max: Math.max(...sensors.map((sensor) => sensor.value)),
  }
}

function buildHardwareMonitorCpuCurrentSpeedResult(sensors, { cpuSpeedMaxGhz, expectedCoreCount } = {}) {
  if (!sensors.length) return undefined

  const normalized = sensors
    .map((sensor) => {
      const ghzValue = normalizeCpuClockGHzValue(sensor.value)
      if (ghzValue === null) return null
      return {
        ...sensor,
        ghzValue,
        coreIndex: getCpuCoreClockSensorIndex(sensor),
        effectiveClock: isEffectiveCpuClockSensor(sensor),
      }
    })
    .filter(Boolean)

  if (!normalized.length) return undefined

  const numberedCoreSensors = normalized.filter((sensor) => sensor.coreIndex !== null && !sensor.effectiveClock)
  const sanitizedNumberedCoreSensors = sanitizeNumberedCpuCoreClockSensors(
    numberedCoreSensors,
    cpuSpeedMaxGhz,
    expectedCoreCount
  )
  const coreValues = sanitizedNumberedCoreSensors.displaySensors.map((sensor) => sensor.displayGhzValue ?? null)
  const summaryCandidates = normalized.filter((sensor) => !sensor.effectiveClock)
  const summarySensors = numberedCoreSensors.length
    ? sanitizedNumberedCoreSensors.acceptedSensors
    : summaryCandidates.filter((sensor) => scoreCpuClockSensor(sensor) >= 90)
  const summarizedValues = summarySensors.length
    ? summarySensors
      .map((sensor) => sensor.displayGhzValue ?? sensor.ghzValue)
      .filter((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)
    : numberedCoreSensors.length
      ? []
      : summaryCandidates.map((sensor) => sensor.ghzValue)
  const avgFromAll = summarizedValues.length
    ? summarizedValues.reduce((sum, value) => sum + value, 0) / summarizedValues.length
    : null
  const mainSensor = [...(summarySensors.length ? summarySensors : summaryCandidates)].sort((a, b) => scoreCpuClockSensor(b) - scoreCpuClockSensor(a))[0]
  const speedResult = {
    min: summarizedValues.length ? Math.min(...summarizedValues) : null,
    max: summarizedValues.length ? Math.max(...summarizedValues) : null,
    avg: typeof avgFromAll === 'number' ? Math.round(avgFromAll * 100) / 100 : null,
    cores: coreValues,
    source: 'OpenHardwareMonitor',
    sensorName: mainSensor?.name,
    allCpuClockSensors: normalized.map((sensor) => {
      if (sensor.effectiveClock) {
        return {
          name: sensor.name,
          identifier: sensor.identifier,
          hardwareName: sensor.parent || undefined,
          value: sensor.ghzValue,
          coreIndex: sensor.coreIndex ?? undefined,
          accepted: false,
          filterReason: 'EFFECTIVE_CLOCK_IGNORED',
        }
      }
      const matchedNumberedSensor = sanitizedNumberedCoreSensors.sensors.find((item) => item.identifier === sensor.identifier)
      return {
        name: sensor.name,
        identifier: sensor.identifier,
        hardwareName: sensor.parent || undefined,
        value: sensor.ghzValue,
        coreIndex: matchedNumberedSensor?.coreIndex ?? sensor.coreIndex ?? undefined,
        accepted: matchedNumberedSensor ? matchedNumberedSensor.accepted : true,
        filterReason: matchedNumberedSensor?.filterReason || undefined,
      }
    }),
  }

  return attachCpuCurrentSpeedDiagnostics(speedResult, { cpuSpeedMaxGhz })
}

async function getHardwareMonitorCpuCurrentSpeedFromNamespace(namespace, cpuInfo) {
  const sensors = (await queryHardwareMonitorSensors(namespace, 'Clock'))
    .filter(isCpuSensor)
    .filter((sensor) => {
      const haystack = normalizeSensorText(sensor)
      return (
        !haystack.includes('bus speed')
        && !haystack.includes('bclk')
        && !haystack.includes('base clock')
        && !haystack.includes('memory')
        && !haystack.includes('fabric')
        && !haystack.includes('uncore')
      )
    })

  return buildHardwareMonitorCpuCurrentSpeedResult(sensors, {
    cpuSpeedMaxGhz: normalizeCpuClockGHzValue(cpuInfo?.speedMax),
    expectedCoreCount: getExpectedCpuPhysicalCoreCount(cpuInfo),
  })
}

async function getHardwareMonitorCpuCurrentSpeed(cpuInfo) {
  return getHardwareMonitorCpuCurrentSpeedFromNamespace(OPEN_HARDWARE_MONITOR_WMI_NAMESPACE, cpuInfo)
}

async function getCpuTemperature() {
  try {
    const temperature = await si.cpuTemperature()
    const systemInfoValue = extractSystemInformationCpuTemperatureValue(temperature)
    const sensorSettings = getHardwareSensorSettings()
    const enhancedSensorEnabled = isWindows() && sensorSettings.enhancedSensorEnabled
    let macTemperature

    if (systemInfoValue.value !== null) {
      return buildCpuTemperatureResult(temperature, 'systeminformation', systemInfoValue.sensorName, systemInfoValue.value)
    }

    if (isMacOS()) {
      macTemperature = readMacSmcCpuTemperature({ pluginRoot: configuredPluginRoot }) || readMacCpuTemperature({ pluginRoot: configuredPluginRoot })
      if (macTemperature?.value !== null && macTemperature?.value !== undefined) {
        return buildCpuTemperatureResult(
          macTemperature,
          macTemperature.source,
          macTemperature.sensorName,
          macTemperature.value
        )
      }
    }

    const openTemperature = enhancedSensorEnabled
      ? await getHardwareMonitorCpuTemperatureFromNamespace(OPEN_HARDWARE_MONITOR_WMI_NAMESPACE)
      : undefined
    if (openTemperature && openTemperature.value !== null) {
      return openTemperature
    }

    const baseDiagnostics = [
      'systeminformation 未提供有效 CPU 温度',
      macTemperature?.message ? `macOS 原生传感器: ${macTemperature.message}` : '',
      isWindows()
        ? openTemperature?.value === null
          ? 'Windows 增强后端: 无可用温度'
          : 'Windows 增强后端: 未命中'
        : '',
    ].filter(Boolean)

    if (!isWindows()) {
      return buildCpuTemperatureResult(
        {
          ...temperature,
          errorCode: macTemperature?.errorCode || 'CPU_TEMPERATURE_UNAVAILABLE',
          reason: macTemperature?.reason || 'TEMPERATURE_UNAVAILABLE',
          message: baseDiagnostics.join(' | '),
          suggestion: macTemperature?.suggestion || (isMacOS() ? 'macOS 原生温度探针不可用，后续需要接入 SMC/IOReport 探针或授权 helper' : '当前系统未返回可用 CPU 温度'),
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
          suggestion: 'Windows 下可在处理器页启用传感器增强',
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

    const enhancedTemperature = await getHardwareMonitorCpuTemperatureFromNamespace(OPEN_HARDWARE_MONITOR_WMI_NAMESPACE)
    if (enhancedTemperature?.value !== null && enhancedTemperature?.value !== undefined) {
      return enhancedTemperature
    }

    const legacyHttpResult = openHardwareMonitorStatus?.backend === 'legacy-ohm'
      ? await readOpenHardwareMonitorHttp(sensorSettings.openHardwareMonitorPort)
      : undefined
    if (legacyHttpResult?.value !== null && legacyHttpResult?.value !== undefined) {
      return legacyHttpResult
    }

    const diagnostics = [
      ...baseDiagnostics,
      openHardwareMonitorStatus?.reason
        ? `Windows 增强启动状态: ${openHardwareMonitorStatus.reason}`
        : 'Windows 增强启动状态: 未尝试自动启动',
      openHardwareMonitorStatus?.backend ? `Windows 增强后端: ${openHardwareMonitorStatus.backend}` : '',
      legacyHttpResult?.reason ? `兼容后端读取结果: ${legacyHttpResult.reason}` : '',
    ].filter(Boolean)

    return buildCpuTemperatureResult(
      {
        ...temperature,
        errorCode: legacyHttpResult?.errorCode || 'CPU_TEMPERATURE_UNAVAILABLE',
        reason: legacyHttpResult?.reason || openHardwareMonitorStatus?.reason || 'TEMPERATURE_UNAVAILABLE',
        message: diagnostics.join(' | '),
        suggestion: legacyHttpResult?.suggestion
          || openHardwareMonitorStatus?.suggestion
          || 'Windows 传感器增强未返回可信 CPU 温度，请重试增强组件或检查管理员授权/安全软件拦截',
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

function hasGpuIdentity(controller) {
  return Boolean(
    (typeof controller?.model === 'string' && controller.model.trim())
    || (typeof controller?.name === 'string' && controller.name.trim())
    || (typeof controller?.vendor === 'string' && controller.vendor.trim())
  )
}

function isLikelyGpuController(controller, isMacOS = typeof process !== 'undefined' && process.platform === 'darwin') {
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

function normalizeGpuControllerIdentity(controller) {
  return {
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
    driverVersion: controller.driverVersion || '',
    pciBus: controller.pciBus || '',
  }
}

function deriveGpuIdleResidency(idleResidencyGpu, utilizationGpu) {
  const normalizedIdle = typeof idleResidencyGpu === 'number' && Number.isFinite(idleResidencyGpu)
    ? Math.max(0, Math.min(100, idleResidencyGpu))
    : null

  if (normalizedIdle !== null) {
    return normalizedIdle
  }

  const normalizedUtilization = typeof utilizationGpu === 'number' && Number.isFinite(utilizationGpu)
    ? Math.max(0, Math.min(100, utilizationGpu))
    : null

  if (normalizedUtilization === null) {
    return null
  }

  return Math.round((100 - normalizedUtilization) * 10) / 10
}

async function readStaticGpuInfo() {
  return readSystemInfo('graphicsStatic', [], async () => {
    const graphics = await si.graphics()
    const isMacOS = typeof process !== 'undefined' && process.platform === 'darwin'

    return graphics.controllers
      .filter((controller) => isLikelyGpuController(controller, isMacOS))
      .map((controller) => ({
        ...normalizeGpuControllerIdentity(controller),
        utilizationGpu: null,
        idleResidencyGpu: null,
        utilizationMemory: null,
        temperatureGpu: null,
        gpuCoreTemperatures: [],
        temperatureMemory: null,
        powerDraw: null,
        powerLimit: null,
        clockCore: null,
        clockMemory: null,
        fanSpeed: null,
        helper: false,
        telemetrySource: undefined,
        temperatureSource: undefined,
        nativeTemperatureErrorCode: undefined,
        nativeTemperatureReason: undefined,
        nativeTemperatureMessage: undefined,
        nativeTemperatureSuggestion: undefined,
      }))
  })
}

async function readGpuInfo() {
  return readSystemInfo('graphics', [], async () => {
    const graphics = await si.graphics()
    const isMacOS = typeof process !== 'undefined' && process.platform === 'darwin'
    const helperGpuTelemetry = isMacOS ? await readMacPowermetricsHelperGpuTelemetry() : undefined
    const nativeMacGpuTemperature = isMacOS ? readMacGpuTemperature({ pluginRoot: configuredPluginRoot }) : undefined
    const smcMacGpuTemperature = isMacOS ? readMacSmcGpuTemperature({ pluginRoot: configuredPluginRoot }) : undefined
    const macGpuTemperature = isMacOS
      ? pickPreferredMacGpuTemperature(nativeMacGpuTemperature, smcMacGpuTemperature)
      : undefined
    const macGpuTemperatureFallback = isMacOS
      ? buildMacGpuTemperatureFallbackDiagnostics(nativeMacGpuTemperature, macGpuTemperature)
      : undefined
    const fallbackTelemetry = isMacOS ? undefined : await getHardwareMonitorGpuTelemetry()

    return graphics.controllers
      .filter((controller) => isLikelyGpuController(controller, isMacOS))
      .map((controller) => {
        const utilizationGpu = isMacOS
          ? helperGpuTelemetry?.utilizationGpu ?? controller.utilizationGpu ?? null
          : controller.utilizationGpu ?? fallbackTelemetry?.utilizationGpu ?? null
        const idleResidencyGpu = deriveGpuIdleResidency(
          isMacOS
            ? helperGpuTelemetry?.idleResidencyGpu ?? controller.idleResidencyGpu ?? null
            : controller.idleResidencyGpu ?? null,
          utilizationGpu
        )
        const helperHasTelemetry = Boolean(
          helperGpuTelemetry
          && (
            typeof helperGpuTelemetry.utilizationGpu === 'number'
            || typeof helperGpuTelemetry.idleResidencyGpu === 'number'
            || typeof helperGpuTelemetry.clockCore === 'number'
            || typeof helperGpuTelemetry.powerDraw === 'number'
          )
        )
        const systemInformationHasTemperature = isMacOS && typeof controller.temperatureGpu === 'number'
        const nativeHasTemperature = Boolean(
          macGpuTemperature
          && (
            typeof macGpuTemperature.temperatureGpu === 'number'
            || (Array.isArray(macGpuTemperature.gpuCoreTemperatures) && macGpuTemperature.gpuCoreTemperatures.length > 0)
          )
        )

        return {
          ...normalizeGpuControllerIdentity(controller),
          utilizationGpu,
          idleResidencyGpu,
          utilizationMemory: controller.utilizationMemory ?? null,
          temperatureGpu: isMacOS
            ? controller.temperatureGpu ?? macGpuTemperature?.temperatureGpu ?? null
            : controller.temperatureGpu ?? fallbackTelemetry?.temperatureGpu ?? null,
          gpuCoreTemperatures: isMacOS
            ? macGpuTemperature?.gpuCoreTemperatures ?? []
            : [],
          temperatureMemory: controller.temperatureMemory ?? null,
          powerDraw: isMacOS
            ? helperGpuTelemetry?.powerDraw ?? controller.powerDraw ?? null
            : controller.powerDraw ?? fallbackTelemetry?.powerDraw ?? null,
          powerLimit: controller.powerLimit ?? null,
          clockCore: isMacOS
            ? helperGpuTelemetry?.clockCore ?? controller.clockCore ?? null
            : controller.clockCore ?? null,
          clockMemory: controller.clockMemory ?? null,
          fanSpeed: controller.fanSpeed ?? null,
          helper: isMacOS ? helperHasTelemetry : false,
          telemetrySource: isMacOS
            ? helperHasTelemetry
              ? 'powermetrics'
              : (
                  typeof controller.utilizationGpu === 'number'
                  || typeof controller.idleResidencyGpu === 'number'
                  || typeof controller.clockCore === 'number'
                  || typeof controller.powerDraw === 'number'
                )
                ? 'systeminformation'
                : undefined
            : fallbackTelemetry && (
                typeof fallbackTelemetry.utilizationGpu === 'number'
                || typeof fallbackTelemetry.powerDraw === 'number'
              ) && (
                controller.utilizationGpu == null
                || controller.powerDraw == null
              )
              ? 'OpenHardwareMonitor'
              : (
                  typeof controller.utilizationGpu === 'number'
                  || typeof controller.clockCore === 'number'
                  || typeof controller.powerDraw === 'number'
                )
                ? 'systeminformation'
                : undefined,
          temperatureSource: isMacOS
            ? systemInformationHasTemperature
              ? 'systeminformation'
              : nativeHasTemperature
                ? macGpuTemperature?.source === 'apple-smc'
                  ? 'apple-smc'
                  : 'macos-temperature-sensor'
                : undefined
            : fallbackTelemetry && typeof fallbackTelemetry.temperatureGpu === 'number' && controller.temperatureGpu == null
              ? 'OpenHardwareMonitor'
              : typeof controller.temperatureGpu === 'number'
                ? 'systeminformation'
                : undefined,
          nativeTemperatureErrorCode: isMacOS ? macGpuTemperatureFallback?.nativeTemperatureErrorCode : undefined,
          nativeTemperatureReason: isMacOS ? macGpuTemperatureFallback?.nativeTemperatureReason : undefined,
          nativeTemperatureMessage: isMacOS ? macGpuTemperatureFallback?.nativeTemperatureMessage : undefined,
          nativeTemperatureSuggestion: isMacOS ? macGpuTemperatureFallback?.nativeTemperatureSuggestion : undefined,
        }
      })
  })
}

async function getGpuInfo() {
  return readCachedServiceValue('gpuInfo', 5000, readGpuInfo)
}

async function getCurrentLoadSnapshot() {
  return readCachedServiceValue(
    'currentLoadSnapshot',
    2000,
    () => readSystemInfo('currentLoadSnapshot', emptyCurrentLoadData, () => si.currentLoad())
  )
}

function normalizeRateValue(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

async function getStorageIo() {
  return readCachedServiceValue('storageIo', 1500, async () => {
    const [fsStatsResult, disksIoResult] = await Promise.allSettled([
      si.fsStats(),
      si.disksIO(),
    ])

    const fsStats = fsStatsResult.status === 'fulfilled' ? fsStatsResult.value : undefined
    const disksIo = disksIoResult.status === 'fulfilled' ? disksIoResult.value : undefined

    return {
      readBytesPerSec: normalizeRateValue(fsStats?.rx_sec),
      writeBytesPerSec: normalizeRateValue(fsStats?.wx_sec),
      totalBytesPerSec: normalizeRateValue(fsStats?.tx_sec),
      readIops: normalizeRateValue(disksIo?.rIO_sec),
      writeIops: normalizeRateValue(disksIo?.wIO_sec),
      totalIops: normalizeRateValue(disksIo?.tIO_sec),
      waitPercent: normalizeRateValue(disksIo?.tWaitPercent),
    }
  })
}

function parseMacDiskutilTopology(stdout) {
  const text = typeof stdout === 'string' ? stdout : ''
  const virtualMatch = text.match(/^\s*Virtual:\s*(Yes|No)\s*$/im)
  const physicalStoreMatch = text.match(/^\s*APFS Physical Store:\s*(\S+)\s*$/im)

  return {
    virtual: virtualMatch ? virtualMatch[1].toLowerCase() === 'yes' : null,
    physicalStore: physicalStoreMatch?.[1] || '',
  }
}

async function readMacDiskTopology(device) {
  if (!isMacOS() || typeof device !== 'string' || !/^disk\d+$/i.test(device.trim())) {
    return { virtual: null, physicalStore: '' }
  }

  try {
    const { stdout } = await execFileAsync('/usr/sbin/diskutil', ['info', device.trim()], {
      timeout: 5000,
      maxBuffer: 512 * 1024,
    })
    return parseMacDiskutilTopology(stdout)
  } catch {
    return { virtual: null, physicalStore: '' }
  }
}

async function normalizeDiskLayoutForPlatform(disks) {
  if (!Array.isArray(disks) || !isMacOS()) return Array.isArray(disks) ? disks : []

  const topologyRows = await Promise.all(disks.map(async (disk) => ({
    disk,
    topology: await readMacDiskTopology(disk?.device),
  })))

  return topologyRows
    .filter(({ topology }) => topology.virtual !== true)
    .map(({ disk }) => disk)
}

async function readMacEthernetHardwareProfiles() {
  if (!isMacOS()) return []

  try {
    const { stdout } = await execFileAsync('/usr/sbin/system_profiler', ['SPEthernetDataType', '-json'], {
      timeout: 8000,
      maxBuffer: 5 * 1024 * 1024,
    })
    const parsed = JSON.parse(stdout || '{}')
    const entries = Array.isArray(parsed?.SPEthernetDataType) ? parsed.SPEthernetDataType : []

    return entries
      .map((item) => ({
        iface: typeof item?.spethernet_BSD_Device_Name === 'string' ? item.spethernet_BSD_Device_Name.trim() : '',
        name: typeof item?._name === 'string' ? item._name.trim() : '',
        mac: typeof item?.spethernet_mac_address === 'string' ? item.spethernet_mac_address.trim() : '',
      }))
      .filter((item) => item.iface)
  } catch {
    return []
  }
}

function inferNetworkAdapterVendor(model, explicitVendor = '') {
  if (typeof explicitVendor === 'string' && explicitVendor.trim()) return explicitVendor.trim()
  if (typeof model !== 'string') return ''

  const normalized = model.trim()
  if (!normalized) return ''
  const knownVendor = ['Broadcom', 'Intel', 'Realtek', 'Qualcomm', 'MediaTek', 'Marvell', 'Aquantia']
    .find((vendor) => normalized.toLowerCase().startsWith(vendor.toLowerCase()))
  return knownVendor || ''
}

async function getNetworkAdapters() {
  return readCachedServiceValue('networkAdapters', 30000, async () => {
    const [interfacesResult, wifiResult, macEthernetResult] = await Promise.allSettled([
      si.networkInterfaces(),
      si.wifiInterfaces(),
      readMacEthernetHardwareProfiles(),
    ])

    const interfaces = interfacesResult.status === 'fulfilled' && Array.isArray(interfacesResult.value)
      ? interfacesResult.value
      : []
    const wifiInterfaces = wifiResult.status === 'fulfilled' && Array.isArray(wifiResult.value)
      ? wifiResult.value
      : []
    const macEthernetProfiles = macEthernetResult.status === 'fulfilled' && Array.isArray(macEthernetResult.value)
      ? macEthernetResult.value
      : []

    return interfaces
      .filter((item) => item && !item.internal && typeof item.iface === 'string' && item.iface.trim())
      .map((item) => {
        const wifi = wifiInterfaces.find((candidate) => candidate?.iface === item.iface)
        const macEthernet = macEthernetProfiles.find((candidate) => candidate?.iface === item.iface)
        const model = macEthernet?.name || wifi?.model || item.ifaceName || item.iface
        const vendor = inferNetworkAdapterVendor(model, wifi?.vendor)

        return {
          iface: item.iface,
          name: item.ifaceName || item.iface,
          vendor,
          model,
          type: item.type || (wifi ? 'wireless' : ''),
          mac: item.mac || wifi?.mac || macEthernet?.mac || '',
          ip4: item.ip4 || '',
          speed: typeof item.speed === 'number' && Number.isFinite(item.speed) ? item.speed : null,
          default: Boolean(item.default),
          operstate: item.operstate || '',
        }
      })
  })
}

async function getNetworkStatus() {
  return readCachedServiceValue('networkStatus', 3000, async () => {
    const defaultInterface = await readSystemInfo('networkInterfaceDefault', '', () => si.networkInterfaceDefault())
    const [gatewayResult, statsResult] = await Promise.allSettled([
      si.networkGatewayDefault(),
      defaultInterface ? si.networkStats(defaultInterface) : Promise.resolve([]),
    ])

    const gateway = gatewayResult.status === 'fulfilled' ? gatewayResult.value || '' : ''
    const stats = statsResult.status === 'fulfilled' ? statsResult.value?.[0] : undefined
    let latencyMs = null

    if (gateway) {
      const latency = await readSystemInfo('inetLatency', null, () => si.inetLatency(gateway))
      latencyMs = normalizeRateValue(latency)
    }

    return {
      defaultInterface,
      gateway,
      latencyMs,
      operstate: stats?.operstate || '',
      rxSec: normalizeRateValue(stats?.rx_sec),
      txSec: normalizeRateValue(stats?.tx_sec),
    }
  })
}

async function getTopProcesses() {
  return readCachedServiceValue('topProcesses', 6000, async () => {
    const processes = await readSystemInfo('processes', { list: [] }, () => si.processes())
    const candidates = (Array.isArray(processes?.list) ? processes.list : [])
      .filter((item) => item && item.pid > 0 && typeof item.name === 'string' && item.name.trim())

    const byCpu = [...candidates]
      .sort((left, right) => {
        const cpuDelta = (right.cpu || 0) - (left.cpu || 0)
        if (Math.abs(cpuDelta) > 0.01) return cpuDelta
        return (right.memRss || 0) - (left.memRss || 0)
      })
      .slice(0, 3)

    const byMemory = [...candidates]
      .sort((left, right) => {
        const memoryDelta = (right.memRss || 0) - (left.memRss || 0)
        if (memoryDelta !== 0) return memoryDelta
        return (right.cpu || 0) - (left.cpu || 0)
      })
      .slice(0, 3)

    const merged = new Map()
    for (const item of [...byCpu, ...byMemory]) {
      if (!merged.has(item.pid)) merged.set(item.pid, item)
    }

    return [...merged.values()]
      .slice(0, 6)
      .map((item) => ({
        pid: item.pid,
        name: item.name.trim(),
        cpu: Number.isFinite(item.cpu) ? item.cpu : 0,
        mem: Number.isFinite(item.mem) ? item.mem : 0,
        memRss: Number.isFinite(item.memRss) ? item.memRss : 0,
        user: typeof item.user === 'string' ? item.user : '',
      }))
  })
}

export const systemService = {
  getHardwareSensorSettings: async () => getHardwareSensorSettings(),

  updateHardwareSensorSettings: async (patch) => updateHardwareSensorSettings(patch),

  getMonitoringRefreshSettings: async () => getMonitoringRefreshSettings(),

  updateMonitoringRefreshSettings: async (patch) => updateMonitoringRefreshSettings(patch),

  getFloatingMonitorSettings: async () => getFloatingMonitorSettings(),

  updateFloatingMonitorSettings: async (patch) => updateFloatingMonitorSettings(patch),

  getAppThemeSettings: async () => getAppThemeSettings(),

  updateAppThemeSettings: async (patch) => updateAppThemeSettings(patch),

  getWindowsSensorEnhancementStatus: getOpenHardwareMonitorStatus,

  getWindowsSensorEnhancementDiagnostics,

  startWindowsSensorEnhancement: startOpenHardwareMonitorManually,

  openWindowsSensorComponentDirectory: openOpenHardwareMonitorDirectory,

  // Backward-compatible aliases for existing windows/preload consumers.
  getOpenHardwareMonitorStatus,

  startOpenHardwareMonitor: startOpenHardwareMonitorManually,

  openOpenHardwareMonitorDirectory,

  getMacPowermetricsHelperStatus,

  installMacPowermetricsHelper,

  uninstallMacPowermetricsHelper,

  getCpuInfo: () =>
    readCachedServiceValue(
      'cpuInfo',
      30000,
      () => readSystemInfo('cpu', undefined, () => si.cpu())
    ),

  getCpuFullLoad: () =>
    readCachedServiceValue(
      'cpuFullLoad',
      2000,
      async () => {
        const current = await getCurrentLoadSnapshot()
        return Math.round(current.currentLoad || 0)
      }
    ),

  getCpuTemperature: () =>
    readCachedServiceValue(
      'cpuTemperature',
      5000,
      () => readSystemInfo(
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
      )
    ),

  getCpuPower: () =>
    readCachedServiceValue(
      'cpuPower',
      8000,
      () => readSystemInfo('cpuPower', undefined, getHardwareMonitorCpuPower)
    ),

  getCpuCurrentSpeed: () =>
    readCachedServiceValue(
      'cpuCurrentSpeed',
      2000,
      async () => {
        const fallback = { min: 0, max: 0, avg: 0, cores: [] }

        if (isMacOS()) {
          const helperCpuSpeed = await readMacPowermetricsHelperCpuSpeed()
          if (hasCpuSpeedValue(helperCpuSpeed)) {
            return helperCpuSpeed
          }

          const macCpuSpeed = readMacPowermetricsCpuSpeed()
          if (hasCpuSpeedValue(macCpuSpeed)) {
            return macCpuSpeed
          }

          const nativeFailure = helperCpuSpeed?.errorCode === 'MACOS_POWERMETRICS_HELPER_UNAVAILABLE'
            ? macCpuSpeed
            : helperCpuSpeed || macCpuSpeed
          const systemInfoSpeed = await readSystemInfo('cpuCurrentSpeed', fallback, () => si.cpuCurrentSpeed())
          return {
            ...systemInfoSpeed,
            source: 'systeminformation',
            sensorName: 'systeminformation.cpuCurrentSpeed',
            nativeSource: 'powermetrics',
            nativeErrorCode: nativeFailure?.errorCode,
            nativeReason: nativeFailure?.reason,
            nativeMessage: nativeFailure?.message,
            nativeSuggestion: nativeFailure?.suggestion,
          }
        }

        const sensorSettings = getHardwareSensorSettings()
        const cpuInfo = isWindows()
          ? await readCachedServiceValue(
            'cpuInfo',
            30000,
            () => readSystemInfo('cpu', undefined, () => si.cpu())
          )
          : undefined

        let cpuClockDiagnostics

        if (isWindows() && sensorSettings.enhancedSensorEnabled) {
          const hardwareMonitorSpeed = await readSystemInfo(
            'cpuClockSensors',
            undefined,
            () => getHardwareMonitorCpuCurrentSpeed(cpuInfo)
          )
          cpuClockDiagnostics = Array.isArray(hardwareMonitorSpeed?.allCpuClockSensors)
            && hardwareMonitorSpeed.allCpuClockSensors.length
            ? hardwareMonitorSpeed.allCpuClockSensors
            : undefined
          if (hasValidCpuClockCoreValues(hardwareMonitorSpeed?.cores) || hardwareMonitorSpeed?.avg) {
            return hardwareMonitorSpeed
          }
        }

        const systemInfoSpeed = await readSystemInfo('cpuCurrentSpeed', fallback, () => si.cpuCurrentSpeed())
        return attachCpuCurrentSpeedDiagnostics({
          ...systemInfoSpeed,
          source: 'systeminformation',
          sensorName: 'systeminformation.cpuCurrentSpeed',
          allCpuClockSensors: cpuClockDiagnostics,
        }, {
          cpuSpeedMaxGhz: typeof cpuInfo?.speedMax === 'number' && Number.isFinite(cpuInfo.speedMax) ? cpuInfo.speedMax : undefined,
        })
      }
    ),

  getCpuLoadData: () =>
    readCachedServiceValue(
      'cpuLoadData',
      2000,
      async () => {
        const current = await getCurrentLoadSnapshot()
        return current || emptyCurrentLoadData
      }
    ),

  getCpuVoltage: () =>
    readCachedServiceValue(
      'cpuVoltage',
      8000,
      () => readSystemInfo('cpuVoltage', { value: null, source: 'unsupported', unit: 'V', max: null }, getHardwareMonitorCpuVoltage)
    ),

  getCpuFanSpeed: () => readSystemInfo('cpuFanSpeed', { value: null, source: 'unsupported', unit: 'RPM', max: null }, getHardwareMonitorCpuFanSpeed),

  getMemInfo: () => readCachedServiceValue(
    'memInfo',
    3000,
    () => readSystemInfo(
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
    )
  ),

  getStaticMemInfo: () =>
    readCachedServiceValue(
      'staticMemInfo',
      30000,
      () => readSystemInfo('mem', normalizeMemoryInfo({}), async () => normalizeMemoryInfo(await si.mem()))
    ),

  getMemoryLayout: () =>
    readCachedServiceValue(
      'memoryLayout',
      30000,
      () => readSystemInfo('memLayout', [], () => si.memLayout())
    ),

  getGpuInfo,

  getStaticGpuInfo: () =>
    readCachedServiceValue(
      'staticGpuInfo',
      30000,
      readStaticGpuInfo
    ),

  getNetworkStatus,

  getNetworkAdapters,

  getNetworkInterfaces: () => readSystemInfo('networkInterfaces', [], () => si.networkInterfaces()),

  getTopProcesses,

  getDiskData: () =>
    readCachedServiceValue(
      'diskData',
      6000,
      () => readSystemInfo('fsSize', [], async () => {
        const disks = await si.fsSize()
        return disks.map(normalizeDiskUsage)
      })
    ),

  getStorageIo,

  getDiskLayout: () =>
    readCachedServiceValue(
      'diskLayout',
      30000,
      () => readSystemInfo('diskLayout', [], async () => normalizeDiskLayoutForPlatform(await si.diskLayout()))
    ),

  getBiosData: () =>
    readCachedServiceValue(
      'biosData',
      30000,
      () => readSystemInfo('bios', undefined, () => si.bios())
    ),

  getSystemData: () =>
    readCachedServiceValue(
      'systemData',
      30000,
      () => readSystemInfo('system', undefined, () => si.system())
    ),

  getDisplaysData: () =>
    readCachedServiceValue(
      'displaysData',
      30000,
      () => readSystemInfo('displays', [], async () => {
        const graphics = await si.graphics()
        return graphics.displays || []
      })
    ),

  getBoardData: () =>
    readCachedServiceValue(
      'boardData',
      30000,
      () => readSystemInfo('baseboard', undefined, () => si.baseboard())
    ),

  getAudioDevices: () => readSystemInfo('audio', [], () => si.audio()),

  getOsInfo: () =>
    readCachedServiceValue(
      'osInfo',
      30000,
      () => readSystemInfo('osInfo', undefined, () => si.osInfo())
    ),

  getTimeInfo: () =>
    readCachedServiceValue(
      'timeInfo',
      5000,
      () => readSystemInfo('time', undefined, () => si.time())
    ),
}
