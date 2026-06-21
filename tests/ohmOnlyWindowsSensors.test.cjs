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

test('processor and watch UI no longer mention LibreHardwareMonitor as a sensor source', () => {
  const processorPage = readProjectFile('src/components/Processor/index.vue')
  const watchUtils = readProjectFile('src/utils/watch.ts')

  assert.doesNotMatch(processorPage, /LibreHardwareMonitor/)
  assert.doesNotMatch(watchUtils, /LibreHardwareMonitor/)
})

test('public sensor source types no longer expose LibreHardwareMonitor', () => {
  const typeDefs = readProjectFile('src/type/interface.d.ts')

  assert.doesNotMatch(typeDefs, /LibreHardwareMonitor/)
})
