const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('Windows sensor runtime cache key includes the helper fingerprint so stale OHM-only caches are not reused', () => {
  const source = readProjectFile('utools/services/system.js')

  assert.match(source, /function getOpenHardwareMonitorRuntimeBundleKey\(sourceDirectoryPath\)/)
  assert.match(source, /sensor-helper['"], 'HWInfoXSensorHelper\.source\.sha256'/)
  assert.match(source, /helperFingerprint\.slice\(0, 16\)/)
  assert.match(source, /getOpenHardwareMonitorRuntimeBundleKey\(resolved\.directoryPath\)/)
})

test('a package that contains the new helper never silently falls back to launching OpenHardwareMonitor.exe when runtime extraction is incomplete', () => {
  const source = readProjectFile('utools/services/system.js')

  assert.match(source, /function hasBundledWindowsSensorHelper\(resolvedOpenHardwareMonitor\)/)
  assert.match(source, /if \(bundledHelperAvailable && !helperResolved\.exists\)[\s\S]*WINDOWS_SENSOR_HELPER_RUNTIME_MISSING/)
  assert.match(source, /if \(!bundledHelperAvailable\)[\s\S]*startBundledOpenHardwareMonitor\(\)/)
})
