const fs = require('node:fs')
const { createRequire } = require('node:module')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const MAC_POWERMETRICS_HELPER_SOCKET = '/var/run/hwinfox-powermetrics-helper.sock'
const runtimeRequire = typeof createRequire === 'function' ? createRequire(__filename) : require

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

function safePathSegment(value) {
  return String(value || 'default')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 64)
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

function toFiniteNumber(value) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

function isPlausibleTemperature(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 130
}

function roundTemperature(value) {
  return Math.round(value * 10) / 10
}

function roundFrequency(value) {
  return Math.round(value * 100) / 100
}

function roundPower(value) {
  return Math.round(value * 10) / 10
}

function roundGpuPower(value) {
  if (value < 1) return Math.round(value * 1000) / 1000
  return roundPower(value)
}

function roundPercent(value) {
  return Math.round(value * 10) / 10
}

function roundClockMHz(value) {
  return Math.round(value)
}

function normalizeTemperatureList(values) {
  if (!Array.isArray(values)) return []

  return values
    .map(toFiniteNumber)
    .filter(isPlausibleTemperature)
    .map(roundTemperature)
}

function buildGpuCoreTemperatureList(values, sourceName) {
  return normalizeTemperatureList(values).map((value, index) => ({
    name: `GPU Core ${index + 1}`,
    identifier: `gpu-die-${index + 1}`,
    value,
    hardwareName: sourceName,
  }))
}

function normalizeMacTemperatureReading(reading) {
  const cpuDieTemps = normalizeTemperatureList(reading?.cpuDieTemps)
  const cpuValue = toFiniteNumber(reading?.cpu)
  const cpu = isPlausibleTemperature(cpuValue)
    ? roundTemperature(cpuValue)
    : cpuDieTemps.length
      ? Math.max(...cpuDieTemps)
      : null

  if (cpu === null) return null

  const socValue = toFiniteNumber(reading?.soc)
  const chipset = isPlausibleTemperature(socValue) ? roundTemperature(socValue) : undefined
  const max = cpuDieTemps.length ? Math.max(...cpuDieTemps) : cpu

  return {
    main: cpu,
    max,
    cores: cpuDieTemps,
    chipset,
    value: cpu,
    source: 'macos-temperature-sensor',
    sensorName: 'Apple Silicon CPU Die Max',
    confidence: isPlausibleTemperature(cpuValue) ? 'high' : 'medium',
    unit: '°C',
  }
}

function normalizeMacGpuTemperatureReading(reading) {
  const gpuDieTemps = normalizeTemperatureList(reading?.gpuDieTemps)
  const gpuValue = toFiniteNumber(reading?.gpu)
  const gpu = isPlausibleTemperature(gpuValue)
    ? roundTemperature(gpuValue)
    : gpuDieTemps.length
      ? Math.max(...gpuDieTemps)
      : null

  if (gpu === null) return null

  return {
    temperatureGpu: gpu,
    source: 'macos-temperature-sensor',
    sensorName: 'Apple Silicon GPU Die Max',
    confidence: isPlausibleTemperature(gpuValue) ? 'high' : 'medium',
    unit: '°C',
    gpuCoreTemperatures: buildGpuCoreTemperatureList(gpuDieTemps, 'macos-temperature-sensor'),
  }
}

function hasMacGpuTemperature(reading) {
  return Boolean(
    reading
    && (
      typeof reading.temperatureGpu === 'number'
      || (Array.isArray(reading.gpuCoreTemperatures) && reading.gpuCoreTemperatures.length > 0)
    )
  )
}

function pickPreferredMacGpuTemperature(nativeReading, smcReading) {
  if (hasMacGpuTemperature(nativeReading)) return nativeReading
  if (hasMacGpuTemperature(smcReading)) return smcReading
  return nativeReading || smcReading || undefined
}

function buildMacGpuTemperatureFallbackDiagnostics(nativeReading, selectedReading) {
  const usingAppleSmcFallback = selectedReading?.source === 'apple-smc'
  const nativeFailed = nativeReading && !hasMacGpuTemperature(nativeReading)

  if (!usingAppleSmcFallback || !nativeFailed) return undefined

  return {
    nativeTemperatureErrorCode: nativeReading.errorCode,
    nativeTemperatureReason: nativeReading.reason || nativeReading.errorCode,
    nativeTemperatureMessage: nativeReading.message,
    nativeTemperatureSuggestion: nativeReading.suggestion,
  }
}

function resolveBundledMacosTemperatureSensorPackagePath(pluginRoot) {
  if (typeof pluginRoot === 'string' && pluginRoot.trim()) {
    return path.resolve(pluginRoot, 'vendor/macos/node_modules/macos-temperature-sensor')
  }

  return path.resolve(__dirname, '../../vendor/macos/node_modules/macos-temperature-sensor')
}

