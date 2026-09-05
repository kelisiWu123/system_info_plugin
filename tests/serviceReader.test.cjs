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

test('withTimeout clears its pending timer when the service settles early', async () => {
  const { withTimeout } = await loadServiceReader()
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout
  let scheduledTimer
  let clearedTimer

  globalThis.setTimeout = (handler, delay, ...args) => {
    scheduledTimer = originalSetTimeout(handler, delay, ...args)
    return scheduledTimer
  }
  globalThis.clearTimeout = (timer) => {
    clearedTimer = timer
    return originalClearTimeout(timer)
  }

  try {
    assert.equal(await withTimeout(Promise.resolve('ok'), 1000), 'ok')
    assert.equal(clearedTimer, scheduledTimer)
  } finally {
    globalThis.setTimeout = originalSetTimeout
    globalThis.clearTimeout = originalClearTimeout
  }
})

test('normalizeErrorMessage handles Error, string, and unknown values', async () => {
  const { normalizeErrorMessage } = await loadServiceReader()

  assert.equal(normalizeErrorMessage(new Error('boom')), 'boom')
  assert.equal(normalizeErrorMessage('plain'), 'plain')
  assert.equal(normalizeErrorMessage({}), '未知错误')
})

test('getServiceErrorDescription keeps technical errors actionable without losing raw diagnostics in stores', async () => {
  const { getServiceErrorDescription } = await loadServiceReader()
  const fallback = '读取主板信息时发生异常，可以重试该模块。'

  assert.equal(
    getServiceErrorDescription('Cannot read properties of undefined', fallback),
    '插件运行环境暂未就绪，请关闭后重新打开插件再试。'
  )
  assert.equal(
    getServiceErrorDescription('permission denied', fallback),
    '没有读取此信息的系统权限，请检查授权后重试。'
  )
  assert.equal(
    getServiceErrorDescription('读取超时', fallback),
    `${fallback} 本次读取超时，请稍后重试。`
  )
  assert.equal(getServiceErrorDescription('backend unavailable', fallback), fallback)
})
