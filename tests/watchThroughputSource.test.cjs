const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('standard and super-lite watch surfaces both expose compact network and disk throughput', () => {
  const watch = readProjectFile('src/components/Watch/index.vue')
  const superLite = readProjectFile('src/components/Watch/SuperLiteMonitorView.vue')

  assert.match(watch, /class="overview-throughput-strip"/)
  assert.match(watch, />网络</)
  assert.match(watch, />磁盘 I\/O</)
  assert.match(watch, /formatSpeed\(networkStatus\.rxSec\)/)
  assert.match(watch, /formatSpeed\(networkStatus\.txSec\)/)
  assert.match(watch, /formatSpeed\(storageIoData\.readBytesPerSec\)/)
  assert.match(watch, /formatSpeed\(storageIoData\.writeBytesPerSec\)/)
  assert.match(watch, /:throughput="superLiteThroughput"/)
  assert.match(superLite, /class="super-lite-throughput"/)
  assert.match(superLite, />NET</)
  assert.match(superLite, />DISK</)
  assert.match(superLite, /throughput\.networkDown/)
  assert.match(superLite, /throughput\.networkUp/)
  assert.match(superLite, /throughput\.diskRead/)
  assert.match(superLite, /throughput\.diskWrite/)
})

test('watch polls throughput for overview or super-lite but not standard CPU and GPU detail tabs', () => {
  const watch = readProjectFile('src/components/Watch/index.vue')

  assert.match(watch, /const needsThroughputMetrics = floatingMode\.value === 'super-lite' \|\| monitorMode\.value === 'overview'/)
  assert.match(watch, /needsThroughputMetrics \? withTimeout\(window\.services\.getNetworkStatus\(\), 3500\)/)
  assert.match(watch, /needsThroughputMetrics \? withTimeout\(window\.services\.getStorageIo\(\), 3500\)/)
  assert.match(watch, /if \(needsThroughputMetrics && networkStatusRes\.status === 'fulfilled'/)
  assert.match(watch, /if \(needsThroughputMetrics && storageIoRes\.status === 'fulfilled'/)
  assert.match(watch, /const needsImmediateThroughputRefresh = mode === 'super-lite' \|\| monitorMode\.value === 'overview'/)
})

test('watch and storage page share the same byte-rate formatter and footer reports the real poll interval', () => {
  const watch = readProjectFile('src/components/Watch/index.vue')
  const storage = readProjectFile('src/components/StoragePage/index.vue')
  const utils = readProjectFile('src/utils.ts')

  assert.match(utils, /function formatSpeed\(bytesPerSecond: number \| null \| undefined\)/)
  assert.match(watch, /import[\s\S]*formatSpeed,[\s\S]*from '\.\.\/\.\.\/utils'/)
  assert.match(storage, /import \{[^\n]*formatSpeed[^\n]*\} from '\.\.\/\.\.\/utils'/)
  assert.doesNotMatch(storage, /function formatTransferRate/)
  assert.match(watch, /更新频率 \{\{ standardRefreshLabel \}\}/)
  assert.doesNotMatch(watch, /更新频率 1s/)
})

test('standard overview reserves stable space for three metric cards and keeps progress bars away from card edges', () => {
  const watch = readProjectFile('src/components/Watch/index.vue')
  const watchRow = readProjectFile('src/components/Watch/WatchRow/index.vue')

  assert.match(watch, /monitor-shell__body monitor-shell__body--overview/)
  assert.match(watch, /grid-template-rows:\s*repeat\(3, minmax\(0, 1fr\)\) 42px/)
  assert.match(watch, /\.metric-sparkline\s*\{[\s\S]*height:\s*40px/)
  assert.match(watch, /\.metric-progress\s*\{[\s\S]*height:\s*7px/)
  assert.match(watchRow, /padding:\s*7px 10px/)
  assert.match(watchRow, /row-gap:\s*3px/)
})
