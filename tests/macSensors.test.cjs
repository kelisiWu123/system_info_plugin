const assert = require('node:assert/strict')
const test = require('node:test')

const {
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
  resolveMacSmcBinaryPath,
} = require('../utools/services/macSensors.cjs')

test('normalizes Apple Silicon CPU die temperatures into CpuTemperatureData shape', () => {
  const result = normalizeMacTemperatureReading({
    cpu: 51.236,
    soc: 45.555,
    gpu: 43.2,
    cpuDieTemps: [48.111, 51.236, 49.875],
    probeGroupsTemps: [44.2],
    gpuDieTemps: [43.2],
  })

  assert.equal(result.source, 'macos-temperature-sensor')
  assert.equal(result.value, 51.2)
  assert.equal(result.main, 51.2)
  assert.equal(result.max, 51.2)
  assert.deepEqual(result.cores, [48.1, 51.2, 49.9])
  assert.equal(result.chipset, 45.6)
  assert.equal(result.confidence, 'high')
  assert.equal(result.sensorName, 'Apple Silicon CPU Die Max')
})

test('uses CPU die max when aggregate CPU value is missing', () => {
  const result = normalizeMacTemperatureReading({
    cpu: null,
    soc: 40,
    gpu: null,
    cpuDieTemps: [45.4, 47.8],
    probeGroupsTemps: [],
    gpuDieTemps: [],
  })

  assert.equal(result.value, 47.8)
  assert.equal(result.main, 47.8)
  assert.equal(result.max, 47.8)
  assert.equal(result.confidence, 'medium')
})

test('returns null when reading has no plausible CPU temperature', () => {
  const result = normalizeMacTemperatureReading({
    cpu: 0,
    soc: 42,
    gpu: 38,
    cpuDieTemps: [200, -30],
    probeGroupsTemps: [],
    gpuDieTemps: [],
  })

  assert.equal(result, null)
})

test('normalizes Apple Silicon GPU temperatures into helper-ready telemetry', () => {
  const result = normalizeMacGpuTemperatureReading({
    gpu: 43.21,
    gpuDieTemps: [42.1, 43.21, 41.7],
  })

  assert.equal(result.source, 'macos-temperature-sensor')
  assert.equal(result.temperatureGpu, 43.2)
  assert.equal(result.sensorName, 'Apple Silicon GPU Die Max')
  assert.deepEqual(result.gpuCoreTemperatures, [
    { name: 'GPU Core 1', identifier: 'gpu-die-1', value: 42.1, hardwareName: 'macos-temperature-sensor' },
    { name: 'GPU Core 2', identifier: 'gpu-die-2', value: 43.2, hardwareName: 'macos-temperature-sensor' },
    { name: 'GPU Core 3', identifier: 'gpu-die-3', value: 41.7, hardwareName: 'macos-temperature-sensor' },
  ])
})

test('prefers native macOS GPU temperature probes over AppleSMC probe fan-out', () => {
  const nativeReading = {
    temperatureGpu: 44.1,
    gpuCoreTemperatures: [
      { name: 'GPU Core 1', identifier: 'gpu-die-1', value: 43.8, hardwareName: 'macos-temperature-sensor' },
      { name: 'GPU Core 2', identifier: 'gpu-die-2', value: 44.1, hardwareName: 'macos-temperature-sensor' },
    ],
    source: 'macos-temperature-sensor',
  }
  const smcReading = {
    temperatureGpu: 52.3,
    gpuCoreTemperatures: Array.from({ length: 18 }, (_, index) => ({
      name: `AppleSMC Tg${index.toString(16).toUpperCase()}C`,
      identifier: `Tg${index.toString(16).toUpperCase()}C`,
      value: 40 + index / 10,
      hardwareName: 'AppleSMC',
    })),
    source: 'apple-smc',
  }

  assert.equal(pickPreferredMacGpuTemperature(nativeReading, smcReading), nativeReading)
})