function resolveBundledMacosTemperatureSensorEntryPath(pluginRoot) {
  return path.join(resolveBundledMacosTemperatureSensorPackagePath(pluginRoot), 'lib/index.js')
}

function getMacosTemperatureSensorBundleVersion(packageRoot) {
  const packageText = readTextIfExists(path.join(packageRoot, 'package.json'))

  if (!packageText) return 'default'

  try {
    const parsed = JSON.parse(packageText)
    return safePathSegment(parsed?.version)
  } catch {
    return 'default'
  }
}

function ensurePhysicalMacosTemperatureSensorPackage(options = {}) {
  const packagePath = options.packagePath || resolveBundledMacosTemperatureSensorPackagePath(options.pluginRoot)
  const entryPath = options.entryPath || path.join(packagePath, 'lib/index.js')
  const existsSyncFn = options.existsSyncFn || fs.existsSync

  const baseResult = {
    packagePath,
    entryPath,
    runtimePackagePath: packagePath,
    runtimeEntryPath: entryPath,
    exists: existsSyncFn(entryPath),
    insideAsar: isAsarPath(entryPath),
  }

  if (!baseResult.exists) {
    return {
      ...baseResult,
      reason: 'MACOS_TEMPERATURE_SENSOR_BUNDLE_MISSING',
    }
  }

  if (!baseResult.insideAsar) {
    return baseResult
  }

  const version = getMacosTemperatureSensorBundleVersion(packagePath)
  const runtimePackagePath = path.join(os.tmpdir(), 'system-info-plugin', 'vendor', `macos-temperature-sensor-${version}`)
  const runtimeEntryPath = path.join(runtimePackagePath, 'lib/index.js')

  try {
    if (!existsSyncFn(runtimeEntryPath)) {
      copyDirectoryRecursive(packagePath, runtimePackagePath)
    }
  } catch (error) {
    return {
      ...baseResult,
      runtimePackagePath,
      runtimeEntryPath,
      exists: false,
      reason: 'MACOS_TEMPERATURE_SENSOR_RUNTIME_COPY_FAILED',
      suggestion: error instanceof Error ? error.message : 'macos-temperature-sensor 从 asar 解包失败。',
    }
  }

  return {
    ...baseResult,
    runtimePackagePath,
    runtimeEntryPath,
    exists: existsSyncFn(runtimeEntryPath),
    reason: existsSyncFn(runtimeEntryPath) ? undefined : 'MACOS_TEMPERATURE_SENSOR_RUNTIME_COPY_FAILED',
    suggestion: existsSyncFn(runtimeEntryPath) ? undefined : 'macos-temperature-sensor 从 asar 解包失败。',
  }
}

function loadMacosTemperatureSensor(options = {}) {
  if (typeof options === 'function') {
    return options('macos-temperature-sensor')
  }

  const requireFn = typeof options.requireFn === 'function' ? options.requireFn : undefined
  if (requireFn) {
    return requireFn('macos-temperature-sensor')
  }

  const runtimeRequireFn = typeof options.runtimeRequireFn === 'function' ? options.runtimeRequireFn : runtimeRequire
  const explicitModulePath = typeof options.modulePath === 'string' && options.modulePath.trim()
    ? path.resolve(options.modulePath)
    : ''

  if (explicitModulePath) {
    return runtimeRequireFn(explicitModulePath)
  }

  const bundled = ensurePhysicalMacosTemperatureSensorPackage(options)
  if (bundled.exists && bundled.runtimeEntryPath) {
    return runtimeRequireFn(bundled.runtimeEntryPath)
  }

  return runtimeRequireFn('macos-temperature-sensor')
}

function buildUnsupportedMacTemperature(errorCode, message, options = {}) {
  return {
    main: null,
    max: null,
    cores: [],
    value: null,
    source: options.source || 'macos-temperature-sensor',
    sensorName: options.sensorName || 'Apple Silicon native temperature probe',
    confidence: 'unsupported',
    unit: '°C',
    errorCode,
    reason: errorCode,
    message,
    suggestion: options.suggestion,
  }
}

