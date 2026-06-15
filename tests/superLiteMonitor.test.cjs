const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { pathToFileURL } = require('node:url')
const { buildSync } = require('esbuild')

function loadSuperLiteMonitor() {
  const outfile = path.join(os.tmpdir(), `super-lite-monitor-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`)

  buildSync({
    entryPoints: [path.join(__dirname, '../src/utils/superLiteMonitor.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  })

  return import(pathToFileURL(outfile).href)
}

test('resolveSuperLiteOverallStatus promotes warning and danger thresholds', async () => {
  const { resolveSuperLiteOverallStatus } = await loadSuperLiteMonitor()

  assert.deepEqual(resolveSuperLiteOverallStatus({ cpuUsage: 10, gpuUsage: 20, memoryUsage: 40 }), {
    level: 'normal',
    label: '良好',
  })
  assert.deepEqual(resolveSuperLiteOverallStatus({ cpuUsage: 85, gpuUsage: 20, memoryUsage: 40 }), {
    level: 'warning',
    label: '注意',
  })
  assert.deepEqual(resolveSuperLiteOverallStatus({ cpuUsage: 20, gpuTemperature: 95, memoryUsage: 40 }), {
    level: 'danger',
    label: '高温',
  })
  assert.deepEqual(resolveSuperLiteOverallStatus({ cpuUsage: 20, gpuUsage: 20, memoryUsage: 95 }), {
    level: 'danger',
    label: '内存紧张',
  })
})

test('formatSuperLiteRefreshLabel uses the active poll interval', async () => {
  const { formatSuperLiteRefreshLabel } = await loadSuperLiteMonitor()

  assert.equal(formatSuperLiteRefreshLabel(2500), '↻2.5s')
  assert.equal(formatSuperLiteRefreshLabel(1000), '↻1s')
  assert.equal(formatSuperLiteRefreshLabel(0), '↻--')
})