test('keeps native GPU temperature failure diagnostics when falling back to AppleSMC', () => {
  const nativeFailure = {
    temperatureGpu: null,
    gpuCoreTemperatures: [],
    source: 'macos-temperature-sensor',
    errorCode: 'MACOS_TEMPERATURE_SENSOR_FAILED',
    reason: 'MACOS_TEMPERATURE_SENSOR_FAILED',
    message: 'Failed to read temperature snapshot (IOHID).',
    suggestion: '请检查当前 macOS 版本和原生温度探针兼容性。',
  }
  const smcReading = {
    temperatureGpu: 52.3,
    gpuCoreTemperatures: [{ name: 'GPU hotspot', identifier: 'Tg0H', value: 52.3, hardwareName: 'AppleSMC' }],
    source: 'apple-smc',
  }

  assert.deepEqual(buildMacGpuTemperatureFallbackDiagnostics(nativeFailure, smcReading), {
    nativeTemperatureErrorCode: 'MACOS_TEMPERATURE_SENSOR_FAILED',
    nativeTemperatureReason: 'MACOS_TEMPERATURE_SENSOR_FAILED',
    nativeTemperatureMessage: 'Failed to read temperature snapshot (IOHID).',
    nativeTemperatureSuggestion: '请检查当前 macOS 版本和原生温度探针兼容性。',
  })
})

test('loads macos-temperature-sensor through injected runtime require', () => {
  const marker = { temperature: () => ({ gpu: 42.3, gpuDieTemps: [42.3] }) }

  assert.equal(
    loadMacosTemperatureSensor(() => marker),
    marker
  )
})

test('loads macos-temperature-sensor from provided bundled entry path', () => {
  const marker = { temperature: () => ({ cpu: 51.2, cpuDieTemps: [51.2] }) }
  const requests = []
  const bundledEntryPath = '/tmp/system-info-plugin/vendor/macos/node_modules/macos-temperature-sensor/lib/index.js'

  assert.equal(
    loadMacosTemperatureSensor({
      modulePath: bundledEntryPath,
      runtimeRequireFn: (request) => {
        requests.push(request)
        return marker
      },
    }),
    marker
  )

  assert.deepEqual(requests, [bundledEntryPath])
})

test('falls back to hottest GPU die when aggregate GPU temperature is missing', () => {
  const result = normalizeMacGpuTemperatureReading({
    gpu: null,
    gpuDieTemps: [47.2, 49.8],
  })

  assert.equal(result.temperatureGpu, 49.8)
})

test('reads native GPU temperature only on darwin', () => {
  const result = readMacGpuTemperature({
    platform: 'darwin',
    requireFn: () => ({
      temperature: () => ({
        gpu: 44.05,
        gpuDieTemps: [43.8, 44.05],
      }),
    }),
  })

  assert.equal(result.source, 'macos-temperature-sensor')
  assert.equal(result.temperatureGpu, 44.1)
})

test('does not load native macOS package outside darwin', () => {
  let required = false
  const result = readMacCpuTemperature({
    platform: 'win32',
    requireFn: () => {
      required = true
      return {}
    },
  })

  assert.equal(result, undefined)
  assert.equal(required, false)
})

test('reads native package only on darwin and normalizes the result', () => {
  const result = readMacCpuTemperature({
    platform: 'darwin',
    requireFn: (name) => {
      assert.equal(name, 'macos-temperature-sensor')
      return {
        temperature: () => ({
          cpu: 55.44,
          soc: 48.1,
          gpu: 41.2,
          cpuDieTemps: [53.9, 55.44],
          probeGroupsTemps: [],
          gpuDieTemps: [41.2],
        }),
      }
    },
  })

  assert.equal(result.value, 55.4)
  assert.equal(result.source, 'macos-temperature-sensor')
})

test('returns diagnostic result when native package fails on darwin', () => {
  const result = readMacCpuTemperature({
    platform: 'darwin',
    requireFn: () => ({
      temperature: () => {
        throw new Error('Failed to read temperature snapshot (IOHID).')
      },
    }),
  })

  assert.equal(result.value, null)
  assert.equal(result.source, 'macos-temperature-sensor')
  assert.equal(result.confidence, 'unsupported')
  assert.equal(result.errorCode, 'MACOS_TEMPERATURE_SENSOR_FAILED')
  assert.match(result.message, /IOHID/)
})