function normalizeMacSmcReading(reading) {
  const temperatures = Array.isArray(reading?.temperatures) ? reading.temperatures : []
  const cpuSensors = temperatures
    .map((sensor) => ({
      key: typeof sensor?.key === 'string' ? sensor.key : '',
      name: typeof sensor?.name === 'string' ? sensor.name : '',
      role: typeof sensor?.role === 'string' ? sensor.role : '',
      value: toFiniteNumber(sensor?.value),
    }))
    .filter((sensor) => sensor.role === 'cpu' && isPlausibleTemperature(sensor.value))
    .map((sensor) => ({
      ...sensor,
      value: roundTemperature(sensor.value),
    }))

  if (!cpuSensors.length) return null

  const hottest = [...cpuSensors].sort((left, right) => right.value - left.value)[0]
  const primary = [...cpuSensors].sort((left, right) => scoreMacSmcCpuTemperatureSensor(right) - scoreMacSmcCpuTemperatureSensor(left))[0] || hottest

  return {
    main: primary.value,
    max: hottest.value,
    cores: cpuSensors.map((sensor) => sensor.value),
    value: primary.value,
    source: 'apple-smc',
    sensorName: primary.name || primary.key || 'AppleSMC CPU temperature',
    confidence: 'high',
    unit: '°C',
    allCpuTemperatureSensors: cpuSensors.map((sensor) => ({
      name: sensor.name || sensor.key,
      identifier: sensor.key,
      value: sensor.value,
      hardwareName: 'AppleSMC',
    })),
  }
}

function normalizeMacSmcGpuReading(reading) {
  const temperatures = Array.isArray(reading?.temperatures) ? reading.temperatures : []
  const gpuSensors = temperatures
    .map((sensor) => ({
      key: typeof sensor?.key === 'string' ? sensor.key : '',
      name: typeof sensor?.name === 'string' ? sensor.name : '',
      role: typeof sensor?.role === 'string' ? sensor.role : '',
      value: toFiniteNumber(sensor?.value),
    }))
    .filter((sensor) => sensor.role === 'gpu' && isPlausibleTemperature(sensor.value))
    .map((sensor) => ({
      ...sensor,
      value: roundTemperature(sensor.value),
    }))

  if (!gpuSensors.length) return null

  const primary = [...gpuSensors].sort((left, right) => right.value - left.value)[0]

  return {
    temperatureGpu: primary.value,
    source: 'apple-smc',
    sensorName: primary.name || primary.key || 'AppleSMC GPU temperature',
    confidence: 'high',
    unit: '°C',
    gpuCoreTemperatures: gpuSensors.map((sensor) => ({
      name: sensor.name || sensor.key || 'GPU sensor',
      identifier: sensor.key || undefined,
      value: sensor.value,
      hardwareName: 'AppleSMC',
    })),
  }
}

function scoreMacSmcCpuTemperatureSensor(sensor) {
  const key = String(sensor?.key || '')
  const name = String(sensor?.name || '').toLowerCase()

  if (/^TCM/i.test(key)) return 300
  if (/^TC[0-9A-Z]/i.test(key)) return 260
  if (name.includes('cpu') && (name.includes('proximity') || name.includes('control') || name.includes('average'))) return 230
  if (/^TPC/i.test(key) || /^TCC/i.test(key)) return 210
  if (/^TPD/i.test(key)) return 180
  if (/^TPS/i.test(key)) return 170
  if (/^Tp/i.test(key)) return 140
  if (/^Te/i.test(key)) return 130
  return 100
}

function normalizeMacSmcFanReading(reading) {
  const fans = Array.isArray(reading?.fans) ? reading.fans : []
  const validFans = fans
    .map((fan) => ({
      id: Number.isInteger(Number(fan?.id)) ? Number(fan.id) : null,
      key: typeof fan?.key === 'string' ? fan.key : '',
      name: typeof fan?.name === 'string' ? fan.name : '',
      rpm: toFiniteNumber(fan?.rpm),
    }))
    .filter((fan) => typeof fan.rpm === 'number' && fan.rpm > 0 && fan.rpm < 12000)
    .map((fan) => ({
      ...fan,
      rpm: Math.round(fan.rpm),
    }))

  if (!validFans.length) return null

  const primaryFan = validFans[0]
  const max = Math.max(...validFans.map((fan) => fan.rpm))

  return {
    value: primaryFan.rpm,
    source: 'apple-smc',
    sensorName: primaryFan.name || primaryFan.key || 'AppleSMC fan',
    unit: 'RPM',
    max,
  }
}

function normalizeMacPowermetricsCpuSpeed(output) {
  if (typeof output !== 'string' || !output.trim()) return null

  const speedValues = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      return /frequency/i.test(line)
        && (
          /\b[PE][-\s]?Cluster\b/i.test(line)
          || /\bCPU\b/i.test(line)
        )
    })
    .map((line) => {
      const match = line.match(/(\d+(?:\.\d+)?)\s*(MHz|Mhz|GHz|Ghz)\b/)
      if (!match) return null

      const rawValue = Number(match[1])
      if (!Number.isFinite(rawValue) || rawValue <= 0) return null

      const ghzValue = /^g/i.test(match[2]) ? rawValue : rawValue / 1000
      if (!Number.isFinite(ghzValue) || ghzValue <= 0 || ghzValue > 10) return null

      return roundFrequency(ghzValue)
    })
    .filter((value) => typeof value === 'number')

  if (!speedValues.length) return null

  const min = Math.min(...speedValues)
  const max = Math.max(...speedValues)
  const avg = speedValues.reduce((sum, value) => sum + value, 0) / speedValues.length

  return {
    min: roundFrequency(min),
    max: roundFrequency(max),
    avg: roundFrequency(avg),
    cores: speedValues,
    source: 'powermetrics',
    sensorName: 'macOS powermetrics CPU frequency',
  }
}

