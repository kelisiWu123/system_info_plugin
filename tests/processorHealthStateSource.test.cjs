const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

test('processor health card does not call missing telemetry healthy', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/components/Processor/index.vue'), 'utf8')

  assert.match(source, /const cpuLoadTelemetryAvailable = computed\(\(\) => Array\.isArray\(cpuLoadData\.value\?\.cpus\)/)
  assert.match(source, /if \(temperature === null && !cpuLoadTelemetryAvailable\.value\)/)
  assert.match(source, /title: '实时数据待补齐'/)
  assert.match(source, /function buildHistoryFooter\(values: number\[\], current: number \| null/)
  assert.match(source, /value: cpuLoadTelemetryAvailable\.value \? `\$\{Math\.round\(cpuLoadPercent\.value\)\}%` : '--'/)
})
