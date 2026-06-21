const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')
const nodeUtil = require('node:util')

function loadWindowsSystemServiceWithClockSensors(
  clockSensors,
  cpuInfo = { speedMax: 5.4 },
  systemCpuCurrentSpeed = { min: 0, max: 0, avg: 0, cores: [] }
) {
  const filePath = path.join(__dirname, '..', 'utools/services/system.js')
  const source = fs.readFileSync(filePath, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      allowJs: true,
    },
    fileName: filePath,
  }).outputText

  const stdout = JSON.stringify(clockSensors)
  const execFile = function execFile(_cmd, _args, _options, callback) {
    callback(null, stdout, '')
  }

  const fakeUtil = {
    ...nodeUtil,
    promisify(fn) {
      if (fn === execFile) {
        return async () => ({ stdout, stderr: '' })
      }
      return nodeUtil.promisify(fn)
    },
  }

  const fakeRequire = (id) => {
    if (id === 'systeminformation') {
      return {
        default: {
          cpu: async () => cpuInfo,
          cpuCurrentSpeed: async () => systemCpuCurrentSpeed,
        },
      }
    }

    if (id === 'node:child_process') {
      return { execFile }
    }

    if (id === 'node:util') {
      return fakeUtil
    }

    if (id === './macSensors.cjs') {
      return {
        default: {
          buildMacGpuTemperatureFallbackDiagnostics: () => [],
          pickPreferredMacGpuTemperature: () => undefined,
          readMacCpuTemperature: () => undefined,
          readMacGpuTemperature: () => undefined,
          readMacPowermetricsHelperCpuPower: async () => undefined,
          readMacPowermetricsHelperCpuSpeed: async () => undefined,
          readMacPowermetricsHelperGpuTelemetry: async () => undefined,
          readMacPowermetricsCpuSpeed: () => undefined,
          readMacSmcCpuTemperature: () => undefined,
          readMacSmcGpuTemperature: () => undefined,
          readMacSmcFanSpeed: () => undefined,
        },
      }
    }

    return require(id)
  }

  const module = { exports: {} }
  const wrapped = new Function('require', 'module', 'exports', '__filename', '__dirname', compiled)
  wrapped(fakeRequire, module, module.exports, filePath, path.dirname(filePath))
  return module.exports.systemService
}

test('filters isolated OHM core clock outliers and keeps numeric core order on Windows', async () => {
  const sensors = [
    { Name: 'CPU Core #10', Identifier: '/amdcpu/0/clock/10', Value: 4420, Parent: 'CPU Package', SensorType: 'Clock' },
    { Name: 'CPU Core #1', Identifier: '/amdcpu/0/clock/1', Value: 4510, Parent: 'CPU Package', SensorType: 'Clock' },
    { Name: 'CPU Core #11', Identifier: '/amdcpu/0/clock/11', Value: 7000, Parent: 'CPU Package', SensorType: 'Clock' },
    { Name: 'CPU Core #12', Identifier: '/amdcpu/0/clock/12', Value: 4440, Parent: 'CPU Package', SensorType: 'Clock' },
    { Name: 'CPU Core #2', Identifier: '/amdcpu/0/clock/2', Value: 4490, Parent: 'CPU Package', SensorType: 'Clock' },
    { Name: 'CPU Core #3', Identifier: '/amdcpu/0/clock/3', Value: 4470, Parent: 'CPU Package', SensorType: 'Clock' },
    { Name: 'CPU Core #4', Identifier: '/amdcpu/0/clock/4', Value: 4460, Parent: 'CPU Package', SensorType: 'Clock' },
    { Name: 'CPU Core #5', Identifier: '/amdcpu/0/clock/5', Value: 4450, Parent: 'CPU Package', SensorType: 'Clock' },
    { Name: 'CPU Core #6', Identifier: '/amdcpu/0/clock/6', Value: 4480, Parent: 'CPU Package', SensorType: 'Clock' },
    { Name: 'CPU Core #7', Identifier: '/amdcpu/0/clock/7', Value: 4475, Parent: 'CPU Package', SensorType: 'Clock' },
    { Name: 'CPU Core #8', Identifier: '/amdcpu/0/clock/8', Value: 4465, Parent: 'CPU Package', SensorType: 'Clock' },
    { Name: 'CPU Core #9', Identifier: '/amdcpu/0/clock/9', Value: 4455, Parent: 'CPU Package', SensorType: 'Clock' },
  ]

  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: 'win32' })

  try {
    const systemService = loadWindowsSystemServiceWithClockSensors(sensors)
    const result = await systemService.getCpuCurrentSpeed()

    assert.equal(result.source, 'OpenHardwareMonitor')
    assert.equal(result.cores.length, 12)
    assert.equal(result.cores[0], 4.51)
    assert.equal(result.cores[1], 4.49)
    assert.equal(result.cores[10], null, `expected C11 outlier to be removed from per-core display, got ${result.cores[10]}`)
    assert.equal(result.cores[11], 4.44)
    assert.ok(result.max < 6, `expected max frequency to ignore the outlier, got ${result.max}`)
    assert.ok(Array.isArray(result.allCpuClockSensors), 'expected raw OHM clock sensor diagnostics to be preserved')
    const filteredSensor = result.allCpuClockSensors.find((sensor) => sensor.coreIndex === 11)
    assert.equal(filteredSensor?.accepted, false)
    assert.equal(filteredSensor?.filterReason, 'OUTLIER_HIGH')
    assert.equal(filteredSensor?.value, 7)
  } finally {
    Object.defineProperty(process, 'platform', descriptor)
  }
})

