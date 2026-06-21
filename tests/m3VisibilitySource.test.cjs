const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('hardware composables reuse shared visibility helpers instead of local listener code', () => {
  const files = [
    'src/composables/useHardwareData.ts',
    'src/composables/useGraphicsHardwareData.ts',
    'src/composables/useOverviewHardwareData.ts',
    'src/composables/useProcessorHardwareData.ts',
  ]

  for (const file of files) {
    const source = readSource(file)
    assert.match(source, /from ['"].*monitoringVisibility['"]/)
    assert.doesNotMatch(source, /function resolveBackgroundThrottled/)
    assert.doesNotMatch(source, /function bindVisibilityListeners/)
    assert.doesNotMatch(source, /window\.addEventListener\('focus'/)
    assert.doesNotMatch(source, /document\.addEventListener\('visibilitychange'/)
  }
})

test('only monitoringVisibility defines shared visibility helpers', () => {
  const source = readSource('src/utils/monitoringVisibility.ts')

  assert.match(source, /export function resolveMonitoringBackgroundThrottled/)
  assert.match(source, /export function bindMonitoringVisibilityListeners/)
})
