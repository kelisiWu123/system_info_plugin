const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('watch gpu detail load metric defines dedicated gpu sparkline styles', () => {
  const watch = readSource('src/components/Watch/index.vue')

  assert.match(watch, /label:\s*'GPU 使用率'[\s\S]*tone:\s*'gpu'/)
  assert.match(watch, /\.cpu-detail-sparkline--gpu polygon\s*{/)
  assert.match(watch, /\.cpu-detail-sparkline--gpu polyline\s*{/)
})