function normalizeMacPowermetricsHelperReading(reading) {
  if (!reading || reading.ok !== true) return null
  const cores = Array.isArray(reading.cores)
    ? reading.cores
        .map(toFiniteNumber)
        .filter((value) => typeof value === 'number' && value > 0 && value < 10)
        .map(roundFrequency)
    : []

  const avg = toFiniteNumber(reading.avg)
  const min = toFiniteNumber(reading.min)
  const max = toFiniteNumber(reading.max)
  if (!cores.length && !(typeof avg === 'number' && avg > 0)) return null

  const values = cores.length ? cores : [roundFrequency(avg)]

  return {
    min: typeof min === 'number' && min > 0 ? roundFrequency(min) : Math.min(...values),
    max: typeof max === 'number' && max > 0 ? roundFrequency(max) : Math.max(...values),
    avg: typeof avg === 'number' && avg > 0
      ? roundFrequency(avg)
      : roundFrequency(values.reduce((sum, value) => sum + value, 0) / values.length),
    cores: values,
    source: 'powermetrics',
    sensorName: typeof reading.sensorName === 'string' && reading.sensorName
      ? reading.sensorName
      : 'HWInfoX powermetrics helper',
    privileged: true,
    helper: true,
  }
}

function normalizeMacPowermetricsHelperPowerReading(reading) {
  if (!reading || reading.ok !== true) return null
  const value = toFiniteNumber(reading.value)
  if (typeof value !== 'number' || value <= 0 || value > 500) return null

  const sensors = Array.isArray(reading.sensors)
    ? reading.sensors
        .map((sensor) => {
          const sensorValue = toFiniteNumber(sensor?.value)
          if (typeof sensorValue !== 'number' || sensorValue <= 0 || sensorValue > 500) return null
          return {
            name: typeof sensor?.name === 'string' && sensor.name ? sensor.name : 'CPU Power',
            value: roundPower(sensorValue),
          }
        })
        .filter(Boolean)
    : []

  return {
    value: roundPower(value),
    source: 'powermetrics',
    sensorName: typeof reading.sensorName === 'string' && reading.sensorName
      ? reading.sensorName
      : 'CPU Power',
    sensors,
    privileged: true,
    helper: true,
  }
}

function buildUnsupportedMacGpuTelemetry(errorCode, message, options = {}) {
  return {
    utilizationGpu: null,
    idleResidencyGpu: null,
    clockCore: null,
    powerDraw: null,
    source: 'powermetrics',
    sensorName: options.sensorName || 'HWInfoX powermetrics helper GPU telemetry',
    errorCode,
    reason: errorCode,
    message,
    privileged: options.privileged,
    helper: options.helper,
    suggestion: options.suggestion,
  }
}

function normalizeMacPowermetricsHelperGpuTelemetry(reading) {
  if (!reading || reading.ok !== true) return null

  const utilizationGpu = toFiniteNumber(reading.utilizationGpu)
  const idleResidencyGpu = toFiniteNumber(reading.idleResidencyGpu)
  const clockCore = toFiniteNumber(reading.clockCore)
  const powerDraw = toFiniteNumber(reading.powerDraw)

  const hasUtilization = typeof utilizationGpu === 'number' && utilizationGpu >= 0 && utilizationGpu <= 100
  const hasIdleResidency = typeof idleResidencyGpu === 'number' && idleResidencyGpu >= 0 && idleResidencyGpu <= 100
  const hasClock = typeof clockCore === 'number' && clockCore > 0 && clockCore < 10000
  const hasPower = typeof powerDraw === 'number' && powerDraw > 0 && powerDraw < 500

  if (!hasUtilization && !hasIdleResidency && !hasClock && !hasPower) return null

  return {
    utilizationGpu: hasUtilization ? roundPercent(utilizationGpu) : null,
    idleResidencyGpu: hasIdleResidency ? roundPercent(idleResidencyGpu) : null,
    clockCore: hasClock ? roundClockMHz(clockCore) : null,
    powerDraw: hasPower ? roundGpuPower(powerDraw) : null,
    source: 'powermetrics',
    sensorName: typeof reading.sensorName === 'string' && reading.sensorName
      ? reading.sensorName
      : 'HWInfoX powermetrics helper GPU telemetry',
    privileged: true,
    helper: true,
  }
}

