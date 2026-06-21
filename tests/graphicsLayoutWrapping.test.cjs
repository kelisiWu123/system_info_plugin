const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('graphics page prevents status pills and display output chips from awkward wrapping', () => {
  const source = readSource('src/components/GraphicsPage/index.vue')

  assert.match(source, /\.status-pill\s*{[\s\S]*white-space:\s*nowrap;/)
  assert.match(source, /\.status-pill\s*{[\s\S]*flex-shrink:\s*0;/)
  assert.match(source, /\.port-grid\s*{[\s\S]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(120px,\s*1fr\)\);/)
  assert.match(source, /\.port-chip\s*{[\s\S]*min-width:\s*0;/)
  assert.match(source, /\.port-chip\s*{[\s\S]*strong\s*{[\s\S]*line-height:\s*1\.25;/)
})
