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
