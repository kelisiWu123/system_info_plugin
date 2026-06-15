const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('plugin.json exposes an independent super-lite watch entry', () => {
  const plugin = JSON.parse(readSource('plugin.json'))
  const feature = plugin.features.find((item) => item.code === 'hardwareWatchSuperLite')

  assert.ok(feature)
  assert.equal(feature.explain, '超级轻量硬件监控')
  assert.deepEqual(feature.cmds, ['超级轻量监控', '轻量监控', '硬件轻量监控'])
})

test('preload maps hardwareWatchSuperLite to a 200x200 watch preset', () => {
  const source = readSource('utools/preload.js')

  assert.match(source, /a_watch_super_lite:\s*{[\s\S]*prod:\s*{\s*height:\s*200,\s*width:\s*200,\s*backgroundColor:\s*0\s*}/)
  assert.match(source, /hardwareWatchSuperLite:\s*{[\s\S]*openPresetWindow\('a_watch_super_lite'\)/)
})

test('window service treats a_watch_super_lite as a watch window and passes launch query', () => {
  const source = readSource('utools/services/window.js')

  assert.match(source, /\['a_watch',\s*'watch',\s*'a_watch_super_lite'\]\.includes\(fileName\)/)
  assert.match(source, /floatingMode=super-lite/)
  assert.match(source, /entry=hardwareWatchSuperLite/)
  assert.match(source, /transparent:\s*isWatchWindow/)
  assert.match(source, /alwaysOnTop:\s*isWatchWindow/)
})

test('build script generates a super-lite watch alias rather than a second app', () => {
  const source = readSource('scripts/generate-utools-entry-pages.mjs')

  assert.match(source, /\['a_watch_super_lite',\s*'watch\?floatingMode=super-lite&entry=hardwareWatchSuperLite'\]/)
  assert.doesNotMatch(source, /super-lite\.html/)
})

test('App parses watch query parameters and passes initial floating mode into Watch', () => {
  const app = readSource('src/App.vue')
  const watch = readSource('src/components/Watch/index.vue')

  assert.match(app, /resolvePageName/)
  assert.match(app, /resolveInitialFloatingMode/)
  assert.match(app, /<Watch[\s\S]*:initial-floating-mode="initialFloatingMode"/)
  assert.match(watch, /initialFloatingMode\?:\s*'standard' \| 'super-lite'/)
  assert.match(watch, /data-floating-mode/)
})