function requestMacPowermetricsHelper(options = {}, command = 'cpu_frequency') {
  const socketPath = options.socketPath || MAC_POWERMETRICS_HELPER_SOCKET
  const timeout = options.timeout || 1500

  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath)
    let settled = false
    let output = ''

    function finish(error, value) {
      if (settled) return
      settled = true
      socket.destroy()
      if (error) reject(error)
      else resolve(value)
    }

    socket.setEncoding('utf8')
    socket.setTimeout(timeout, () => {
      finish(new Error('HWInfoX powermetrics helper timeout'))
    })
    socket.on('connect', () => {
      socket.write(`${command}\n`)
    })
    socket.on('data', (chunk) => {
      output += chunk
    })
    socket.on('end', () => {
      try {
        finish(null, JSON.parse(output))
      } catch (error) {
        finish(error)
      }
    })
    socket.on('error', (error) => {
      finish(error)
    })
  })
}

async function readMacPowermetricsHelperCpuSpeed(options = {}) {
  const platform = options.platform || process.platform
  if (platform !== 'darwin') return undefined

  const requestFn = options.requestFn || requestMacPowermetricsHelper

  try {
    const reading = await requestFn(options)
    const speed = normalizeMacPowermetricsHelperReading(reading)
    if (speed) return speed

    return buildUnsupportedMacCpuSpeed(
      reading?.errorCode || 'MACOS_POWERMETRICS_HELPER_EMPTY',
      reading?.message || 'HWInfoX powermetrics helper 未返回可信 CPU 频率',
      {
        privileged: true,
        helper: true,
        suggestion: '请检查 HWInfoX helper 是否正在运行，或重新安装 helper。',
      }
    )
  } catch (error) {
    return buildUnsupportedMacCpuSpeed(
      'MACOS_POWERMETRICS_HELPER_UNAVAILABLE',
      error instanceof Error ? error.message : 'HWInfoX powermetrics helper 不可用',
      {
        privileged: true,
        helper: true,
        suggestion: '请先安装或启动 HWInfoX powermetrics helper。',
      }
    )
  }
}

async function readMacPowermetricsHelperCpuPower(options = {}) {
  const platform = options.platform || process.platform
  if (platform !== 'darwin') return undefined

  const requestFn = options.requestFn || requestMacPowermetricsHelper

  try {
    const reading = await requestFn(options, 'cpu_power')
    const power = normalizeMacPowermetricsHelperPowerReading(reading)
    if (power) return power

    return {
      value: null,
      source: 'powermetrics',
      sensorName: 'CPU Power',
      sensors: [],
      errorCode: reading?.errorCode || 'MACOS_POWERMETRICS_HELPER_POWER_EMPTY',
      reason: reading?.reason || reading?.errorCode || 'MACOS_POWERMETRICS_HELPER_POWER_EMPTY',
      message: reading?.message || 'HWInfoX powermetrics helper 未返回可信 CPU 功耗',
      privileged: true,
      helper: true,
      suggestion: '请检查 HWInfoX helper 是否正在运行，或重新安装 helper。',
    }
  } catch (error) {
    return {
      value: null,
      source: 'powermetrics',
      sensorName: 'CPU Power',
      sensors: [],
      errorCode: 'MACOS_POWERMETRICS_HELPER_UNAVAILABLE',
      reason: 'MACOS_POWERMETRICS_HELPER_UNAVAILABLE',
      message: error instanceof Error ? error.message : 'HWInfoX powermetrics helper 不可用',
      privileged: true,
      helper: true,
      suggestion: '请先安装或启动 HWInfoX powermetrics helper。',
    }
  }
}

async function readMacPowermetricsHelperGpuTelemetry(options = {}) {
  const platform = options.platform || process.platform
  if (platform !== 'darwin') return undefined

  const requestFn = options.requestFn || requestMacPowermetricsHelper

  try {
    const reading = await requestFn(options, 'gpu_telemetry')
    const telemetry = normalizeMacPowermetricsHelperGpuTelemetry(reading)
    if (telemetry) return telemetry

    return buildUnsupportedMacGpuTelemetry(
      reading?.errorCode || 'MACOS_POWERMETRICS_HELPER_GPU_EMPTY',
      reading?.message || 'HWInfoX powermetrics helper 未返回可信 GPU 遥测',
      {
        privileged: true,
        helper: true,
        suggestion: '请检查 HWInfoX helper 是否正在运行，或重新安装 helper。',
      }
    )
  } catch (error) {
    return buildUnsupportedMacGpuTelemetry(
      'MACOS_POWERMETRICS_HELPER_UNAVAILABLE',
      error instanceof Error ? error.message : 'HWInfoX powermetrics helper 不可用',
      {
        privileged: true,
        helper: true,
        suggestion: '请先安装或启动 HWInfoX powermetrics helper。',
      }
    )
  }
}

