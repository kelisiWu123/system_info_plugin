const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('floating monitor settings are exposed through the service bridge', () => {
  const system = readSource('utools/services/system.js')
  const types = readSource('src/type/interface.d.ts')

  assert.match(system, /FLOATING_MONITOR_SETTINGS_STORAGE_KEY/)
  assert.match(system, /function getFloatingMonitorSettings\(\)/)
  assert.match(system, /function updateFloatingMonitorSettings\(patch = {}\)/)
  assert.match(system, /getFloatingMonitorSettings:\s*async/)
  assert.match(system, /updateFloatingMonitorSettings:\s*async/)

  assert.match(types, /type FloatingMonitorMode = 'standard' \| 'super-lite'/)
  assert.match(types, /interface FloatingMonitorSettingsData/)
  assert.match(types, /getFloatingMonitorSettings: \(\) => Promise<FloatingMonitorSettingsData>/)
  assert.match(types, /updateFloatingMonitorSettings: \(patch: Partial<FloatingMonitorSettingsData>\) => Promise<FloatingMonitorSettingsData>/)
})

test('super-lite view is presentational and Watch owns services and timers', () => {
  const watch = readSource('src/components/Watch/index.vue')
  const superLite = readSource('src/components/Watch/SuperLiteMonitorView.vue')

  assert.match(watch, /import SuperLiteMonitorView/)
  assert.match(watch, /window\.services\.getCpuFullLoad/)
  assert.match(watch, /window\.setInterval/)
  assert.match(watch, /history\.cpu/)

  assert.doesNotMatch(superLite, /window\.services/)
  assert.doesNotMatch(superLite, /setInterval/)
  assert.doesNotMatch(superLite, /localStorage|dbStorage/)
})

test('Watch switches floating modes, resizes the window, and persists mode and pinned state', () => {
  const watch = readSource('src/components/Watch/index.vue')

  assert.match(watch, /const floatingMode = ref<FloatingMonitorMode>/)
  assert.match(watch, /switchFloatingMode/)
  assert.match(watch, /window\.services\.resizeWindow\(200,\s*200\)/)
  assert.match(watch, /updateFloatingMonitorSettings/)
  assert.match(watch, /SuperLiteMonitorView/)
  assert.match(watch, /formatSuperLiteRefreshLabel\(getCurrentPollProfile\(\)\.fast\)/)
})

test('explicit watch entries override persisted floating mode without mutating defaults', () => {
  const watch = readSource('src/components/Watch/index.vue')

  assert.match(watch, /props\.initialFloatingEntry === 'hardwareWatch'/)
  assert.match(watch, /props\.initialFloatingEntry === 'hardwareWatchSuperLite'/)
  assert.doesNotMatch(watch, /persistFloatingMonitorSettings\(\{\s*mode:\s*'super-lite'/)
})

test('standard watch mode keeps existing modes and actions', () => {
  const watch = readSource('src/components/Watch/index.vue')

  assert.match(watch, /monitorMode = ref<'overview' \| 'cpu' \| 'gpu'>\('overview'\)/)
  assert.match(watch, /@click="setMonitorMode\('overview'\)"/)
  assert.match(watch, /@click="setMonitorMode\('cpu'\)"/)
  assert.match(watch, /@click="setMonitorMode\('gpu'\)"/)
  assert.match(watch, /window\.services\.alwaysOnTop\(pinned\.value\)/)
  assert.match(watch, /window\.services\.closeWindow\(\)/)
})

test('super-lite layout keeps a draggable header and prevents compact values from wrapping', () => {
  const watch = readSource('src/components/Watch/index.vue')
  const superLite = readSource('src/components/Watch/SuperLiteMonitorView.vue')

  assert.match(watch, /resolveSuperLiteMetricStatus/)
  assert.match(superLite, /<div class="super-lite-status"/)
  assert.doesNotMatch(superLite, /<button[^>]*class="super-lite-status"/)
  assert.match(superLite, /\.super-lite-header\s*{[\s\S]*-webkit-app-region:\s*drag/)
  assert.match(superLite, /\.super-lite-status\s*{[\s\S]*white-space:\s*nowrap/)
  assert.match(superLite, /\.super-lite-row__top\s*>\s*span:last-child\s*{[\s\S]*white-space:\s*nowrap/)
  assert.match(superLite, /\.super-lite-footer\s*{[\s\S]*grid-template-columns:/)
})

test('super-lite mode stays as a single overview surface without tab detail pages', () => {
  const watch = readSource('src/components/Watch/index.vue')
  const superLite = readSource('src/components/Watch/SuperLiteMonitorView.vue')

  assert.doesNotMatch(watch, /superLitePage/)
  assert.doesNotMatch(watch, /@set-page=/)
  assert.doesNotMatch(superLite, /super-lite-switcher/)
  assert.doesNotMatch(superLite, /super-lite-detail/)
  assert.doesNotMatch(superLite, /emit\('set-page'/)
  assert.doesNotMatch(superLite, /<button[\s\S]*v-for="metric"/)
  assert.match(superLite, /<article[\s\S]*v-for="metric in metrics"/)
})

test('super-lite memory row emphasizes macOS memory pressure over used capacity', () => {
  const watch = readSource('src/components/Watch/index.vue')

  assert.match(watch, /usageLabel:\s*memoData\.normalizedPlatform === 'darwin'\s*\?\s*memoryPressureLabel\.value\s*:\s*formatPercent\(memoryPercent\.value\)/)
  assert.match(watch, /progressLabel:\s*formatPercent\(memoryPercent\.value\)/)
  assert.match(watch, /primaryExtra:\s*memoData\.normalizedPlatform === 'darwin'\s*\?\s*formatPercent\(memoryPercent\.value\)\s*:\s*formatGigabytesFromBytes\(getDisplayMemoryUsedBytes\(memoData\)\)/)
  assert.match(watch, /secondaryExtra:\s*memoData\.normalizedPlatform === 'darwin'\s*\?\s*`已用 \$\{formatGigabytesFromBytes\(getDisplayMemoryUsedBytes\(memoData\)\)\}`\s*:\s*'正常'/)
})
