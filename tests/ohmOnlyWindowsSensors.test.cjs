const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('windows hardware monitor service uses only the OpenHardwareMonitor namespace', () => {
  const source = readProjectFile('utools/services/system.js')

  assert.match(source, /root\\\\OpenHardwareMonitor/)
  assert.doesNotMatch(source, /root\\\\LibreHardwareMonitor/)
  assert.doesNotMatch(source, /getEmbeddedLibreHardwareMonitorCpuTemperature/)
})

test('Windows sensor internals stay on the existing OHM engine while user-facing labels say sensor enhancement', () => {
  const processorPage = readProjectFile('src/components/Processor/index.vue')
  const watchUtils = readProjectFile('src/utils/watch.ts')
  const platform = readProjectFile('src/utils/platform.ts')
  const helper = readProjectFile('native/windows-sensor-helper/Program.cs')

  assert.doesNotMatch(processorPage, /LibreHardwareMonitor/)
  assert.doesNotMatch(watchUtils, /LibreHardwareMonitor/)
  assert.doesNotMatch(helper, /LibreHardwareMonitor/)
  assert.match(helper, /using OpenHardwareMonitor\.Hardware;/)
  assert.match(processorPage, /if \(speed\.source === 'OpenHardwareMonitor'\) return '传感器增强'/)
  assert.match(watchUtils, /if \(speed\?\.source === 'OpenHardwareMonitor'\) return '传感器增强'/)
  assert.match(platform, /return '传感器增强'/)
  assert.doesNotMatch(platform, /return 'OpenHardwareMonitor'/)
})

test('public sensor source types no longer expose LibreHardwareMonitor', () => {
  const typeDefs = readProjectFile('src/type/interface.d.ts')

  assert.doesNotMatch(typeDefs, /LibreHardwareMonitor/)
})