function buildUnsupportedMacCpuSpeed(errorCode, message, options = {}) {
  return {
    min: 0,
    max: 0,
    avg: 0,
    cores: [],
    source: 'powermetrics',
    sensorName: 'macOS powermetrics CPU frequency',
    errorCode,
    reason: errorCode,
    message,
    privileged: options.privileged,
    helper: options.helper,
    suggestion: options.suggestion,
  }
}

function readMacPowermetricsCpuSpeed(options = {}) {
  const platform = options.platform || process.platform
  if (platform !== 'darwin') return undefined

  const execFileSyncFn = options.execFileSyncFn || execFileSync
  const command = options.command || '/usr/bin/powermetrics'
  const args = options.args || ['--samplers', 'cpu_power', '-n', '1', '-i', '200']

  try {
    const stdout = execFileSyncFn(command, args, {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    })
    const speed = normalizeMacPowermetricsCpuSpeed(String(stdout))
    if (speed) {
      return speed
    }

    return buildUnsupportedMacCpuSpeed(
      'MACOS_POWERMETRICS_SPEED_EMPTY',
      'powermetrics 未返回可信 CPU 频率'
    )
  } catch (error) {
    const stderr = typeof error?.stderr === 'string' ? error.stderr : Buffer.isBuffer(error?.stderr) ? error.stderr.toString('utf8') : ''
    const stdout = typeof error?.stdout === 'string' ? error.stdout : Buffer.isBuffer(error?.stdout) ? error.stdout.toString('utf8') : ''
    const message = [stderr, stdout, error instanceof Error ? error.message : 'powermetrics 执行失败']
      .filter(Boolean)
      .join(' | ')
    const needsPermission = /superuser|Operation not permitted|permission/i.test(message)

    return buildUnsupportedMacCpuSpeed(
      needsPermission ? 'MACOS_POWERMETRICS_PERMISSION_REQUIRED' : 'MACOS_POWERMETRICS_SPEED_FAILED',
      message,
      {
        suggestion: needsPermission
          ? '读取 powermetrics CPU 频率需要安装 privileged helper。'
          : 'powermetrics CPU 频率读取失败，请检查当前 macOS 版本和采样器兼容性。',
      }
    )
  }
}

function resolveMacSmcBinaryPath(pluginRoot) {
  if (typeof pluginRoot === 'string' && pluginRoot.trim()) {
    return path.resolve(pluginRoot, 'vendor/macos/mac-smc-sensors')
  }

  return path.resolve(__dirname, '../../vendor/macos/mac-smc-sensors')
}

function readMacSmcCpuTemperature(options = {}) {
  const platform = options.platform || process.platform
  if (platform !== 'darwin') return undefined

  const binaryPath = options.binaryPath || resolveMacSmcBinaryPath(options.pluginRoot)
  const existsSyncFn = options.existsSyncFn || fs.existsSync
  if (!existsSyncFn(binaryPath)) return undefined

  const execFileSyncFn = options.execFileSyncFn || execFileSync

  try {
    const stdout = execFileSyncFn(binaryPath, ['--json'], {
      encoding: 'utf8',
      timeout: 1500,
      windowsHide: true,
    })
    const reading = JSON.parse(String(stdout))
    return normalizeMacSmcReading(reading) || buildUnsupportedMacTemperature(
      'MACOS_SMC_SENSOR_EMPTY',
      'AppleSMC CLI 未返回可信 CPU 温度',
      {
        source: 'apple-smc',
        sensorName: 'AppleSMC',
      }
    )
  } catch (error) {
    const stdout = typeof error?.stdout === 'string' ? error.stdout : Buffer.isBuffer(error?.stdout) ? error.stdout.toString('utf8') : ''
    if (stdout.trim()) {
      try {
        const reading = JSON.parse(stdout)
        const message = Array.isArray(reading?.errors) && reading.errors.length
          ? reading.errors.join(' | ')
          : 'AppleSMC CLI 执行失败'
        const needsPermission = /IOServiceOpen AppleSMC failed|0xe00002e2/i.test(message)
        return buildUnsupportedMacTemperature(
          needsPermission ? 'MACOS_SMC_PERMISSION_REQUIRED' : 'MACOS_SMC_SENSOR_FAILED',
          message,
          {
            source: 'apple-smc',
            sensorName: 'AppleSMC',
            suggestion: needsPermission
              ? '读取 AppleSMC 温度需要管理员权限或安装 privileged helper。'
              : 'AppleSMC 读取失败，请检查当前 macOS 版本和 SMC 探针兼容性。',
          }
        )
      } catch {
        // fall through to generic error handling
      }
    }

    return buildUnsupportedMacTemperature(
      'MACOS_SMC_SENSOR_FAILED',
      error instanceof Error ? error.message : 'AppleSMC CLI 执行失败',
      {
        source: 'apple-smc',
        sensorName: 'AppleSMC',
        suggestion: 'AppleSMC 读取失败，请检查权限和探针兼容性。',
      }
    )
  }
}

