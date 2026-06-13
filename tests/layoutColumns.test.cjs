const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { pathToFileURL } = require('node:url')

const { buildSync } = require('esbuild')

function loadLayoutUtils() {
  const outfile = path.join(
    os.tmpdir(),
    `system-info-layout-utils-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`
  )

  buildSync({
    entryPoints: [path.join(__dirname, '../src/utils/layout.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  })

  return import(pathToFileURL(outfile).href)
}

test('splits overview detail rows evenly into three columns while preserving order', async () => {
  const { splitItemsIntoColumns } = await loadLayoutUtils()

  assert.deepEqual(
    splitItemsIntoColumns(['system', 'uptime', 'display', 'cpu', 'memory', 'gpu', 'storage'], 3),
    [
      ['system', 'cpu', 'storage'],
      ['uptime', 'memory'],
      ['display', 'gpu'],
    ]
  )
})

test('returns a single column when the requested count is invalid', async () => {
  const { splitItemsIntoColumns } = await loadLayoutUtils()

  assert.deepEqual(splitItemsIntoColumns(['a', 'b'], 0), [['a', 'b']])
})
