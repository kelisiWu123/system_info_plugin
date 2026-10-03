const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
function source(file) { return fs.readFileSync(path.join(__dirname, '..', file), 'utf8') }

test('sampling profile definitions use the selected global profile and pause only background CPU/GPU/auxiliary work', () => {
  const service = source('utools/services/system.js')
  const start = service.indexOf('const HARDWARE_SAMPLE_PROFILES =')
  const end = service.indexOf('function getSharedHardwareTelemetry()', start)
  const load = new Function('getMonitoringRefreshSettings', `${service.slice(start, end)}; return getHardwareSampleIntervals()`)
  const realtime = load(() => ({ profile: 'realtime', backgroundThrottleEnabled: true }))
  assert.equal(realtime.cpuLoad, 1500)
  assert.equal(realtime.gpu, 3000)
  assert.equal(realtime.background.cpuLoad, 0)
  assert.equal(realtime.background.gpu, 0)
  assert.equal(realtime.background.memoryUsage, 4000)
  const eco = load(() => ({ profile: 'eco', backgroundThrottleEnabled: false }))
  assert.equal(eco.cpuLoad, 10000)
  assert.equal(eco.background.cpuLoad, 10000)
})

test('detail pages show available samples during enrichment and keep data below retryable failure banners', () => {
  const pages = ['Processor', 'GraphicsPage', 'MemoryPage', 'StoragePage']
  for (const page of pages) {
    const component = source(`src/components/${page}/index.vue`)
    const template = component.slice(component.indexOf('<template>'))
    assert.match(template, /v-if="loading && /, `${page} must not block already available data`)
    assert.match(template, /<template v-else>[\s\S]*v-if="pageStateBlock"[\s\S]*<section/, `${page} must retain its content after a partial failure`)
  }
  assert.match(source('src/components/Watch/CpuCoresWatchView.vue'), /v-else-if="loading && !allCoreRows.length"/)
})

test('GPU clock history and failure paths participate in shared UI updates', () => {
  const graphics = source('src/composables/useGraphicsHardwareData.ts')
  const subscription = graphics.slice(graphics.indexOf('function subscribeGraphicsTelemetry()'), graphics.indexOf('function setFetchState('))
  assert.match(subscription, /metricHistory\.gpuClock/)
  assert.match(subscription, /setFetchState\('gpuInfo', 'error'/)
  const hardware = source('src/composables/useHardwareData.ts')
  assert.match(hardware, /if \(key === 'diskIo'\) setFetchState\('storageIo', 'error', error\)/)
  const watch = source('src/components/Watch/index.vue')
  assert.match(watch, /label: '旧数据'/)
  assert.match(watch, /delete telemetryErrors\[key\]/)
})
