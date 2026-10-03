const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

function load(relativePath, imports = {}, window = {}, document) {
  const source = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const exports = {}
  new Function('require', 'exports', 'window', 'document', compiled)(
    (id) => imports[id] ?? require(id), exports, window, document,
  )
  return exports
}
const metric = load('src/utils/metricRefresh.ts')
const utils = {
  clampPercent: (value) => Math.max(0, Math.min(100, value)),
  getDisplayMemoryUsagePercent: (data) => data.total ? data.used / data.total * 100 : 0,
  getStorageUsageSummary: () => ({ percent: 0, total: 0, used: 0 }),
}
const monitoring = load('src/utils/monitoring.ts', { './metricRefresh': metric, '../utils': utils })

test('shared sample history ignores duplicate and older samples but retains equal-valued new samples', () => {
  const history = []
  monitoring.appendMetricHistory(history, 20, false, 24, 100)
  monitoring.appendMetricHistory(history, 25, false, 24, 100)
  monitoring.appendMetricHistory(history, 30, false, 24, 99)
  monitoring.appendMetricHistory(history, 20, false, 24, 101)
  assert.deepEqual(history, [20, 20])
  history.length = 0
  monitoring.appendMetricHistory(history, 40, false, 24, 100)
  assert.deepEqual(history, [40], 'clearing history resets the observation stream')
})

test('dashboard applies fast CPU data while a slow temperature reader is still pending', async () => {
  let finishTemperature
  const sampledAt = Date.now() - 2000
  const window = { services: {
    getCpuLoadData: async () => ({ currentLoad: 42, cpus: [], sampledAt }),
    getCpuTemperature: () => new Promise((resolve) => { finishTemperature = resolve }),
    getGpuInfo: async () => [], getMemInfo: async () => ({ total: 100, used: 20, sampledAt }),
    getDiskData: async () => [], getStorageIo: async () => ({ readBytesPerSec: 0, writeBytesPerSec: 0 }),
    getNetworkStatus: async () => ({ rxSec: 0, txSec: 0 }), getTopProcesses: async () => [],
    getTimeInfo: async () => ({}),
  } }
  const store = load('src/composables/useMonitorDashboardData.ts', {
    '../utils/metricRefresh': metric, '../utils/monitoring': monitoring, '../utils': utils,
    '../utils/gpu': { selectPrimaryGpu: () => undefined },
    '../utils/monitoringVisibility': { resolveMonitoringBackgroundThrottled: () => false },
    '../utils/serviceReader': { readService: (reader) => reader(), normalizeErrorMessage: String },
  }, window)
  let finished = false
  const refresh = store.refreshMonitorDashboardData().then(() => { finished = true })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(finished, false)
  assert.equal(store.monitorDashboardStore.cpuLoad.value, 42)
  assert.equal(store.monitorDashboardStore.telemetryStatus.cpuLoad.lastSuccessAt, sampledAt)
  assert.deepEqual([...store.monitorDashboardStore.metricHistory.cpuLoad], [42])
  finishTemperature({ value: 55, sampledAt })
  await refresh
  assert.equal(store.monitorDashboardStore.cpuTemperature.value.value, 55)
  assert.equal(store.monitorDashboardStore.telemetryStatus.cpuLoad.lastSuccessAt, sampledAt,
    'slow completion must not make the earlier CPU sample appear newly sampled')
})

test('failed readers keep their rejection while successful readers apply immediately', async () => {
  const values = []
  const results = await Promise.all([
    metric.settleMetric(Promise.reject(new Error('unavailable')), (result) => values.push(result.status)),
    metric.settleMetric(Promise.resolve(1), (result) => values.push(result.status)),
  ])
  assert.deepEqual(values.sort(), ['fulfilled', 'rejected'])
  assert.equal(results[0].reason.message, 'unavailable')
})

