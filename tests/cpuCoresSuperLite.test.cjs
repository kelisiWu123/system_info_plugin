const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('CpuCoresSuperLiteView conforms to super-lite monitor design standards', () => {
  const superLiteSource = readProjectFile('src/components/Watch/CpuCoresSuperLiteView.vue')
  const watchViewSource = readProjectFile('src/components/Watch/CpuCoresWatchView.vue')

  // SuperLite shell dimensions and classes
  assert.match(superLiteSource, /class="super-lite-monitor super-lite-cpu-cores"/)
  assert.match(superLiteSource, /width:\s*200px/)
  assert.match(superLiteSource, /height:\s*200px/)
  assert.match(superLiteSource, /background:\s*var\(--surface-watch\)/)

  // Header and controls
  assert.match(superLiteSource, /class="super-lite-header"/)
  assert.match(superLiteSource, /super-lite-dot/)
  assert.match(superLiteSource, /class="super-lite-actions"/)
  assert.match(superLiteSource, /class="super-lite-mode-switch"/)
  assert.match(superLiteSource, /emit\('switch-standard'\)/)
  assert.match(superLiteSource, /emit\('toggle-pin'\)/)
  assert.match(superLiteSource, /emit\('close-window'\)/)

  // Summary row and micro chips
  assert.match(superLiteSource, /class="super-lite-summary-row"/)
  assert.match(superLiteSource, /class="cores-micro-grid"/)
  assert.match(superLiteSource, /'micro-chip'/)
  assert.match(superLiteSource, /micro-chip--p/)
  assert.match(superLiteSource, /class="super-lite-footer"/)
  assert.match(superLiteSource, /:title="formatCoreTooltip\(row\)"/)
  assert.match(superLiteSource, /formatCoreTooltip\(row:\s*CoreRow\)/)
  assert.match(superLiteSource, /footer-left/)
  assert.match(superLiteSource, /footer-right/)
  assert.doesNotMatch(superLiteSource, /class="footer-legend"/)

  // Integration with CpuCoresWatchView
  assert.match(watchViewSource, /import CpuCoresSuperLiteView/)
  assert.match(watchViewSource, /<CpuCoresSuperLiteView/)
  assert.match(watchViewSource, /viewMode === 'super-lite'/)
  assert.match(watchViewSource, /window\.services\?\.resizeWindow\?\.\(200,\s*200\)/)
  assert.match(watchViewSource, /window\.services\?\.resizeWindow\?\.\(360,\s*400\)/)
  assert.match(watchViewSource, /switchMode\('super-lite'\)/)
  assert.match(watchViewSource, /switchMode\('standard'\)/)
})

test('CpuCores super-lite routing and window presets are correctly wired', () => {
  const hashRoute = readProjectFile('src/utils/hashRoute.ts')
  const preload = readProjectFile('utools/preload.js')
  const windowService = readProjectFile('utools/services/window.js')
  const plugin = JSON.parse(readProjectFile('plugin.json'))

  assert.match(hashRoute, /hardwareWatchCpuCoresSuperLite/)
  assert.match(preload, /a_watch_cpu_cores_super_lite:\s*\{\s*prod:\s*\{\s*height:\s*200,\s*width:\s*200/)
  assert.match(windowService, /a_watch_cpu_cores_super_lite/)
  assert.ok(plugin.features.some((f) => f.code === 'hardwareWatchCpuCoresSuperLite'))
})
