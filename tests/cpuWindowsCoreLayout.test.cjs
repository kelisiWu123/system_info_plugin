const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

function loadTsModule(relativePath) {
  const filePath = path.join(__dirname, '..', relativePath)
  const source = fs.readFileSync(filePath, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  })

  const module = { exports: {} }
  const wrapped = new Function('require', 'module', 'exports', '__filename', '__dirname', compiled.outputText)
  wrapped(require, module, module.exports, filePath, path.dirname(filePath))
  return module.exports
}

test('ignores single-sided performance core counts when deriving Windows display core rows', () => {
  const { getCpuHybridCoreCounts, getProcessorDisplayCoreCount } = loadTsModule('src/utils/processor.ts')
  const cpu = {
    physicalCores: 16,
    cores: 32,
    performanceCores: 32,
    efficiencyCores: 0,
  }

  assert.deepEqual(getCpuHybridCoreCounts(cpu), {
    performance: 0,
    efficiency: 0,
    total: 0,
  })
  assert.equal(
    getProcessorDisplayCoreCount(
      cpu,
      {
        source: 'OpenHardwareMonitor',
        cores: Array.from({ length: 16 }, (_, index) => 4.6 - index * 0.01),
      },
      {
        cpus: Array.from({ length: 32 }, () => ({ load: 0 })),
      }
    ),
    16
  )
})

test('uses explicit hybrid core counts only when both P-core and E-core clusters are present', () => {
  const { getCpuHybridCoreCounts, getProcessorDisplayCoreCount } = loadTsModule('src/utils/processor.ts')
  const cpu = {
    physicalCores: 14,
    cores: 20,
    performanceCores: 6,
    efficiencyCores: 8,
  }

  assert.deepEqual(getCpuHybridCoreCounts(cpu), {
    performance: 6,
    efficiency: 8,
    total: 14,
  })
  assert.equal(getProcessorDisplayCoreCount(cpu, { cores: Array(14).fill(4.1) }, { cpus: Array(20).fill({ load: 0 }) }), 14)
})

test('hardware monitor CPU speed parsing excludes core max summary sensors from per-core rows', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'utools/services/system.js'), 'utf8')
  const speedSectionMatch = source.match(/async function getHardwareMonitorCpuCurrentSpeed\(cpuInfo\) \{[\s\S]*?\n\}/)
  const speedSection = speedSectionMatch ? speedSectionMatch[0] : ''

  assert.match(source, /function getCpuCoreClockSensorIndex\(sensor\)/)
  assert.match(source, /function isEffectiveCpuClockSensor\(sensor\)/)
  assert.match(source, /const numberedCoreSensors = normalized\.filter\(\(sensor\) => sensor\.coreIndex !== null && !sensor\.effectiveClock\)/)
  assert.match(source, /sanitizeNumberedCpuCoreClockSensors\(\s*numberedCoreSensors,\s*cpuSpeedMaxGhz,\s*expectedCoreCount\s*\)/)
  assert.ok(speedSection, 'expected getHardwareMonitorCpuCurrentSpeed source block')
  assert.doesNotMatch(speedSection, /core\\s\*#\?\\d\+\|core max/i)
})

test('hardware monitor CPU speed reads only the OpenHardwareMonitor namespace', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'utools/services/system.js'), 'utf8')

  assert.match(source, /function hasValidCpuClockCoreValues\(cores\)/)
  assert.match(source, /async function getHardwareMonitorCpuCurrentSpeedFromNamespace\(namespace, cpuInfo\)/)
  assert.match(source, /return getHardwareMonitorCpuCurrentSpeedFromNamespace\(OPEN_HARDWARE_MONITOR_WMI_NAMESPACE, cpuInfo\)/)
  assert.match(source, /const cpuInfo = isWindows\(\)\s*\?\s*await readCachedServiceValue\(\s*'cpuInfo'/)
  assert.match(source, /const sensorSettings = getHardwareSensorSettings\(\)/)
  assert.match(source, /if \(isWindows\(\) && sensorSettings\.enhancedSensorEnabled\)/)
  assert.match(source, /if \(hasValidCpuClockCoreValues\(hardwareMonitorSpeed\?\.cores\) \|\| hardwareMonitorSpeed\?\.avg\)/)
  assert.doesNotMatch(source, /if \(hardwareMonitorSpeed\?\.cores\?\.length \|\| hardwareMonitorSpeed\?\.avg\)/)
  assert.doesNotMatch(source, /root\\\\LibreHardwareMonitor/)
  assert.doesNotMatch(
    source.match(/async function getHardwareMonitorCpuCurrentSpeed\(cpuInfo\) \{[\s\S]*?\n\}/)?.[0] || '',
    /getHardwareMonitorSensors\('Clock'\)/
  )
})
