const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

function getFunctionDeclaration(source, name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source)
  assert.ok(match, `expected ${name} declaration`)

  const start = match.index
  const openBrace = source.indexOf('{', start)
  assert.notEqual(openBrace, -1, `expected ${name} body`)

  let depth = 0
  let quote = ''
  let escaped = false
  let lineComment = false
  let blockComment = false

  for (let index = openBrace; index < source.length; index += 1) {
    const character = source[index]
    const nextCharacter = source[index + 1]

    if (lineComment) {
      if (character === '\n') lineComment = false
      continue
    }
    if (blockComment) {
      if (character === '*' && nextCharacter === '/') {
        blockComment = false
        index += 1
      }
      continue
    }
    if (quote) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === quote) {
        quote = ''
      }
      continue
    }
    if (character === '/' && nextCharacter === '/') {
      lineComment = true
      index += 1
      continue
    }
    if (character === '/' && nextCharacter === '*') {
      blockComment = true
      index += 1
      continue
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character
      continue
    }
    if (character === '{') depth += 1
    if (character === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }

  throw new Error(`unable to find end of ${name}`)
}

function createWindowsVoltageReader() {
  const source = fs.readFileSync(path.join(__dirname, '../utools/services/system.js'), 'utf8')
  const cpuSensorDefinitions = source.slice(
    source.indexOf('const CPU_SENSOR_EXCLUSION_TERMS = ['),
    source.indexOf('function scoreCpuTemperatureSensor(')
  )
  assert.ok(cpuSensorDefinitions.includes('function isCpuSensor('), 'expected CPU sensor classification helpers')

  const voltageDefinitions = source.slice(
    source.indexOf('function scoreCpuVoltageSensor('),
    source.indexOf('function scoreCpuFanSensor(')
  )
  assert.ok(voltageDefinitions.includes('function isExplicitCpuVcoreSensor('), 'expected Vcore classifier')
  assert.ok(voltageDefinitions.includes('function isCpuVidSensor('), 'expected VID classifier')

  const context = {
    module: { exports: {} },
    __testSensors: [],
  }
  const code = [
    'function normalizeSensorText(sensor) { return `${sensor.name} ${sensor.identifier} ${sensor.parent}`.toLowerCase() }',
    cpuSensorDefinitions,
    voltageDefinitions,
    'async function getHardwareMonitorSensors(sensorType) { return sensorType === "Voltage" ? __testSensors : [] }',
    getFunctionDeclaration(source, 'getHardwareMonitorCpuVoltage'),
    'module.exports = { getHardwareMonitorCpuVoltage }',
  ].join('\n\n')

  vm.runInNewContext(code, context, { filename: 'system-voltage-under-test.js' })
  return async (sensors) => {
    context.__testSensors = sensors
    return context.module.exports.getHardwareMonitorCpuVoltage()
  }
}

const readCpuVoltage = createWindowsVoltageReader()

test('Windows helper CPU Core voltage is surfaced as primary Vcore telemetry', async () => {
  const result = await readCpuVoltage([
    {
      name: 'CPU Core',
      identifier: '/intelcpu/0/voltage/0',
      parent: 'Intel Core i7',
      hardwareType: 'Cpu',
      sensorType: 'Voltage',
      value: 1.024,
    },
    {
      name: 'CPU Core #1',
      identifier: '/intelcpu/0/voltage/1',
      parent: 'Intel Core i7',
      hardwareType: 'Cpu',
      sensorType: 'Voltage',
      value: 1.11,
    },
  ])

  assert.deepEqual(
    {
      value: result.value,
      measurement: result.measurement,
      sensorName: result.sensorName,
      source: result.source,
      unit: result.unit,
    },
    {
      value: 1.024,
      measurement: 'vcore',
      sensorName: 'CPU Core',
      source: 'OpenHardwareMonitor',
      unit: 'V',
    }
  )
})

test('Windows per-core voltage rows remain a VID fallback when no Vcore row exists', async () => {
  const result = await readCpuVoltage([
    {
      name: 'CPU Core #1',
      identifier: '/intelcpu/0/voltage/1',
      parent: 'Intel Core i7',
      hardwareType: 'Cpu',
      sensorType: 'Voltage',
      value: 1.06,
    },
    {
      name: 'P-Core #1',
      identifier: '/intelcpu/0/voltage/2',
      parent: 'Intel Core i7',
      hardwareType: 'Cpu',
      sensorType: 'Voltage',
      value: 1.18,
    },
    {
      name: 'E-Core #1',
      identifier: '/intelcpu/0/voltage/3',
      parent: 'Intel Core i7',
      hardwareType: 'Cpu',
      sensorType: 'Voltage',
      value: 0.91,
    },
  ])

  assert.equal(result.measurement, 'vid')
  assert.equal(result.value, 1.18)
  assert.equal(result.sensorName, 'P-Core #1')
})

test('AMD Core #n VID helper rows are surfaced when they are the available CPU voltage data', async () => {
  const result = await readCpuVoltage([
    {
      name: 'Core #1 VID',
      identifier: '/amdcpu/0/voltage/0',
      parent: 'AMD Ryzen',
      hardwareType: 'Cpu',
      sensorType: 'Voltage',
      value: 0.94,
    },
    {
      name: 'Core #2 VID',
      identifier: '/amdcpu/0/voltage/1',
      parent: 'AMD Ryzen',
      hardwareType: 'Cpu',
      sensorType: 'Voltage',
      value: 1.02,
    },
  ])

  assert.equal(result.measurement, 'vid')
  assert.equal(result.value, 1.02)
  assert.equal(result.sensorName, 'Core #2 VID')
})

test('OHM SuperIO Voltage #1 is promoted to CPU Vcore ahead of AMD VID rows', async () => {
  const result = await readCpuVoltage([
    {
      name: 'Voltage #1',
      identifier: '/lpc/it8689e/0/voltage/0',
      parent: 'ITE IT8689E',
      hardwareType: 'SuperIO',
      sensorType: 'Voltage',
      value: 1.164,
    },
    {
      name: 'Core #1 VID',
      identifier: '/amdcpu/0/voltage/2',
      parent: 'AMD Ryzen 5 9500F',
      hardwareType: 'Cpu',
      sensorType: 'Voltage',
      value: 0.25625,
    },
  ])

  assert.equal(result.measurement, 'vcore')
  assert.equal(result.value, 1.164)
  assert.equal(result.sensorName, 'Voltage #1')
})

test('Windows Vcore takes precedence over per-core VID helper rows', async () => {
  const result = await readCpuVoltage([
    {
      name: 'CPU Vcore',
      identifier: '/lpc/voltage/0',
      parent: 'Mainboard',
      hardwareType: 'LPC',
      sensorType: 'Voltage',
      value: 1.19,
    },
    {
      name: 'CPU Core #1',
      identifier: '/intelcpu/0/voltage/1',
      parent: 'Intel Core i7',
      hardwareType: 'Cpu',
      sensorType: 'Voltage',
      value: 1.26,
    },
  ])

  assert.equal(result.measurement, 'vcore')
  assert.equal(result.value, 1.19)
  assert.equal(result.sensorName, 'CPU Vcore')
})
