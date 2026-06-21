const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { pathToFileURL } = require('node:url')

const { buildSync } = require('esbuild')

function loadUtils() {
  const outfile = path.join(
    os.tmpdir(),
    `system-info-utils-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`
  )

  buildSync({
    entryPoints: [path.join(__dirname, '../src/utils.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  })

  return import(pathToFileURL(outfile).href)
}

test('prefers installed memory capacity when layout slots provide concrete module sizes', async () => {
  const {
    getInstalledMemoryBytes,
    getDisplayMemoryCapacityBytes,
    getDisplayMemoryCapacityLabel,
  } = await loadUtils()

  const layout = [
    { size: 16 * 1024 ** 3 },
    { size: 16 * 1024 ** 3 },
    { size: 0 },
  ]

  assert.equal(getInstalledMemoryBytes(layout), 32 * 1024 ** 3)
  assert.equal(getDisplayMemoryCapacityBytes(layout, { total: 31.3 * 1024 ** 3 }), 32 * 1024 ** 3)
  assert.equal(getDisplayMemoryCapacityLabel(layout), '已安装容量')
})

test('falls back to system-visible memory total when layout sizes are unavailable', async () => {
  const {
    getInstalledMemoryBytes,
    getDisplayMemoryCapacityBytes,
    getDisplayMemoryCapacityLabel,
  } = await loadUtils()

  const layout = [
    { size: 0 },
    { size: null },
  ]
  const total = 31.3 * 1024 ** 3

  assert.equal(getInstalledMemoryBytes(layout), 0)
  assert.equal(getDisplayMemoryCapacityBytes(layout, { total }), total)
  assert.equal(getDisplayMemoryCapacityLabel(layout), '系统可见总量')
})