test('treats 6.50 GHz numbered core spikes as outliers when the rest of the cluster is far lower', async () => {
  const sensors = [
    { Name: 'CPU Core #1', Identifier: '/amdcpu/0/clock/1', Value: 4510, Parent: 'CPU Package', SensorType: 'Clock' },
    { Name: 'CPU Core #2', Identifier: '/amdcpu/0/clock/2', Value: 4490, Parent: 'CPU Package', SensorType: 'Clock' },
    { Name: 'CPU Core #3', Identifier: '/amdcpu/0/clock/3', Value: 4470, Parent: 'CPU Package', SensorType: 'Clock' },
    { Name: 'CPU Core #4', Identifier: '/amdcpu/0/clock/4', Value: 4460, Parent: 'CPU Package', SensorType: 'Clock' },
    { Name: 'CPU Core #5', Identifier: '/amdcpu/0/clock/5', Value: 4450, Parent: 'CPU Package', SensorType: 'Clock' },
    { Name: 'CPU Core #6', Identifier: '/amdcpu/0/clock/6', Value: 4480, Parent: 'CPU Package', SensorType: 'Clock' },
    { Name: 'CPU Core #7', Identifier: '/amdcpu/0/clock/7', Value: 4475, Parent: 'CPU Package', SensorType: 'Clock' },
    { Name: 'CPU Core #8', Identifier: '/amdcpu/0/clock/8', Value: 4465, Parent: 'CPU Package', SensorType: 'Clock' },
    { Name: 'CPU Core #9', Identifier: '/amdcpu/0/clock/9', Value: 4455, Parent: 'CPU Package', SensorType: 'Clock' },
    { Name: 'CPU Core #10', Identifier: '/amdcpu/0/clock/10', Value: 4420, Parent: 'CPU Package', SensorType: 'Clock' },
    { Name: 'CPU Core #11', Identifier: '/amdcpu/0/clock/11', Value: 6500, Parent: 'CPU Package', SensorType: 'Clock' },
    { Name: 'CPU Core #12', Identifier: '/amdcpu/0/clock/12', Value: 4440, Parent: 'CPU Package', SensorType: 'Clock' },
  ]

  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: 'win32' })

  try {
    const systemService = loadWindowsSystemServiceWithClockSensors(sensors, {
      speedMax: 5.7,
      physicalCores: 12,
      cores: 24,
    })
    const result = await systemService.getCpuCurrentSpeed()

    assert.equal(result.cores.length, 12)
    assert.equal(result.cores[10], null, `expected 6.50 GHz spike to be rejected, got ${result.cores[10]}`)
    assert.ok(result.max < 6, `expected max frequency to ignore 6.50 GHz spike, got ${result.max}`)
    const filteredSensor = result.allCpuClockSensors.find((sensor) => sensor.coreIndex === 11)
    assert.equal(filteredSensor?.accepted, false)
    assert.equal(filteredSensor?.filterReason, 'OUTLIER_HIGH')
    assert.equal(filteredSensor?.value, 6.5)
  } finally {
    Object.defineProperty(process, 'platform', descriptor)
  }
})

