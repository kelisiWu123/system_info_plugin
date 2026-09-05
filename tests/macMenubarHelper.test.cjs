const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

function loadMacMenubarSettingsFunctions() {
  const source = fs.readFileSync(path.join(__dirname, '../utools/services/system.js'), 'utf8')
  
  const normMatch = source.match(/function normalizeMacMenubarSettings\(input\) \{[\s\S]*?\n\}/)
  if (!normMatch) throw new Error('normalizeMacMenubarSettings not found')

  const code = `
    ${normMatch[0]}
    module.exports = { normalizeMacMenubarSettings };
  `
  const context = { module: { exports: {} } }
  vm.runInNewContext(code, context)
  return context.module.exports
}

test('normalizeMacMenubarSettings normalizes empty or partial inputs to sensible defaults', () => {
  const { normalizeMacMenubarSettings } = loadMacMenubarSettingsFunctions()

  const defaults = normalizeMacMenubarSettings({})
  assert.equal(defaults.enabled, false)
  assert.equal(defaults.showTemp, true)
  assert.equal(defaults.showLoad, true)
  assert.equal(defaults.showIcon, true)
  assert.equal(defaults.metrics.cpuTemperature, true)
  assert.equal(defaults.metrics.cpuLoad, true)
  assert.equal(defaults.metrics.cpuFrequency, false)
  assert.equal(defaults.metrics.fanSpeed, false)
  assert.equal(defaults.metrics.memoryUsage, false)
  assert.equal(defaults.metrics.diskIo, false)
  assert.equal(defaults.metrics.networkIo, false)

  const customized = normalizeMacMenubarSettings({
    enabled: true,
    showTemp: false,
    showLoad: false,
    showIcon: false,
    metrics: {
      cpuTemperature: true,
      cpuLoad: false,
      cpuFrequency: true,
      fanSpeed: true,
      memoryUsage: true,
      diskIo: true,
      networkIo: true,
    },
  })
  assert.equal(customized.enabled, true)
  assert.equal(customized.showTemp, true)
  assert.equal(customized.showLoad, false)
  assert.equal(customized.showIcon, false)
  assert.equal(customized.metrics.cpuTemperature, true)
  assert.equal(customized.metrics.cpuLoad, false)
  assert.equal(customized.metrics.cpuFrequency, true)
  assert.equal(customized.metrics.fanSpeed, true)
  assert.equal(customized.metrics.memoryUsage, true)
  assert.equal(customized.metrics.diskIo, true)
  assert.equal(customized.metrics.networkIo, true)
})

test('macMenubarHelper telemetry serialization formats JSON payload correctly', () => {
  const source = fs.readFileSync(path.join(__dirname, '../utools/services/macMenubarHelper.js'), 'utf8')
  assert.ok(source.includes('updateMacMenubarTelemetry'), 'macMenubarHelper must export updateMacMenubarTelemetry')
  assert.ok(source.includes('startMacMenubarHelper'), 'macMenubarHelper must export startMacMenubarHelper')
  assert.ok(source.includes('stopMacMenubarHelper'), 'macMenubarHelper must export stopMacMenubarHelper')
  assert.ok(source.includes('getMacMenubarStatus'), 'macMenubarHelper must export getMacMenubarStatus')
  assert.match(source, /MENUBAR_OWNER_RECORD_PATH/)
  assert.match(source, /fs\.openSync\(MENUBAR_OWNER_RECORD_PATH, 'wx'\)/)
  assert.match(source, /MENUBAR_TELEMETRY_PATH/)
  assert.match(source, /function getMenubarHostPid\(\)/)
  assert.match(source, /Number\(process\.ppid\)/)
  assert.match(source, /HWINFOX_MENUBAR_PARENT_PID: String\(getMenubarHostPid\(\)\)/)
  assert.doesNotMatch(source, /process\.once\('exit', cleanupMenubarProcessOnParentExit\)/)
  assert.match(source, /fanSpeed/)
  assert.match(source, /memoryUsedBytes/)
  assert.match(source, /diskReadBytesPerSec/)
  assert.match(source, /networkDownloadBytesPerSec/)
  assert.match(source, /networkUploadBytesPerSec/)

  const nativeSource = fs.readFileSync(path.join(__dirname, '../native/macos-menubar-helper/main.m'), 'utf8')
  assert.match(nativeSource, /utools:\/\/HWInfoX%20%E7%A1%AC%E4%BB%B6%E4%BF%A1%E6%81%AF\/%E7%A1%AC%E4%BB%B6%E4%BF%A1%E6%81%AF/)
})
