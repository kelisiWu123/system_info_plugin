const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('blank and non-sensor hardware routes do not auto-prepare sensor enhancement', () => {
  const app = readProjectFile('src/App.vue')

  assert.match(app, /const hasExplicitPageRoute = computed\(/)
  assert.match(app, /\[currentPage, hasExplicitPageRoute, selectedSection\]/)
  assert.match(app, /const needsEnhancedSensors = page === 'monitor'/)
  assert.match(app, /section === 'processor' \|\| section === 'graphics'/)
  assert.match(app, /if \(!hasExplicitRoute \|\| !needsEnhancedSensors\) return/)
  assert.match(app, /if \(sensorEnhancementPlatform\.value === 'unsupported'\) return/)
  assert.doesNotMatch(app, /if \(!window\.location\.hash\)\s*{\s*window\.location\.hash = 'computer'/)
})

test('manual and automatic Windows sensor enhancement starts share one deduplicated backend path', () => {
  const source = readProjectFile('utools/services/system.js')

  assert.match(source, /async function startOpenHardwareMonitorManually\(\)\s*{\s*return ensureOpenHardwareMonitorRunning\(\{ allowStartWithoutAutoStart: true \}\)\s*}/)
  assert.match(source, /if \(openHardwareMonitorStartPromise\)\s*{\s*return openHardwareMonitorStartPromise/)
  assert.match(source, /readOpenHardwareMonitorSharedLastStartAt\(\)/)
  assert.match(source, /markOpenHardwareMonitorStartAttempt\(\)/)
  assert.match(source, /fs\.openSync\(lockPath, 'wx'\)/)
  assert.match(source, /WINDOWS_SENSOR_START_IN_PROGRESS/)
  assert.match(source, /async function startPreferredWindowsSensorBackend\(\)/)
  assert.match(source, /const startResult = await startPreferredWindowsSensorBackend\(\)/)
})

test('Windows sensor readiness prefers the named-pipe helper while preserving the hidden legacy fallback', () => {
  const source = readProjectFile('utools/services/system.js')
  const helper = readProjectFile('utools/services/windowsSensorHelper.js')

  assert.match(source, /async function isOpenHardwareMonitorRunning\(settings = getHardwareSensorSettings\(\)\)/)
  assert.match(source, /const helperStatus = await getWindowsSensorHelperStatus\(\)/)
  assert.match(source, /async function isLegacyOpenHardwareMonitorRunning\(settings = getHardwareSensorSettings\(\)\)/)
  assert.match(source, /isProcessRunning\(OPEN_HARDWARE_MONITOR_PROCESS_NAME\)/)
  assert.match(source, /isOpenHardwareMonitorHttpReachable\(settings\.openHardwareMonitorPort\)/)
  assert.match(source, /async function startPreferredWindowsSensorBackend\(\)[\s\S]*if \(helperResolved\.exists\)[\s\S]*startWindowsSensorHelper\([\s\S]*startBundledOpenHardwareMonitor\(\)/)
  assert.match(source, /'-WindowStyle Hidden -PassThru'/)
  assert.match(helper, /'-WindowStyle Hidden -Verb RunAs -PassThru'/)
})

test('OpenHardwareMonitor readiness invalidates stale telemetry caches and active CPU surfaces refresh immediately', () => {
  const service = readProjectFile('utools/services/system.js')
  const processor = readProjectFile('src/components/Processor/index.vue')
  const watch = readProjectFile('src/components/Watch/index.vue')

  assert.match(service, /const OPEN_HARDWARE_MONITOR_TELEMETRY_CACHE_KEYS = \[[\s\S]*'cpuTemperature'[\s\S]*'cpuPower'[\s\S]*'cpuCurrentSpeed'[\s\S]*'cpuVoltage'/)
  assert.match(service, /function invalidateRuntimeServiceCache\(\.\.\.cacheKeyInputs\)/)
  assert.match(service, /function recordOpenHardwareMonitorRunningState\(running\)[\s\S]*invalidateRuntimeServiceCache\(OPEN_HARDWARE_MONITOR_TELEMETRY_CACHE_KEYS\)/)
  assert.match(service, /async function isOpenHardwareMonitorRunning[\s\S]*recordOpenHardwareMonitorRunningState\(true\)/)
  assert.match(processor, /if \(latestStatus\.running\)\s*{\s*await refreshProcessorHardwareDynamicMetrics\(\)/)
  assert.match(processor, /if \(subscribed\.value\)\s*{\s*await refreshProcessorHardwareDynamicMetrics\(\)/)
  assert.match(watch, /async function refreshOpenHardwareMonitorReadiness\(force = false\)/)
  assert.match(watch, /const becameReady = running && lastOpenHardwareMonitorRunning !== true/)
  assert.match(watch, /const effectiveForce = force \|\| ohmBecameReady/)
})

test('macOS enhancement flow remains on the powermetrics helper path', () => {
  const controller = readProjectFile('src/composables/useSensorEnhancementController.ts')
  const source = readProjectFile('utools/services/system.js')

  assert.match(controller, /platform\.value === 'macos'[\s\S]*macHelperStatus\.value = await window\.services\.installMacPowermetricsHelper\(\)/)
  assert.match(controller, /window\.services\.uninstallMacPowermetricsHelper\(\)/)
  assert.match(source, /async function installMacPowermetricsHelper\(/)
  assert.match(source, /async function uninstallMacPowermetricsHelper\(/)
  assert.match(source, /MAC_POWERMETRICS_HELPER_SOCKET_PATH/)
})