test('ignores OHM core clocks beyond the expected Windows physical core count', async () => {
  const sensors = Array.from({ length: 32 }, (_, index) => ({
    Name: `CPU Core #${index + 1}`,
    Identifier: `/amdcpu/0/clock/${index + 1}`,
    Value: index === 16 ? 6500 : 4400 + ((index % 6) * 20),
    Parent: 'CPU Package',
    SensorType: 'Clock',
  }))

  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: 'win32' })

  try {
    const systemService = loadWindowsSystemServiceWithClockSensors(sensors, {
      speedMax: 5.7,
      physicalCores: 16,
      cores: 32,
    })
    const result = await systemService.getCpuCurrentSpeed()

    assert.equal(result.cores.length, 16)
    assert.ok(result.max < 6, `expected max frequency to ignore hidden extra cores, got ${result.max}`)
    const extraSensor = result.allCpuClockSensors.find((sensor) => sensor.coreIndex === 17)
    assert.equal(extraSensor?.accepted, false)
    assert.equal(extraSensor?.filterReason, 'BEYOND_EXPECTED_CORE_COUNT')
    assert.equal(extraSensor?.value, 6.5)
  } finally {
    Object.defineProperty(process, 'platform', descriptor)
  }
})

test('preserves raw OHM clock diagnostics when Windows frequency display falls back to systeminformation', async () => {
  const sensors = [
    { Name: 'CPU Core #17', Identifier: '/amdcpu/0/clock/17', Value: 6500, Parent: 'CPU Package', SensorType: 'Clock' },
    { Name: 'CPU Core #18', Identifier: '/amdcpu/0/clock/18', Value: 4440, Parent: 'CPU Package', SensorType: 'Clock' },
  ]

  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: 'win32' })

  try {
    const systemService = loadWindowsSystemServiceWithClockSensors(
      sensors,
      {
        speedMax: 5.7,
        physicalCores: 16,
        cores: 32,
      },
      {
        min: 4.05,
        max: 4.4,
        avg: 4.22,
        cores: Array.from({ length: 16 }, () => null),
      }
    )
    const result = await systemService.getCpuCurrentSpeed()

    assert.equal(result.source, 'systeminformation')
    assert.equal(result.avg, 4.22)
    assert.ok(Array.isArray(result.allCpuClockSensors), 'expected OHM raw diagnostics to survive systeminformation fallback')
    assert.equal(result.frequencyDiagnostics?.displayValueGHz, 4.22)
    assert.equal(result.frequencyDiagnostics?.displayChosenFrom, 'avg_fallback')
    assert.equal(result.frequencyDiagnostics?.anomalyDetected, true)
    assert.ok(result.frequencyDiagnostics?.anomalyReasons.includes('IGNORED_OHM_SENSORS_PRESENT'))
    assert.ok(result.frequencyDiagnostics?.anomalyReasons.includes('AVG_FALLBACK_WITH_IGNORED_OHM_SENSORS'))
    assert.equal(result.frequencyDiagnostics?.ignoredSensorCount, 2)
    assert.equal(result.frequencyDiagnostics?.maxIgnoredCoreGHz, 6.5)
    assert.equal(result.frequencyDiagnostics?.cpuSpeedMaxGHz, 5.7)
    assert.equal(result.allCpuClockSensors.length, 2)
    assert.equal(result.allCpuClockSensors[0]?.accepted, false)
    assert.equal(result.allCpuClockSensors[0]?.filterReason, 'BEYOND_EXPECTED_CORE_COUNT')
    assert.equal(result.allCpuClockSensors[0]?.value, 6.5)
  } finally {
    Object.defineProperty(process, 'platform', descriptor)
  }
})