test('normalizes AppleSMC CLI temperature readings into CpuTemperatureData shape', () => {
  const result = normalizeMacSmcReading({
    source: 'apple-smc',
    temperatures: [
      { key: 'Ta0P', name: 'Ambient', value: 31.2, role: 'ambient' },
      { key: 'Tp09', name: 'CPU performance cluster', value: 58.42, role: 'cpu' },
      { key: 'Te05', name: 'CPU efficiency cluster', value: 52.01, role: 'cpu' },
      { key: 'Tg05', name: 'GPU cluster', value: 49.7, role: 'gpu' },
      { key: 'Tz11', name: 'Invalid zero', value: 0, role: 'cpu' },
    ],
    fans: [
      { id: 0, name: 'Left fan', rpm: 1800 },
    ],
  })

  assert.equal(result.source, 'apple-smc')
  assert.equal(result.value, 58.4)
  assert.equal(result.main, 58.4)
  assert.equal(result.max, 58.4)
  assert.deepEqual(result.cores, [58.4, 52])
  assert.equal(result.sensorName, 'CPU performance cluster')
  assert.equal(result.confidence, 'high')
})

test('normalizes AppleSMC lowercase performance and efficiency keys as CPU sensors', () => {
  const result = normalizeMacSmcReading({
    source: 'apple-smc',
    temperatures: [
      { key: 'Tp0c', name: 'AppleSMC Tp0c', value: 65.2, role: 'cpu' },
      { key: 'Te0A', name: 'AppleSMC Te0A', value: 58.2, role: 'cpu' },
      { key: 'Tg0H', name: 'AppleSMC Tg0H', value: 50.7, role: 'gpu' },
    ],
    fans: [],
  })

  assert.equal(result.value, 65.2)
  assert.deepEqual(result.cores, [65.2, 58.2])
  assert.equal(result.sensorName, 'AppleSMC Tp0c')
})

test('normalizes AppleSMC GPU temperature readings into GpuData-compatible telemetry', () => {
  const result = normalizeMacSmcGpuReading({
    source: 'apple-smc',
    temperatures: [
      { key: 'Tg05', name: 'GPU cluster', value: 49.7, role: 'gpu' },
      { key: 'Tg0H', name: 'GPU hotspot', value: 53.24, role: 'gpu' },
    ],
  })

  assert.equal(result.temperatureGpu, 53.2)
  assert.equal(result.source, 'apple-smc')
  assert.equal(result.sensorName, 'GPU hotspot')
  assert.deepEqual(result.gpuCoreTemperatures, [
    { name: 'GPU cluster', identifier: 'Tg05', value: 49.7, hardwareName: 'AppleSMC' },
    { name: 'GPU hotspot', identifier: 'Tg0H', value: 53.2, hardwareName: 'AppleSMC' },
  ])
})

test('prefers aggregate AppleSMC CPU temperature over transient hottest local sensor', () => {
  const result = normalizeMacSmcReading({
    source: 'apple-smc',
    temperatures: [
      { key: 'TCMz', name: 'AppleSMC TCMz', value: 63.4, role: 'cpu' },
      { key: 'Tp0c', name: 'AppleSMC Tp0c local hotspot', value: 91.2, role: 'cpu' },
      { key: 'Te0A', name: 'AppleSMC Te0A efficiency', value: 58.2, role: 'cpu' },
    ],
    fans: [],
  })

  assert.equal(result.value, 63.4)
  assert.equal(result.main, 63.4)
  assert.equal(result.max, 91.2)
  assert.equal(result.sensorName, 'AppleSMC TCMz')
  assert.deepEqual(result.cores, [63.4, 91.2, 58.2])
})

test('reads AppleSMC CLI only on darwin and parses JSON output', () => {
  const result = readMacSmcCpuTemperature({
    platform: 'darwin',
    binaryPath: '/tmp/mac-smc-sensors',
    existsSyncFn: () => true,
    execFileSyncFn: (file, args) => {
      assert.equal(file, '/tmp/mac-smc-sensors')
      assert.deepEqual(args, ['--json'])
      return JSON.stringify({
        source: 'apple-smc',
        temperatures: [
          { key: 'Tp09', name: 'CPU P-core', value: 61.9, role: 'cpu' },
        ],
        fans: [],
      })
    },
  })

  assert.equal(result.value, 61.9)
  assert.equal(result.source, 'apple-smc')
})

test('reads AppleSMC GPU temperature only on darwin and parses JSON output', () => {
  const result = readMacSmcGpuTemperature({
    platform: 'darwin',
    binaryPath: '/tmp/mac-smc-sensors',
    existsSyncFn: () => true,
    execFileSyncFn: (file, args) => {
      assert.equal(file, '/tmp/mac-smc-sensors')
      assert.deepEqual(args, ['--json'])
      return JSON.stringify({
        source: 'apple-smc',
        temperatures: [
          { key: 'Tg05', name: 'GPU cluster', value: 47.9, role: 'gpu' },
        ],
        fans: [],
      })
    },
  })

  assert.equal(result.temperatureGpu, 47.9)
  assert.equal(result.source, 'apple-smc')
})

