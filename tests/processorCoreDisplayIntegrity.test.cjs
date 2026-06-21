const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('processor page uses 1-based core labels and does not backfill missing per-core speed with global speed', () => {
  const source = readSource('src/components/Processor/index.vue')

  assert.match(
    source,
    /label: `\$\{coreTypeLabel\(index, total, cpuHybridCoreCounts\.value\.performance, cpuHybridCoreCounts\.value\.efficiency\)\} \$\{index \+ 1\}`/
  )
  assert.match(source, /speed: safeNumber\(speedCores\[index\]\) \?\? null/)
  assert.doesNotMatch(source, /label: `\$\{coreTypeLabel\(index, total, cpuHybridCoreCounts\.value\.performance, cpuHybridCoreCounts\.value\.efficiency\)\} \$\{index\}`/)
  assert.doesNotMatch(source, /speed: safeNumber\(speedCores\[index\]\) \?\? currentSpeedValue\.value/)
})