function readMacSmcGpuTemperature(options = {}) {
  const platform = options.platform || process.platform
  if (platform !== 'darwin') return undefined

  const binaryPath = options.binaryPath || resolveMacSmcBinaryPath(options.pluginRoot)
  const existsSyncFn = options.existsSyncFn || fs.existsSync
  if (!existsSyncFn(binaryPath)) return undefined

  const execFileSyncFn = options.execFileSyncFn || execFileSync

  try {
    const stdout = execFileSyncFn(binaryPath, ['--json'], {
      encoding: 'utf8',
      timeout: 1500,
      windowsHide: true,
    })
    const reading = JSON.parse(String(stdout))
    return normalizeMacSmcGpuReading(reading) || {
      temperatureGpu: null,
      gpuCoreTemperatures: [],
      source: 'apple-smc',
      sensorName: 'AppleSMC GPU temperature',
      errorCode: 'MACOS_SMC_GPU_EMPTY',
      reason: 'MACOS_SMC_GPU_EMPTY',
      message: 'AppleSMC CLI 未返回可信 GPU 温度',
      suggestion: '请检查当前 macOS 版本和 SMC 探针兼容性。',
    }
  } catch (error) {
    const stdout = typeof error?.stdout === 'string' ? error.stdout : Buffer.isBuffer(error?.stdout) ? error.stdout.toString('utf8') : ''
    if (stdout.trim()) {
      try {
        const reading = JSON.parse(stdout)
        const message = Array.isArray(reading?.errors) && reading.errors.length
          ? reading.errors.join(' | ')
          : 'AppleSMC CLI GPU 读取失败'
        const needsPermission = /IOServiceOpen AppleSMC failed|0xe00002e2/i.test(message)
        return {
          temperatureGpu: null,
          gpuCoreTemperatures: [],
          source: 'apple-smc',
          sensorName: 'AppleSMC GPU temperature',
          errorCode: needsPermission ? 'MACOS_SMC_PERMISSION_REQUIRED' : 'MACOS_SMC_GPU_FAILED',
          reason: needsPermission ? 'MACOS_SMC_PERMISSION_REQUIRED' : 'MACOS_SMC_GPU_FAILED',
          message,
          suggestion: needsPermission
            ? '读取 AppleSMC GPU 温度需要管理员权限或安装 privileged helper。'
            : 'AppleSMC GPU 读取失败，请检查当前 macOS 版本和 SMC 探针兼容性。',
        }
      } catch {
        // fall through
      }
    }

    return {
      temperatureGpu: null,
      gpuCoreTemperatures: [],
      source: 'apple-smc',
      sensorName: 'AppleSMC GPU temperature',
      errorCode: 'MACOS_SMC_GPU_FAILED',
      reason: 'MACOS_SMC_GPU_FAILED',
      message: error instanceof Error ? error.message : 'AppleSMC CLI GPU 读取失败',
      suggestion: 'AppleSMC GPU 读取失败，请检查权限和探针兼容性。',
    }
  }
}