test('resolves AppleSMC CLI path from plugin root when provided', () => {
  const result = resolveMacSmcBinaryPath('/Applications/HWInfoX/dist')

  assert.equal(result, '/Applications/HWInfoX/dist/vendor/macos/mac-smc-sensors')
})

test('does not execute AppleSMC CLI outside darwin', () => {
  let executed = false
  const result = readMacSmcCpuTemperature({
    platform: 'win32',
    binaryPath: '/tmp/mac-smc-sensors',
    existsSyncFn: () => true,
    execFileSyncFn: () => {
      executed = true
      return '{}'
    },
  })

  assert.equal(result, undefined)
  assert.equal(executed, false)
})

test('parses AppleSMC CLI permission errors from stdout when process exits non-zero', () => {
  const error = new Error('Command failed')
  error.stdout = JSON.stringify({
    source: 'apple-smc',
    enumerated: false,
    temperatures: [],
    fans: [],
    errors: ['IOServiceOpen AppleSMC failed for user client types 0-8; last error: 0xe00002e2'],
  })

  const result = readMacSmcCpuTemperature({
    platform: 'darwin',
    binaryPath: '/tmp/mac-smc-sensors',
    existsSyncFn: () => true,
    execFileSyncFn: () => {
      throw error
    },
  })

  assert.equal(result.value, null)
  assert.equal(result.source, 'apple-smc')
  assert.equal(result.confidence, 'unsupported')
  assert.equal(result.errorCode, 'MACOS_SMC_PERMISSION_REQUIRED')
  assert.match(result.message, /AppleSMC/)
  assert.match(result.suggestion, /管理员权限/)
})

test('normalizes AppleSMC CLI fan readings into CpuFanData shape', () => {
  const result = normalizeMacSmcFanReading({
    source: 'apple-smc',
    temperatures: [],
    fans: [
      { id: 0, key: 'F0Ac', name: 'AppleSMC fan0', rpm: 1989 },
      { id: 1, key: 'F1Ac', name: 'AppleSMC fan1', rpm: 0 },
    ],
  })

  assert.equal(result.source, 'apple-smc')
  assert.equal(result.value, 1989)
  assert.equal(result.max, 1989)
  assert.equal(result.sensorName, 'AppleSMC fan0')
  assert.equal(result.unit, 'RPM')
})

test('reads AppleSMC fan speed only on darwin and parses JSON output', () => {
  const result = readMacSmcFanSpeed({
    platform: 'darwin',
    binaryPath: '/tmp/mac-smc-sensors',
    existsSyncFn: () => true,
    execFileSyncFn: () => JSON.stringify({
      source: 'apple-smc',
      temperatures: [],
      fans: [
        { id: 0, key: 'F0Ac', name: 'AppleSMC fan0', rpm: 2012 },
      ],
    }),
  })

  assert.equal(result.value, 2012)
  assert.equal(result.source, 'apple-smc')
})

test('normalizes Apple Silicon powermetrics cluster frequencies into CpuCurrentSpeedData shape', () => {
  const result = normalizeMacPowermetricsCpuSpeed(`
    E-Cluster HW active frequency: 972 MHz
    P-Cluster HW active frequency: 3288 MHz
  `)

  assert.equal(result.source, 'powermetrics')
  assert.equal(result.min, 0.97)
  assert.equal(result.max, 3.29)
  assert.equal(result.avg, 2.13)
  assert.deepEqual(result.cores, [0.97, 3.29])
})

test('normalizes HWInfoX powermetrics helper readings into CpuCurrentSpeedData shape', () => {
  const result = normalizeMacPowermetricsHelperReading({
    ok: true,
    source: 'powermetrics',
    privileged: true,
    helper: true,
    min: 0.972,
    max: 3.224,
    avg: 2.098,
    cores: [0.972, 3.224],
    sensorName: 'HWInfoX powermetrics helper',
  })

  assert.equal(result.source, 'powermetrics')
  assert.equal(result.privileged, true)
  assert.equal(result.helper, true)
  assert.equal(result.min, 0.97)
  assert.equal(result.max, 3.22)
  assert.equal(result.avg, 2.1)
  assert.deepEqual(result.cores, [0.97, 3.22])
})

