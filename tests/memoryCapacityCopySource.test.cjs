const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('memory-related surfaces avoid ambiguous system total wording and keep installed capacity as the primary total', () => {
  const memoryPage = readSource('src/components/MemoryPage/index.vue')
  const overview = readSource('src/components/Computer/index.vue')
  const watch = readSource('src/components/Watch/index.vue')
  const specsLite = readSource('src/components/DeviceSpecsLite/index.vue')

  assert.doesNotMatch(memoryPage, /系统总量/)
  assert.match(memoryPage, /系统可见总量/)
  assert.match(memoryPage, /已安装容量/)

  assert.doesNotMatch(overview, /系统总量/)
  assert.match(overview, /系统可见总量/)

  assert.match(watch, /已装|可见/)
  assert.match(specsLite, /getDisplayMemoryCapacityBytes|getInstalledMemoryBytes/)
})