function readMacSmcFanSpeed(options = {}) {
  const platform = options.platform || process.platform
  if (platform !== 'darwin') return undefined

  const binaryPath = options.binaryPath || resolveMacSmcBinaryPath(options.pluginRoot)
  const existsSyncFn = options.existsSyncFn || fs.existsSync
  if (!existsSyncFn(binaryPath)) return undefined

  const execFileSyncFn = options.execFileSyncFn || execFileSync

  try {
    const stdout = execFileSyncFn(binaryPath, ['--json'], {
      encoding: 'utf8',
      timeout: 1500,
      windowsHide: true,
    })
    const reading = JSON.parse(String(stdout))
    return normalizeMacSmcFanReading(reading) || {
      value: null,
      source: 'apple-smc',
      sensorName: 'AppleSMC fan',
      unit: 'RPM',
      max: null,
      errorCode: 'MACOS_SMC_FAN_EMPTY',
      reason: 'MACOS_SMC_FAN_EMPTY',
      message: 'AppleSMC CLI 未返回可信风扇转速',
    }
  } catch (error) {
    const stdout = typeof error?.stdout === 'string' ? error.stdout : Buffer.isBuffer(error?.stdout) ? error.stdout.toString('utf8') : ''
    if (stdout.trim()) {
      try {
        const reading = JSON.parse(stdout)
        const message = Array.isArray(reading?.errors) && reading.errors.length
          ? reading.errors.join(' | ')
          : 'AppleSMC CLI 风扇读取失败'
        const needsPermission = /IOServiceOpen AppleSMC failed|0xe00002e2/i.test(message)
        return {
          value: null,
          source: 'apple-smc',
          sensorName: 'AppleSMC fan',
          unit: 'RPM',
          max: null,
          errorCode: needsPermission ? 'MACOS_SMC_PERMISSION_REQUIRED' : 'MACOS_SMC_FAN_FAILED',
          reason: needsPermission ? 'MACOS_SMC_PERMISSION_REQUIRED' : 'MACOS_SMC_FAN_FAILED',
          message,
          suggestion: needsPermission
            ? '读取 AppleSMC 风扇转速需要管理员权限或安装 privileged helper。'
            : 'AppleSMC 风扇读取失败，请检查当前 macOS 版本和 SMC 探针兼容性。',
        }
      } catch {
        // fall through to generic error handling
      }
    }

    return {
      value: null,
      source: 'apple-smc',
      sensorName: 'AppleSMC fan',
      unit: 'RPM',
      max: null,
      errorCode: 'MACOS_SMC_FAN_FAILED',
      reason: 'MACOS_SMC_FAN_FAILED',
      message: error instanceof Error ? error.message : 'AppleSMC CLI 风扇读取失败',
      suggestion: 'AppleSMC 风扇读取失败，请检查权限和探针兼容性。',
    }
  }
}

function readMacCpuTemperature(options = {}) {
  const platform = options.platform || process.platform
  if (platform !== 'darwin') return undefined

  try {
    const macosTemperatureSensor = loadMacosTemperatureSensor(options)
    const reading = macosTemperatureSensor.temperature()
    return normalizeMacTemperatureReading(reading)
      || buildUnsupportedMacTemperature('MACOS_TEMPERATURE_SENSOR_EMPTY', 'macos-temperature-sensor 未返回可信 CPU 温度')
  } catch (error) {
    return buildUnsupportedMacTemperature(
      'MACOS_TEMPERATURE_SENSOR_FAILED',
      error instanceof Error ? error.message : 'macos-temperature-sensor 执行失败'
    )
  }
}

function readMacGpuTemperature(options = {}) {
  const platform = options.platform || process.platform
  if (platform !== 'darwin') return undefined

  try {
    const macosTemperatureSensor = loadMacosTemperatureSensor(options)
    const reading = macosTemperatureSensor.temperature()
    return normalizeMacGpuTemperatureReading(reading) || {
      temperatureGpu: null,
      gpuCoreTemperatures: [],
      source: 'macos-temperature-sensor',
      sensorName: 'Apple Silicon GPU temperature probe',
      errorCode: 'MACOS_TEMPERATURE_SENSOR_EMPTY',
      reason: 'MACOS_TEMPERATURE_SENSOR_EMPTY',
      message: 'macos-temperature-sensor 未返回可信 GPU 温度',
      suggestion: '请检查当前 macOS 版本和原生温度探针兼容性。',
    }
  } catch (error) {
    return {
      temperatureGpu: null,
      gpuCoreTemperatures: [],
      source: 'macos-temperature-sensor',
      sensorName: 'Apple Silicon GPU temperature probe',
      errorCode: 'MACOS_TEMPERATURE_SENSOR_FAILED',
      reason: 'MACOS_TEMPERATURE_SENSOR_FAILED',
      message: error instanceof Error ? error.message : 'macos-temperature-sensor 执行失败',
      suggestion: '请检查当前 macOS 版本和原生温度探针兼容性。',
    }
  }
}

module.exports = {
  normalizeMacGpuTemperatureReading,
  normalizeMacSmcGpuReading,
  normalizeMacTemperatureReading,
  normalizeMacSmcReading,
  normalizeMacSmcFanReading,
  normalizeMacPowermetricsCpuSpeed,
  normalizeMacPowermetricsHelperGpuTelemetry,
  normalizeMacPowermetricsHelperReading,
  normalizeMacPowermetricsHelperPowerReading,
  buildMacGpuTemperatureFallbackDiagnostics,
  loadMacosTemperatureSensor,
  pickPreferredMacGpuTemperature,
  readMacGpuTemperature,
  readMacCpuTemperature,
  readMacSmcGpuTemperature,
  readMacPowermetricsHelperGpuTelemetry,
  readMacPowermetricsHelperCpuSpeed,
  readMacPowermetricsHelperCpuPower,
  readMacPowermetricsCpuSpeed,
  readMacSmcCpuTemperature,
  readMacSmcFanSpeed,
  resolveBundledMacosTemperatureSensorEntryPath,
  resolveMacSmcBinaryPath,
}