test('subscription deduplicates one commit but accepts a successor commit with the same clock time', () => {
  let notify
  let stopped = false
  const api = load('src/utils/metricRefresh.ts', {}, { services: {
    subscribeHardwareTelemetry: (keys, listener) => {
      assert.deepEqual(keys, ['cpuLoad'])
      notify = listener
      return () => { stopped = true }
    },
  } })
  const values = []
  const stop = api.subscribeHardwareMetrics({ cpuLoad: (value) => values.push(value.currentLoad) })
  const record = { status: 'ok', checkedAt: 100, sampledAt: 100, sampleId: 'owner:1', value: { currentLoad: 20 } }
  notify({ cpuLoad: record })
  notify({ cpuLoad: record })
  notify({ cpuLoad: { ...record, sampleId: 'successor:1', value: { currentLoad: 30 } } })
  assert.deepEqual(values, [20, 30])
  stop()
  assert.equal(stopped, true)
})

test('a delayed older poll cannot overwrite a newer shared sample', () => {
  assert.equal(metric.isOlderMetricSample({ sampledAt: 100 }, { sampledAt: 200 }), true)
  assert.equal(metric.isOlderMetricSample({ sampledAt: 200 }, { sampledAt: 200 }), false)
  assert.equal(metric.isOlderMetricSample([{ sampledAt: 100 }], [{ sampledAt: 200 }]), true)
})

test('dashboard error summary recovers immediately and older metric updates do not rewind the sync time', async () => {
  let handlers
  let onError
  const window = { setTimeout: () => 1, clearTimeout() {}, services: {
    getCpuLoadData: async () => ({ currentLoad: 20, cpus: [] }),
    getCpuTemperature: async () => ({ value: 45 }), getGpuInfo: async () => [],
    getMemInfo: async () => ({ total: 100, used: 20 }), getDiskData: async () => [],
    getStorageIo: async () => ({ readBytesPerSec: 0, writeBytesPerSec: 0 }),
    getNetworkStatus: async () => ({ rxSec: 0, txSec: 0 }), getTopProcesses: async () => [],
    getTimeInfo: async () => ({}), getCpuInfo: async () => ({}),
    getDiskLayout: async () => [], getOsInfo: async () => ({ platform: 'darwin' }),
  } }
  const api = load('src/composables/useMonitorDashboardData.ts', {
    '../utils/metricRefresh': { ...metric, subscribeHardwareMetrics: (success, failure) => {
      handlers = success; onError = failure; return () => {}
    } },
    '../utils/monitoring': monitoring, '../utils': utils,
    '../utils/gpu': { selectPrimaryGpu: () => undefined },
    '../utils/monitoringVisibility': { resolveMonitoringBackgroundThrottled: () => false, bindMonitoringVisibilityListeners: () => true },
    '../utils/serviceReader': { readService: (reader) => reader(), normalizeErrorMessage: String },
  }, window)
  await api.activateMonitorDashboard()
  onError('cpuLoad', 'temporarily unavailable')
  assert.equal(api.monitorDashboardStore.lastError.value, 'CPU 使用率')
  const at = Date.now() + 1000
  handlers.cpuLoad({ currentLoad: 21, cpus: [], sampledAt: at }, at)
  assert.equal(api.monitorDashboardStore.lastError.value, '')
  handlers.cpuTemperature({ value: 46, sampledAt: at - 500 }, at - 500)
  assert.equal(api.monitorDashboardStore.lastSyncedAt.value, at)
  api.deactivateMonitorDashboard()
})

test('unsupported sensors, valid zero values and temperature fallback use a consistent availability rule', () => {
  assert.equal(metric.getHardwareMetricState('cpuTemperature', { source: 'unsupported', value: 55 }).status, 'missing')
  assert.equal(metric.getHardwareMetricState('cpuTemperature', { value: null, main: 42 }).status, 'ok')
  assert.equal(metric.getHardwareMetricState('cpuTemperature', { value: 0 }).status, 'missing')
  assert.equal(metric.getHardwareMetricState('fanSpeed', { value: 0 }).status, 'ok')
  assert.equal(metric.getHardwareMetricState('cpuPower', { source: 'unsupported', value: null }).status, 'missing')
  assert.equal(metric.getHardwareMetricState('cpuFrequency', { max: 0, avg: 3, cores: [] }).status, 'ok')
})

