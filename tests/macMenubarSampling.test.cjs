const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const sourcePath = path.join(__dirname, '../utools/services/system.js')
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, allowJs: true },
  fileName: sourcePath,
}).outputText

test('preload handles plugin termination in every window type while opening a page only hides the launcher', async () => {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../utools/preload.js'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, allowJs: true },
  }).outputText
  for (const windowType of ['main', 'detach', 'browser']) {
    let onOut
    let stopped = 0
    let opened = 0
    const runtime = {
      isDev: () => false,
      getWindowType: () => windowType,
      onPluginOut: (callback) => { onOut = callback },
      outPlugin: (isKill) => { assert.notEqual(isKill, true); onOut(false) },
    }
    const fakeRequire = (id) => {
      if (id === './runtime') return { resolveUtoolsRuntime: () => runtime, getUtoolsPluginRoot: () => '/plugin' }
      if (id === './services/system') return {
        configureSystemServiceContext() {}, systemService: { stopMacMenubarRuntime: () => { stopped++ } },
      }
      if (id === './services/window') return {
        setupWindowBridge() {}, windowService: { createWindow: async () => { opened++ } },
      }
      throw new Error(`Unexpected import: ${id}`)
    }
    const window = {}
    new Function('require', 'exports', 'window', 'utools', '__dirname', code)(fakeRequire, {}, window, runtime, '/plugin')
    await window.exports.hardware.args.enter()
    assert.equal(opened, 1)
    assert.equal(stopped, 0)
    onOut(true)
    assert.equal(stopped, 1, `${windowType} must not ignore plugin termination`)
  }
})

function createHarness(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hwinfox-sampling-test-'))
  t.after(() => {
    try {
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    } catch {
      // ignore cleanup error on Windows temp
    }
  })
  const alive = new Set()
  const writes = []
  const starts = []
  let running = false
  let settings = { enabled: true, metrics: {
    cpuTemperature: true, cpuLoad: false, cpuFrequency: false,
    fanSpeed: false, memoryUsage: true, diskIo: true, networkIo: true,
  } }
  function load(pid) {
    alive.add(pid)
    const mockRequire = (id) => {
      if (id === 'node:os') return { default: { ...os, tmpdir: () => directory } }
      if (id === 'node:fs') return { default: fs }
      if (id === 'node:path') return { default: path }
      if (id === 'systeminformation') return { default: {} }
      if (id === './macSensors.cjs') return { default: {} }
      if (id === './windowsSensorHelper') return {}
      if (id === './windowsTrayHelper') return {}
      if (id === './macMenubarHelper') return {
        getMacMenubarStatus: () => ({ running }),
        startMacMenubarHelper: () => { running = true; starts.push(pid) },
        stopMacMenubarHelper: () => { running = false; return { ok: true } },
        updateMacMenubarTelemetry: (value) => writes.push({ pid, value }),
      }
      return require(id)
    }
    const module = { exports: {} }
    const runtime = { dbStorage: {
      getItem: (key) => key === 'macosMenubarSettings' ? settings : undefined,
      setItem: (key, value) => { if (key === 'macosMenubarSettings') settings = value },
    } }
    const mockProcess = { pid, platform: 'darwin', kill(target) {
      if (!alive.has(target)) throw Object.assign(new Error('gone'), { code: 'ESRCH' })
    } }
    new Function('require', 'module', 'exports', '__dirname', 'process', 'utools', 'setInterval', 'clearInterval', compiled)(
      mockRequire, module, module.exports, path.dirname(sourcePath), mockProcess, runtime,
      () => ({ unref() {} }), () => {},
    )
    const api = module.exports
    const service = api.systemService
    // Reproduce reader side effects in separate preload contexts.
    for (const [name, value] of Object.entries({
      getCpuTemperature: { value: 59.5 }, getCpuFullLoad: 0,
      getCpuCurrentSpeed: { max: 3.2 }, getCpuFanSpeed: { value: 0 },
      getMemInfo: { used: 6, total: 10 },
      getStorageIo: { readBytesPerSec: 1234, writeBytesPerSec: 0 },
      getNetworkStatus: { rxSec: 4321, txSec: 0 },
    })) {
      service[name] = async () => { api.syncMacMenubarTelemetry(); return value }
    }
    return api
  }
  return { load, writes, starts, alive, directory }
}

