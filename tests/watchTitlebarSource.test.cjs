const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('standard watch titlebar keeps the shared single H brand without extra product text', () => {
  const watch = readSource('src/components/Watch/index.vue')

  assert.match(watch, /<div class="monitor-shell__brand">\s*<div class="monitor-shell__brand-mark">H<\/div>\s*<\/div>/)
  assert.doesNotMatch(watch, /HWInfoX Monitor/)
})
