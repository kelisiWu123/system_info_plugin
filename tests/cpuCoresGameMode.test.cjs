const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('CpuCoresGameView conforms to horizontal gaming HUD monitor standards', () => {
  const gameViewSource = readProjectFile('src/components/Watch/CpuCoresGameView.vue')
  const watchViewSource = readProjectFile('src/components/Watch/CpuCoresWatchView.vue')
  const superLiteSource = readProjectFile('src/components/Watch/CpuCoresSuperLiteView.vue')

  // Shell structure & layout (dedicated drag handle, no titlebar brand)
  assert.match(gameViewSource, /class="game-hud-monitor"/)
  assert.match(gameViewSource, /class="game-drag-handle/)
  assert.match(gameViewSource, /class="game-hud-master"/)
  assert.match(gameViewSource, /class="master-actions"/)
  assert.match(gameViewSource, /class="master-telemetry"/)
  assert.match(gameViewSource, /class="game-cores-strip"/)
  assert.match(gameViewSource, /'game-core-chip'/)
  assert.doesNotMatch(gameViewSource, /class="master-brand"/)

  // Actions & Emits (No mode switch buttons inside game mode)
  assert.doesNotMatch(gameViewSource, /emit\('switch-standard'\)/)
  assert.doesNotMatch(gameViewSource, /emit\('switch-super-lite'\)/)
  assert.match(gameViewSource, /emit\('toggle-pin'\)/)
  assert.match(gameViewSource, /emit\('close-window'\)/)

  // Core chip components & tooltips (Graphics and color only, zero text inside chips)
  assert.match(gameViewSource, /formatCoreTooltip\(row:\s*CoreRow\)/)
  assert.match(gameViewSource, /handleWheel\(e:\s*WheelEvent\)/)
  assert.match(gameViewSource, /chip--p/)
  assert.match(gameViewSource, /chip--e/)
  assert.match(gameViewSource, /freq-pip-indicator/)
  assert.match(gameViewSource, /chip-meter-fill/)
  assert.doesNotMatch(gameViewSource, /chip-label/)
  assert.doesNotMatch(gameViewSource, /chip-freq/)
  assert.doesNotMatch(gameViewSource, /chip-load-text/)

  // Integration with CpuCoresWatchView
  assert.match(watchViewSource, /import CpuCoresGameView/)
  assert.match(watchViewSource, /<CpuCoresGameView/)
  assert.match(watchViewSource, /viewMode === 'game'/)
  assert.match(watchViewSource, /switchMode\('game'\)/)
  assert.match(watchViewSource, /switchMode\('super-lite'\)/)
  assert.match(watchViewSource, /switchMode\('standard'\)/)

  // Integration with CpuCoresSuperLiteView
  assert.match(superLiteSource, /emit\('switch-game'\)/)
})

test('windowService handoff supports transitioning to and from game mode dimensions', () => {
  const windowSource = readProjectFile('utools/services/window.js')
  assert.match(windowSource, /isGameMode\s*=\s*width\s*>\s*500\s*\|\|\s*height\s*<\s*200/)
  assert.match(windowSource, /removeWindowSingletonRecord\('a_watch_cpu_cores'\)/)
})
