const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('hardware monitor command opens a dedicated dashboard window', () => {
  const plugin = JSON.parse(readSource('plugin.json'))
  const preload = readSource('utools/preload.js')
  const windowService = readSource('utools/services/window.js')
  const entryBuilder = readSource('scripts/generate-utools-entry-pages.mjs')
  const app = readSource('src/App.vue')

  const feature = plugin.features.find((item) => item.code === 'hardwareWatch')
  assert.ok(feature)
  assert.deepEqual(feature.cmds, ['硬件监控'])

  assert.match(preload, /a_monitor:\s*{[\s\S]*prod:\s*{\s*height:\s*820,\s*width:\s*1180,\s*backgroundColor:\s*1\s*}/)
  assert.match(preload, /hardwareWatch:\s*{[\s\S]*openPresetWindow\('a_monitor'\)/)
  assert.match(windowService, /if \(fileName === 'a_monitor'\) return 'monitor'/)
  assert.match(windowService, /if \(fileName === 'a_monitor'\) return 'a_monitor\/index\.html'/)
  assert.match(entryBuilder, /\['a_monitor',\s*'monitor'\]/)
  assert.match(app, /const isMonitorPage = computed\(\(\) => currentPage\.value === 'monitor'\)/)
  assert.match(app, /v-else-if="isMonitorPage"[\s\S]*<MonitoringDashboard :active="true"/)
})

test('monitor dashboard owns dynamic telemetry and launches the existing floating monitors', () => {
  const dashboard = readSource('src/components/MonitoringDashboard/index.vue')
  const store = readSource('src/composables/useMonitorDashboardData.ts')

  assert.match(dashboard, /运行状态/)
  assert.match(dashboard, /标准悬浮监控/)
  assert.match(dashboard, /超轻量悬浮/)
  assert.match(dashboard, /window\.services\.createWindow\('a_watch', 398, 432, 0\)/)
  assert.match(dashboard, /window\.services\.createWindow\('a_watch_super_lite', 200, 200, 0\)/)
  assert.match(dashboard, /高占用进程/)
  assert.match(dashboard, /存储 I\/O/)
  assert.match(dashboard, /网关延迟/)

  assert.match(store, /window\.services\.getCpuFullLoad\(\)/)
  assert.match(store, /window\.services\.getCpuTemperature\(\)/)
  assert.match(store, /window\.services\.getGpuInfo\(\)/)
  assert.match(store, /window\.services\.getMemInfo\(\)/)
  assert.match(store, /window\.services\.getDiskData\(\)/)
  assert.match(store, /window\.services\.getStorageIo\(\)/)
  assert.match(store, /window\.services\.getNetworkStatus\(\)/)
  assert.match(store, /window\.services\.getTopProcesses\(\)/)
  assert.match(store, /bindMonitoringVisibilityListeners/)
  assert.match(store, /getMonitoringRefreshIntervals/)
})

test('hardware information overview no longer renders the old monitoring instrument panel', () => {
  const overview = readSource('src/components/Computer/index.vue')
  const dashboard = readSource('src/components/MonitoringDashboard/index.vue')

  assert.doesNotMatch(overview, /class="status-panel"/)
  assert.doesNotMatch(overview, /status-card__ring/)
  assert.doesNotMatch(overview, /label:\s*'高占用进程'/)
  assert.match(dashboard, /monitor-metric-grid/)
  assert.match(dashboard, /monitor-process-panel/)
})

test('floating watch implementation remains separate and reusable', () => {
  const watch = readSource('src/components/Watch/index.vue')
  const preload = readSource('utools/preload.js')

  assert.match(preload, /a_watch:\s*{[\s\S]*height:\s*398,\s*width:\s*432/)
  assert.match(preload, /a_watch_super_lite:\s*{[\s\S]*height:\s*200,\s*width:\s*200/)
  assert.match(watch, /initialFloatingMode\?:\s*'standard' \| 'super-lite'/)
  assert.match(watch, /data-floating-mode/)
})
