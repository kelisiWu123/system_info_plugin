const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { pathToFileURL } = require('node:url')

const { buildSync } = require('esbuild')

function loadServiceReader() {
  const outfile = path.join(
    os.tmpdir(),
    `system-info-service-reader-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`
  )

  buildSync({
    entryPoints: [path.join(__dirname, '../src/utils/serviceReader.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  })

  return import(pathToFileURL(outfile).href)
}

test('readService retries failed readers and returns the successful value', async () => {
  const { readService } = await loadServiceReader()
  let attempts = 0

  const value = await readService(async () => {
    attempts += 1
    if (attempts < 2) throw new Error('temporary failure')
    return 'ok'
  }, 50, 1)

  assert.equal(value, 'ok')
  assert.equal(attempts, 2)
})

test('withTimeout rejects slow promises with the standard timeout message', async () => {
  const { withTimeout, normalizeErrorMessage } = await loadServiceReader()

  await assert.rejects(
    withTimeout(new Promise(() => {}), 1),
    (error) => normalizeErrorMessage(error) === '读取超时'
  )
})

test('normalizeErrorMessage handles Error, string, and unknown values', async () => {
  const { normalizeErrorMessage } = await loadServiceReader()

  assert.equal(normalizeErrorMessage(new Error('boom')), 'boom')
  assert.equal(normalizeErrorMessage('plain'), 'plain')
  assert.equal(normalizeErrorMessage({}), '未知错误')
})
