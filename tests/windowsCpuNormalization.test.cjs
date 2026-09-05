const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

function loadNormalizationFunction() {
  const source = fs.readFileSync(path.join(__dirname, '../utools/services/system.js'), 'utf8')
  const match = source.match(/function normalizeWindowsCpuInfo\(info, winDetails\) \{[\s\S]*?\n\}/)
  if (!match) throw new Error('normalizeWindowsCpuInfo not found')
  const context = { module: { exports: {} } }
  vm.runInNewContext(match[0] + '\nmodule.exports = { normalizeWindowsCpuInfo }', context)
  return context.module.exports.normalizeWindowsCpuInfo
}

test('normalizeWindowsCpuInfo corrects virtualization, socket, cache, and performance cores', () => {
  const normalizeWindowsCpuInfo = loadNormalizationFunction()

  const mockSiCpu = {
    manufacturer: 'AMD',
    brand: 'AMD Ryzen 9 8940HX with Radeon Graphics',
    speed: 2.4,
    speedMax: 5.3,
    cores: 32,
    physicalCores: 16,
    performanceCores: 32,
    efficiencyCores: 0,
    socket: 'Unknown',
    virtualization: false,
    cache: {
      l1d: 512,
      l1i: 512,
      l2: 16777216,
      l3: 67108864,
    },
  }

  const mockWinDetails = {
    SocketDesignation: 'FL1',
    VirtualizationFirmwareEnabled: true,
    L2CacheSize: 16384,
    L3CacheSize: 65536,
  }

  const normalized = normalizeWindowsCpuInfo(mockSiCpu, mockWinDetails)

  assert.equal(normalized.virtualization, true, 'virtualization should be true from firmware')
  assert.equal(normalized.socket, 'FL1', 'socket should be FL1 from SocketDesignation')
  assert.equal(normalized.performanceCores, 0, 'performanceCores should be normalized when homogeneous')
  assert.equal(normalized.cache.l1d, 524288, 'l1d should be normalized to bytes')
  assert.equal(normalized.cache.l1i, 524288, 'l1i should be normalized to bytes')
  assert.equal(normalized.cache.l2, 16777216, 'l2 should remain bytes')
  assert.equal(normalized.cache.l3, 67108864, 'l3 should remain bytes')
})

test('normalizeWindowsCpuInfo backfills missing L2 and L3 from winDetails', () => {
  const normalizeWindowsCpuInfo = loadNormalizationFunction()

  const mockSiCpu = {
    socket: 'AM5',
    virtualization: true,
    cores: 16,
    physicalCores: 8,
    performanceCores: 8,
    efficiencyCores: 0,
    cache: {
      l1d: 32768,
      l1i: 32768,
      l2: 0,
      l3: 0,
    },
  }

  const mockWinDetails = {
    SocketDesignation: 'AM5',
    VirtualizationFirmwareEnabled: true,
    L2CacheSize: 8192,
    L3CacheSize: 32768,
  }

  const normalized = normalizeWindowsCpuInfo(mockSiCpu, mockWinDetails)

  assert.equal(normalized.socket, 'AM5', 'socket should remain AM5')
  assert.equal(normalized.cache.l2, 8388608, 'l2 should be backfilled in bytes')
  assert.equal(normalized.cache.l3, 33554432, 'l3 should be backfilled in bytes')
})

test('formatCacheSize in Processor correctly formats bytes and small KB inputs without MB mislabeling', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/components/Processor/index.vue'), 'utf8')
  const match = source.match(/function formatCacheSize\(value: number\) \{[\s\S]*?\n\}/)
  assert.ok(match, 'formatCacheSize should exist')
  const cleaned = match[0].replace(/:\s*number/g, '')
  const context = { module: { exports: {} } }
  vm.runInNewContext(cleaned + '\nmodule.exports = { formatCacheSize }', context)
  const formatCacheSize = context.module.exports.formatCacheSize

  assert.equal(formatCacheSize(0), '--')
  assert.equal(formatCacheSize(512), '512 KB')
  assert.equal(formatCacheSize(524288), '512 KB')
  assert.equal(formatCacheSize(1048576), '1 MB')
  assert.equal(formatCacheSize(16777216), '16 MB')
  assert.equal(formatCacheSize(67108864), '64 MB')
})

test('getHardwareMonitorCpuTemperatureFromNamespace contains CCD sensor fallback for AMD processors', () => {
  const source = fs.readFileSync(path.join(__dirname, '../utools/services/system.js'), 'utf8')
  assert.match(source, /async function getHardwareMonitorCpuTemperatureFromNamespace\(namespace, cpuInfo\)/)
  assert.match(source, /const ccdSensors = sensors\s*\.filter\(\(sensor\) => \/ccd\\s\*\#\?\\d\+\/i\.test\(normalizeSensorText\(sensor\)\)\)/)
  assert.match(source, /const coresPerCcd = Math\.max\(1, Math\.floor\(physicalCores \/ ccdSensors\.length\)\)/)
})

test('getDisplayCpuCurrentSpeedGHz prefers package average to align with Task Manager, while getPeakCpuCurrentSpeedGHz preserves peak single core', () => {
  const ts = require('typescript')
  const filePath = path.join(__dirname, '../src/utils.ts')
  const source = fs.readFileSync(filePath, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filePath,
  }).outputText
  const module = { exports: {} }
  const wrapped = new Function('require', 'module', 'exports', '__filename', '__dirname', compiled)
  wrapped(require, module, module.exports, filePath, path.dirname(filePath))
  const { getDisplayCpuCurrentSpeedGHz, getPeakCpuCurrentSpeedGHz } = module.exports

  // Scenario 1: multiple cores with dynamic frequencies and calculated avg (like 16-core Ryzen)
  const speedWithCoresAndAvg = {
    avg: 3.25,
    max: 5.09,
    min: 2.18,
    cores: [2.26, 5.09, 5.09, 2.26, 2.26, 2.38],
  }

  assert.equal(getDisplayCpuCurrentSpeedGHz(speedWithCoresAndAvg), 3.25, 'should display package average to align with Task Manager')
  assert.equal(getPeakCpuCurrentSpeedGHz(speedWithCoresAndAvg), 5.09, 'should preserve single-core peak turbo')

  // Scenario 2: cores available but avg missing -> calculate mean
  const speedWithCoresOnly = {
    cores: [2.0, 4.0],
  }
  assert.equal(getDisplayCpuCurrentSpeedGHz(speedWithCoresOnly), 3.0, 'should calculate mean of valid cores')
  assert.equal(getPeakCpuCurrentSpeedGHz(speedWithCoresOnly), 4.0, 'should pick max core as peak')

  // Scenario 3: only avg available (e.g. systeminformation fallback)
  const speedWithAvgOnly = {
    avg: 2.4,
    cores: [],
  }
  assert.equal(getDisplayCpuCurrentSpeedGHz(speedWithAvgOnly), 2.4)
  assert.equal(getPeakCpuCurrentSpeedGHz(speedWithAvgOnly), 2.4)
})