test('normalizes HWInfoX powermetrics helper power readings into CpuPowerData shape', () => {
  const result = normalizeMacPowermetricsHelperPowerReading({
    ok: true,
    source: 'powermetrics',
    privileged: true,
    helper: true,
    value: 14.86,
    sensorName: 'CPU Power',
    sensors: [
      { name: 'CPU Power', value: 14.86 },
      { name: 'E-Cluster Power', value: 1.21 },
      { name: 'P-Cluster Power', value: 11.47 },
    ],
  })

  assert.equal(result.source, 'powermetrics')
  assert.equal(result.privileged, true)
  assert.equal(result.helper, true)
  assert.equal(result.value, 14.9)
  assert.equal(result.sensorName, 'CPU Power')
  assert.deepEqual(result.sensors, [
    { name: 'CPU Power', value: 14.9 },
    { name: 'E-Cluster Power', value: 1.2 },
    { name: 'P-Cluster Power', value: 11.5 },
  ])
})

test('normalizes HWInfoX powermetrics helper GPU telemetry into GpuData fields', () => {
  const result = normalizeMacPowermetricsHelperGpuTelemetry({
    ok: true,
    source: 'powermetrics',
    privileged: true,
    helper: true,
    utilizationGpu: 37.49,
    idleResidencyGpu: 62.51,
    clockCore: 1298.6,
    powerDraw: 12.84,
    sensorName: 'HWInfoX powermetrics helper GPU telemetry',
  })

  assert.equal(result.source, 'powermetrics')
  assert.equal(result.privileged, true)
  assert.equal(result.helper, true)
  assert.equal(result.utilizationGpu, 37.5)
  assert.equal(result.idleResidencyGpu, 62.5)
  assert.equal(result.clockCore, 1299)
  assert.equal(result.powerDraw, 12.8)
})

test('normalizes Intel powermetrics average frequency lines', () => {
  const result = normalizeMacPowermetricsCpuSpeed(`
    CPU Average frequency as fraction of nominal: 48.75% (1170.00 Mhz)
  `)

  assert.equal(result.source, 'powermetrics')
  assert.equal(result.min, 1.17)
  assert.equal(result.max, 1.17)
  assert.equal(result.avg, 1.17)
  assert.deepEqual(result.cores, [1.17])
})

test('reads powermetrics CPU speed only on darwin and parses output', () => {
  const result = readMacPowermetricsCpuSpeed({
    platform: 'darwin',
    execFileSyncFn: (file, args) => {
      assert.equal(file, '/usr/bin/powermetrics')
      assert.deepEqual(args, ['--samplers', 'cpu_power', '-n', '1', '-i', '200'])
      return 'P-Cluster HW active frequency: 2400 MHz'
    },
  })

  assert.equal(result.source, 'powermetrics')
  assert.equal(result.avg, 2.4)
  assert.deepEqual(result.cores, [2.4])
})

test('reads powermetrics CPU speed from helper only on darwin', async () => {
  const result = await readMacPowermetricsHelperCpuSpeed({
    platform: 'darwin',
    requestFn: async () => ({
      ok: true,
      source: 'powermetrics',
      privileged: true,
      helper: true,
      min: 1.1,
      max: 3.4,
      avg: 2.25,
      cores: [1.1, 3.4],
    }),
  })

  assert.equal(result.source, 'powermetrics')
  assert.equal(result.privileged, true)
  assert.equal(result.helper, true)
  assert.equal(result.avg, 2.25)
  assert.deepEqual(result.cores, [1.1, 3.4])
})

test('reads powermetrics CPU power from helper only on darwin', async () => {
  const result = await readMacPowermetricsHelperCpuPower({
    platform: 'darwin',
    requestFn: async (_options, command) => {
      assert.equal(command, 'cpu_power')
      return {
        ok: true,
        source: 'powermetrics',
        privileged: true,
        helper: true,
        value: 22.24,
        sensorName: 'CPU Power',
        sensors: [
          { name: 'CPU Power', value: 22.24 },
        ],
      }
    },
  })

  assert.equal(result.source, 'powermetrics')
  assert.equal(result.privileged, true)
  assert.equal(result.helper, true)
  assert.equal(result.value, 22.2)
  assert.deepEqual(result.sensors, [{ name: 'CPU Power', value: 22.2 }])
})

