const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('keeps platform information in overview while removing repeated page-level platform display', () => {
  const overview = readSource('src/components/Computer/index.vue')
  const processor = readSource('src/components/Processor/index.vue')
  const graphics = readSource('src/components/GraphicsPage/index.vue')
  const memory = readSource('src/components/MemoryPage/index.vue')
  const board = readSource('src/components/BoardPage/index.vue')

  assert.match(overview, /label:\s*'操作系统'/)

  assert.doesNotMatch(processor, /<h3>平台信息<\/h3>/)
  assert.doesNotMatch(graphics, /<h3>平台信息<\/h3>/)
  assert.doesNotMatch(memory, /label:\s*'操作系统'/)
  assert.doesNotMatch(board, /label:\s*'操作系统'/)
})
