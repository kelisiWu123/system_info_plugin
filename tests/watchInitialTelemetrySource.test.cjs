const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

test('standard floating monitor does not present zero load before the first telemetry sample', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/components/Watch/index.vue'), 'utf8')

  assert.match(source, /const hasCpuLoadSample = computed\(\(\) => history\.cpu\.length > 0\)/)
  assert.match(source, /const hasGpuLoadSample = computed\(\(\) => typeof primaryGpu\.value\?\.utilizationGpu === 'number'\)/)
  assert.match(source, /const hasMemorySample = computed\(\(\) => memoData\.total > 0\)/)
  assert.match(source, /hasCpuLoadSample \? formatPercent\(cpuPercent\) : '--'/)
  assert.match(source, /hasGpuLoadSample \? formatPercent\(gpuPercent\) : '--'/)
  assert.match(source, /hasMemorySample \? formatPercent\(memoryPercent\) : '--'/)
})