test('reads GPU telemetry from helper only on darwin', async () => {
  const result = await readMacPowermetricsHelperGpuTelemetry({
    platform: 'darwin',
    requestFn: async (_options, command) => {
      assert.equal(command, 'gpu_telemetry')
      return {
        ok: true,
        source: 'powermetrics',
        privileged: true,
        helper: true,
        utilizationGpu: 41.3,
        idleResidencyGpu: 58.66,
        clockCore: 1188,
        powerDraw: 9.26,
      }
    },
  })

  assert.equal(result.source, 'powermetrics')
  assert.equal(result.helper, true)
  assert.equal(result.utilizationGpu, 41.3)
  assert.equal(result.idleResidencyGpu, 58.7)
  assert.equal(result.clockCore, 1188)
  assert.equal(result.powerDraw, 9.3)
})

test('preserves sub-watt GPU power telemetry from helper', () => {
  const result = normalizeMacPowermetricsHelperGpuTelemetry({
    ok: true,
    source: 'powermetrics',
    privileged: true,
    helper: true,
    utilizationGpu: 2.66,
    clockCore: 765,
    powerDraw: 0.019,
  })

  assert.equal(result.utilizationGpu, 2.7)
  assert.equal(result.clockCore, 765)
  assert.equal(result.powerDraw, 0.019)
})

test('returns diagnostic CPU power result when powermetrics helper is unavailable', async () => {
  const result = await readMacPowermetricsHelperCpuPower({
    platform: 'darwin',
    requestFn: async () => {
      throw new Error('connect ENOENT /var/run/hwinfox-powermetrics-helper.sock')
    },
  })

  assert.equal(result.source, 'powermetrics')
  assert.equal(result.value, null)
  assert.equal(result.errorCode, 'MACOS_POWERMETRICS_HELPER_UNAVAILABLE')
  assert.equal(result.helper, true)
})

test('does not request powermetrics helper outside darwin', async () => {
  let requested = false
  const result = await readMacPowermetricsHelperCpuSpeed({
    platform: 'win32',
    requestFn: async () => {
      requested = true
      return { ok: true }
    },
  })

  assert.equal(result, undefined)
  assert.equal(requested, false)
})

test('returns diagnostic GPU telemetry result when powermetrics helper is unavailable', async () => {
  const result = await readMacPowermetricsHelperGpuTelemetry({
    platform: 'darwin',
    requestFn: async () => {
      throw new Error('connect ENOENT /var/run/hwinfox-powermetrics-helper.sock')
    },
  })

  assert.equal(result.source, 'powermetrics')
  assert.equal(result.utilizationGpu, null)
  assert.equal(result.clockCore, null)
  assert.equal(result.powerDraw, null)
  assert.equal(result.errorCode, 'MACOS_POWERMETRICS_HELPER_UNAVAILABLE')
  assert.equal(result.helper, true)
})

test('returns diagnostic CPU speed result when powermetrics helper is unavailable', async () => {
  const result = await readMacPowermetricsHelperCpuSpeed({
    platform: 'darwin',
    requestFn: async () => {
      throw new Error('connect ENOENT /var/run/hwinfox-powermetrics-helper.sock')
    },
  })

  assert.equal(result.source, 'powermetrics')
  assert.equal(result.avg, 0)
  assert.equal(result.errorCode, 'MACOS_POWERMETRICS_HELPER_UNAVAILABLE')
  assert.equal(result.helper, true)
  assert.match(result.suggestion, /helper/)
})

test('does not execute powermetrics outside darwin', () => {
  let executed = false
  const result = readMacPowermetricsCpuSpeed({
    platform: 'win32',
    execFileSyncFn: () => {
      executed = true
      return 'P-Cluster HW active frequency: 2400 MHz'
    },
  })

  assert.equal(result, undefined)
  assert.equal(executed, false)
})

test('returns diagnostic CPU speed result when powermetrics requires superuser', () => {
  const error = new Error('Command failed')
  error.stderr = 'powermetrics must be invoked as the superuser'

  const result = readMacPowermetricsCpuSpeed({
    platform: 'darwin',
    execFileSyncFn: () => {
      throw error
    },
  })

  assert.equal(result.source, 'powermetrics')
  assert.equal(result.avg, 0)
  assert.equal(result.errorCode, 'MACOS_POWERMETRICS_PERMISSION_REQUIRED')
  assert.match(result.suggestion, /privileged helper/)
})
