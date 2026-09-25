const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('every plugin feature has a preload export, window preset, hash route, and packaged entry', () => {
  const plugin = JSON.parse(readProjectFile('plugin.json'))
  const preload = readProjectFile('utools/preload.js')
  const windowService = readProjectFile('utools/services/window.js')
  const entryBuilder = readProjectFile('scripts/generate-utools-entry-pages.mjs')

  const entries = [
    { code: 'hardware', preset: 'a_computer', hash: 'computer', entry: "['a_computer', 'computer']" },
    { code: 'hardwareWatch', preset: 'a_monitor', hash: 'monitor', entry: "['a_monitor', 'monitor']" },
    { code: 'hardwareWatchSuperLite', preset: 'a_watch_super_lite', hash: 'floatingMode=super-lite&entry=hardwareWatchSuperLite', entry: "['a_watch_super_lite', 'watch?floatingMode=super-lite&entry=hardwareWatchSuperLite']" },
    { code: 'hardwareSpecsLite', preset: 'a_specs_lite', hash: 'deviceSpecs', entry: "['a_specs_lite', 'deviceSpecs']" },
    { code: 'hardwareMenubarSettings', preset: 'a_menubar_settings', hash: 'menubarSettings', entry: "['a_menubar_settings', 'menubarSettings']" },
    { code: 'hardwareWatchCpuCores', preset: 'a_watch_cpu_cores', hash: 'cpuCoresWatch', entry: "['a_watch_cpu_cores', 'cpuCoresWatch']" },
  ]

  assert.deepEqual(plugin.features.map((feature) => feature.code), entries.map((entry) => entry.code))

  for (const entry of entries) {
    assert.match(preload, new RegExp(`${entry.code}:\\s*\\{[\\s\\S]*openPresetWindow\\('${entry.preset}'\\)`), entry.code)
    assert.match(preload, new RegExp(`${entry.preset}:\\s*\\{`), entry.preset)
    assert.match(windowService, new RegExp(`getWindowHash[\\s\\S]*${entry.hash.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), entry.code)
    assert.match(entryBuilder, new RegExp(entry.entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), entry.code)
  }
})
