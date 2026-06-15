const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { pathToFileURL } = require('node:url')

const { buildSync } = require('esbuild')

function loadHashRouteUtils() {
  const outfile = path.join(
    os.tmpdir(),
    `system-info-hash-route-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`
  )

  buildSync({
    entryPoints: [path.join(__dirname, '../src/utils/hashRoute.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  })

  return import(pathToFileURL(outfile).href)
}

test('resolves watch hashes with query parameters as the watch page', async () => {
  const { resolvePageName } = await loadHashRouteUtils()

  assert.equal(resolvePageName('#watch'), 'watch')
  assert.equal(resolvePageName('#watch?floatingMode=super-lite&entry=hardwareWatchSuperLite'), 'watch')
  assert.equal(resolvePageName('#computer'), 'computer')
})

test('resolves initial floating mode from watch query parameters', async () => {
  const { resolveInitialFloatingMode } = await loadHashRouteUtils()

  assert.equal(
    resolveInitialFloatingMode('#watch?floatingMode=super-lite&entry=hardwareWatchSuperLite'),
    'super-lite'
  )
  assert.equal(resolveInitialFloatingMode('#watch'), 'standard')
})

test('resolves the explicit floating monitor launch entry', async () => {
  const { resolveInitialFloatingEntry } = await loadHashRouteUtils()

  assert.equal(
    resolveInitialFloatingEntry('#watch?floatingMode=super-lite&entry=hardwareWatchSuperLite'),
    'hardwareWatchSuperLite'
  )
  assert.equal(
    resolveInitialFloatingEntry('#watch?floatingMode=standard&entry=hardwareWatch'),
    'hardwareWatch'
  )
  assert.equal(resolveInitialFloatingEntry('#watch'), 'unknown')
})
