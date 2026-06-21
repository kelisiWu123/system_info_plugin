const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('standard watch header uses symmetric side tracks so monitor tabs stay visually centered', () => {
  const watch = readSource('src/components/Watch/index.vue')

  assert.match(watch, /\.monitor-shell__header\s*{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+minmax\(0,\s*1fr\)/)
  assert.match(watch, /\.monitor-shell__brand\s*{[\s\S]*justify-self:\s*start/)
  assert.match(watch, /\.monitor-shell__actions\s*{[\s\S]*justify-self:\s*end/)
})

test('super-lite watch exposes the standard-mode switch in the header actions instead of the footer', () => {
  const superLite = readSource('src/components/Watch/SuperLiteMonitorView.vue')

  assert.match(superLite, /<div class="super-lite-actions">[\s\S]*title="切回标准模式"[\s\S]*emit\('switch-standard'\)/)
  assert.doesNotMatch(superLite, /<footer class="super-lite-footer">[\s\S]*切回标准模式/)
})

test('super-lite watch exposes a close control wired to the shared closeWindow handler', () => {
  const watch = readSource('src/components/Watch/index.vue')
  const superLite = readSource('src/components/Watch/SuperLiteMonitorView.vue')

  assert.match(superLite, /title="关闭窗口"[\s\S]*emit\('close-window'\)/)
  assert.match(watch, /function closeWindow\(\)\s*{[\s\S]*window\.services\.closeWindow\(\)/)
  assert.match(watch, /<SuperLiteMonitorView[\s\S]*@close-window="closeWindow"/)
})
