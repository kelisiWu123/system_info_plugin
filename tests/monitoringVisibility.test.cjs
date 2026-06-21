const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { pathToFileURL } = require('node:url')

const { buildSync } = require('esbuild')

function loadMonitoringVisibility() {
  const outfile = path.join(
    os.tmpdir(),
    `system-info-monitoring-visibility-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`
  )

  buildSync({
    entryPoints: [path.join(__dirname, '../src/utils/monitoringVisibility.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  })

  return import(pathToFileURL(outfile).href)
}

test('resolveMonitoringBackgroundThrottled respects disabled background throttling', async () => {
  const { resolveMonitoringBackgroundThrottled } = await loadMonitoringVisibility()
  const doc = {
    hidden: true,
    visibilityState: 'hidden',
    hasFocus: () => false,
  }

  assert.equal(resolveMonitoringBackgroundThrottled(false, doc), false)
})

test('resolveMonitoringBackgroundThrottled detects hidden or unfocused documents', async () => {
  const { resolveMonitoringBackgroundThrottled } = await loadMonitoringVisibility()

  assert.equal(resolveMonitoringBackgroundThrottled(true, {
    hidden: true,
    visibilityState: 'hidden',
    hasFocus: () => true,
  }), true)

  assert.equal(resolveMonitoringBackgroundThrottled(true, {
    hidden: false,
    visibilityState: 'visible',
    hasFocus: () => false,
  }), true)

  assert.equal(resolveMonitoringBackgroundThrottled(true, {
    hidden: false,
    visibilityState: 'visible',
    hasFocus: () => true,
  }), false)
})

test('bindMonitoringVisibilityListeners binds focus, blur, and visibilitychange only once', async () => {
  const { bindMonitoringVisibilityListeners } = await loadMonitoringVisibility()
  const calls = []
  const win = {
    addEventListener: (event, listener) => calls.push(['window', event, listener]),
  }
  const doc = {
    addEventListener: (event, listener) => calls.push(['document', event, listener]),
  }
  let bound = false
  let updates = 0

  bound = bindMonitoringVisibilityListeners(bound, () => {
    updates += 1
  }, win, doc)
  bound = bindMonitoringVisibilityListeners(bound, () => {
    updates += 1
  }, win, doc)

  assert.equal(bound, true)
  assert.deepEqual(calls.map(([target, event]) => `${target}:${event}`), [
    'window:focus',
    'window:blur',
    'document:visibilitychange',
  ])

  calls[0][2]()
  assert.equal(updates, 1)
})