test('two preload contexts cannot overwrite a complete tray snapshot with partial page data', async (t) => {
  const h = createHarness(t)
  const owner = h.load(4101)
  const page = h.load(4102)
  await owner.refreshMacMenubarTelemetry()
  assert.equal(h.writes.length, 1, 'one write per complete batch')
  assert.equal(h.writes[0].value.temp, 59.5)
  assert.equal(h.writes[0].value.diskReadBytesPerSec, 1234)
  assert.equal(h.writes[0].value.diskWriteBytesPerSec, 0)
  await page.systemService.getMemInfo()
  await page.systemService.getNetworkStatus()
  await page.refreshMacMenubarTelemetry()
  page.syncMacMenubarTelemetry({ temp: null })
  assert.equal(h.writes.length, 1, 'non-owner page must never publish')
  await owner.refreshMacMenubarTelemetry()
  assert.equal(h.writes.length, 2)
  assert.deepEqual(h.starts, [4101], 'sampling does not restart the helper')
})

test('slow metrics and concurrent refresh requests produce one complete snapshot', async (t) => {
  const h = createHarness(t)
  const owner = h.load(4101)
  let finish
  owner.systemService.getCpuTemperature = () => new Promise((resolve) => { finish = resolve })
  const pending = owner.refreshMacMenubarTelemetry()
  await owner.refreshMacMenubarTelemetry()
  await owner.systemService.getMemInfo()
  assert.equal(h.writes.length, 0, 'no intermediate snapshot while temperature is pending')
  finish({ value: 60 })
  await pending
  assert.equal(h.writes.length, 1)
  assert.equal(h.writes[0].value.temp, 60)
  assert.equal(h.writes[0].value.memoryPercent, 60)
})

test('a delayed heartbeat cannot cause another live renderer to take over', async (t) => {
  const h = createHarness(t)
  const owner = h.load(4101)
  const page = h.load(4102)
  await owner.refreshMacMenubarTelemetry()
  const recordPath = path.join(h.directory, 'system-info-plugin/macos-menubar/scheduler.json')
  const record = JSON.parse(fs.readFileSync(recordPath))
  fs.writeFileSync(recordPath, JSON.stringify({ ...record, heartbeat: 1 }))
  await page.refreshMacMenubarTelemetry()
  assert.equal(h.writes.length, 1)
})

test('real metric failures become unavailable without clearing successful metrics', async (t) => {
  const h = createHarness(t)
  const owner = h.load(4101)
  await owner.refreshMacMenubarTelemetry()
  owner.systemService.getCpuTemperature = async () => { throw new Error('sensor unavailable') }
  await owner.refreshMacMenubarTelemetry()
  assert.equal(h.writes[1].value.temp, null, 'do not keep an old temperature indefinitely')
  assert.equal(h.writes[1].value.diskReadBytesPerSec, 1234)
  assert.equal(h.writes[1].value.memoryPercent, 60)
})

test('ending the plugin during a pending sample cannot restart its tray', async (t) => {
  const h = createHarness(t)
  const owner = h.load(4101)
  const page = h.load(4102)
  let finish
  owner.systemService.getCpuTemperature = () => new Promise((resolve) => { finish = resolve })
  const pending = owner.refreshMacMenubarTelemetry()
  page.stopMacMenubarRuntime()
  finish({ value: 60 })
  await pending
  await page.refreshMacMenubarTelemetry()
  assert.equal(h.writes.length, 0)
  assert.equal(h.starts.length, 0)
})