test('records impossible systeminformation fallback frequencies above cpu speed max even without OHM clock sensors', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: 'win32' })

  try {
    const systemService = loadWindowsSystemServiceWithClockSensors(
      [],
      {
        speedMax: 5.4,
        physicalCores: 16,
        cores: 32,
      },
      {
        min: 6.8,
        max: 7.1,
        avg: 7,
        cores: [],
      }
    )
    const result = await systemService.getCpuCurrentSpeed()

    assert.equal(result.source, 'systeminformation')
    assert.equal(result.frequencyDiagnostics?.displayValueGHz, 7)
    assert.equal(result.frequencyDiagnostics?.displayChosenFrom, 'avg_fallback')
    assert.equal(result.frequencyDiagnostics?.anomalyDetected, true)
    assert.ok(result.frequencyDiagnostics?.anomalyReasons.includes('DISPLAY_EXCEEDS_CPU_SPEEDMAX'))
    assert.equal(result.frequencyDiagnostics?.ignoredSensorCount, 0)
    assert.equal(result.frequencyDiagnostics?.cpuSpeedMaxGHz, 5.4)
  } finally {
    Object.defineProperty(process, 'platform', descriptor)
  }
})

test('ignores OHM effective clock sensors when deriving displayed Windows core frequencies', async () => {
  const sensors = [
    { Name: 'Core #1', Identifier: '/amdcpu/0/clock/3', Value: 3420, Parent: 'CPU Package', SensorType: 'Clock' },
    { Name: 'Core #1 (Effective)', Identifier: '/amdcpu/0/clock/4', Value: 7000, Parent: 'CPU Package', SensorType: 'Clock' },
    { Name: 'Core #2', Identifier: '/amdcpu/0/clock/5', Value: 3670, Parent: 'CPU Package', SensorType: 'Clock' },
    { Name: 'Core #2 (Effective)', Identifier: '/amdcpu/0/clock/6', Value: 470, Parent: 'CPU Package', SensorType: 'Clock' },
    { Name: 'Core #3', Identifier: '/amdcpu/0/clock/7', Value: 3640, Parent: 'CPU Package', SensorType: 'Clock' },
    { Name: 'Core #3 (Effective)', Identifier: '/amdcpu/0/clock/8', Value: 80, Parent: 'CPU Package', SensorType: 'Clock' },
    { Name: 'Core #4', Identifier: '/amdcpu/0/clock/9', Value: 3670, Parent: 'CPU Package', SensorType: 'Clock' },
    { Name: 'Core #4 (Effective)', Identifier: '/amdcpu/0/clock/10', Value: 5500, Parent: 'CPU Package', SensorType: 'Clock' },
    { Name: 'Cores (Average)', Identifier: '/amdcpu/0/clock/1', Value: 3490, Parent: 'CPU Package', SensorType: 'Clock' },
    { Name: 'Cores (Average Effective)', Identifier: '/amdcpu/0/clock/2', Value: 100, Parent: 'CPU Package', SensorType: 'Clock' },
  ]

  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: 'win32' })

  try {
    const systemService = loadWindowsSystemServiceWithClockSensors(sensors, {
      speedMax: 2.4,
      physicalCores: 4,
      cores: 8,
    })
    const result = await systemService.getCpuCurrentSpeed()

    assert.equal(result.source, 'OpenHardwareMonitor')
    assert.deepEqual(result.cores, [3.42, 3.67, 3.64, 3.67])
    assert.equal(result.max, 3.67)
    assert.equal(result.frequencyDiagnostics?.displayValueGHz, 3.67)
    assert.equal(result.frequencyDiagnostics?.displayChosenFrom, 'max_core')
    assert.equal(result.frequencyDiagnostics?.anomalyDetected, false)
    assert.equal(result.frequencyDiagnostics?.ignoredSensorCount, 5)
    const effectiveSensor = result.allCpuClockSensors.find((sensor) => sensor.identifier === '/amdcpu/0/clock/4')
    assert.equal(effectiveSensor?.accepted, false)
    assert.equal(effectiveSensor?.filterReason, 'EFFECTIVE_CLOCK_IGNORED')
    const averageEffectiveSensor = result.allCpuClockSensors.find((sensor) => sensor.identifier === '/amdcpu/0/clock/2')
    assert.equal(averageEffectiveSensor?.accepted, false)
    assert.equal(averageEffectiveSensor?.filterReason, 'EFFECTIVE_CLOCK_IGNORED')
  } finally {
    Object.defineProperty(process, 'platform', descriptor)
  }
})