test('a stale snapshot restores the last value, reports an error, then clears the error on recovery', () => {
  let notify
  const api = load('src/utils/metricRefresh.ts', {}, { services: {
    subscribeHardwareTelemetry: (_, listener) => { notify = listener; return () => {} },
  } })
  let value
  let error = ''
  api.subscribeHardwareMetrics({ cpuLoad: (data) => { value = data.currentLoad } },
    (_, message) => { error = message }, () => { error = '' })
  notify({ cpuLoad: { sampleId: '1:stale', status: 'stale', value: { currentLoad: 35 }, checkedAt: 100, sampledAt: 50, error: 'old data' } })
  assert.equal(value, 35)
  assert.equal(error, 'old data')
  notify({ cpuLoad: { sampleId: '2', status: 'ok', value: { currentLoad: 40 }, checkedAt: 200, sampledAt: 200 } })
  assert.equal(value, 40)
  assert.equal(error, '')
})

test('visibility changes reach the producer and subscription cleanup removes the shared DOM listener', () => {
  let visibilityListener
  let adds = 0, removes = 0
  const updates = []
  const document = { hidden: false, visibilityState: 'visible',
    addEventListener: (_, listener) => { adds++; visibilityListener = listener },
    removeEventListener: () => { removes++ },
  }
  const api = load('src/utils/metricRefresh.ts', {}, { services: {
    subscribeHardwareTelemetry: () => () => {},
    setHardwareTelemetryVisibility: (hidden) => updates.push(hidden),
  } }, document)
  const one = api.subscribeHardwareMetrics({ cpuLoad() {} })
  const two = api.subscribeHardwareMetrics({ memoryUsage() {} })
  assert.equal(adds, 1)
  document.hidden = true
  document.visibilityState = 'hidden'
  visibilityListener()
  assert.equal(updates.at(-1), true)
  one(); one()
  assert.equal(removes, 0)
  two()
  assert.equal(removes, 1)
})

test('a shared dashboard has one metric writer and manual refresh waits for a new producer sample', async () => {
  let notify
  let refreshes = 0
  const forbidden = () => { throw new Error('a subscribed metric must not be polled') }
  const window = { setTimeout: () => 1, clearTimeout() {}, services: {
    sharedHardwareTelemetrySupported: true,
    subscribeHardwareTelemetry: (_, listener) => { notify = listener; return () => {} },
    refreshHardwareTelemetry: async () => {
      refreshes++
      notify({ cpuLoad: { status: 'ok', sampleId: 'new', checkedAt: Date.now(), sampledAt: Date.now(), value: { currentLoad: 40, cpus: [] } } })
    },
    getCpuLoadData: forbidden, getCpuTemperature: forbidden, getGpuInfo: forbidden,
    getMemInfo: forbidden, getDiskData: forbidden, getStorageIo: forbidden, getNetworkStatus: forbidden,
    getTopProcesses: async () => [], getTimeInfo: async () => ({}),
    getCpuInfo: async () => ({}), getDiskLayout: async () => [], getOsInfo: async () => ({ platform: 'darwin' }),
  } }
  const scopedMetric = load('src/utils/metricRefresh.ts', {}, window)
  const api = load('src/composables/useMonitorDashboardData.ts', {
    '../utils/metricRefresh': scopedMetric, '../utils/monitoring': monitoring, '../utils': utils,
    '../utils/gpu': { selectPrimaryGpu: () => undefined },
    '../utils/monitoringVisibility': { resolveMonitoringBackgroundThrottled: () => false, bindMonitoringVisibilityListeners: () => true },
    '../utils/serviceReader': { readService: (reader) => reader(), normalizeErrorMessage: String },
  }, window)
  await api.activateMonitorDashboard()
  notify({ cpuLoad: { status: 'ok', sampleId: 'initial', checkedAt: Date.now(), sampledAt: Date.now(), value: { currentLoad: 35, cpus: [] } } })
  assert.equal(api.monitorDashboardStore.cpuLoad.value, 35)
  await api.refreshMonitorDashboardData()
  assert.equal(api.monitorDashboardStore.cpuLoad.value, 40)
  assert.equal(refreshes, 1)
  api.deactivateMonitorDashboard()
})
