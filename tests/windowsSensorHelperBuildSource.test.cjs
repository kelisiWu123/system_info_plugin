const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('Windows helper build restores the official embeddable OpenHardwareMonitorLib instead of referencing the UI executable', () => {
  const buildScript = readProjectFile('scripts/build-windows-sensor-helper.mjs')

  assert.match(buildScript, /OpenHardwareMonitorLib/)
  assert.match(buildScript, /1\.0\.9513/)
  assert.match(buildScript, /nuget\.exe/)
  assert.match(buildScript, /const TARGET_FRAMEWORK = 'net472'/)
  assert.match(buildScript, /'-Framework', TARGET_FRAMEWORK/)
  assert.match(buildScript, /sensor-helper/)
  assert.match(buildScript, /runtime-manifest\.json/)
  assert.doesNotMatch(buildScript, /`\/reference:\$\{backendAssembly\}`/)
})

test('release verification validates the helper runtime directory instead of treating OpenHardwareMonitor.exe as the helper library', () => {
  const verifyScript = readProjectFile('scripts/verify-windows-sensor-helper.mjs')
  const systemService = readProjectFile('utools/services/system.js')

  assert.match(verifyScript, /sensor-helper/)
  assert.match(verifyScript, /runtime-manifest\.json/)
  assert.match(verifyScript, /OpenHardwareMonitorLib\.dll/)
  assert.doesNotMatch(verifyScript, /backendAssembly = resolve\('vendor\/openhardwaremonitor\/OpenHardwareMonitor\.exe'\)/)
  assert.match(systemService, /path\.join\(rootDirectoryPath, 'sensor-helper'\)/)
  assert.match(systemService, /path\.join\(directoryPath, WINDOWS_SENSOR_HELPER_PROCESS_NAME\)/)
})

test('source fingerprints normalize CRLF and LF so Windows prebuilds verify on macOS', () => {
  const buildScript = readProjectFile('scripts/build-windows-sensor-helper.mjs')
  const verifyScript = readProjectFile('scripts/verify-windows-sensor-helper.mjs')

  assert.match(buildScript, /function canonicalizeFingerprintText\(value\)/)
  assert.match(buildScript, /replace\(\/\\r\\n\|\\r\/g, '\\n'\)/)
  assert.match(buildScript, /hash\.update\(canonicalizeFingerprintText\(readFileSync\(filePath, 'utf8'\)\)\)/)
  assert.match(verifyScript, /function canonicalizeFingerprintText\(value\)/)
  assert.match(verifyScript, /replace\(\/\\r\\n\|\\r\/g, '\\n'\)/)
  assert.match(verifyScript, /hash\.update\(canonicalizeFingerprintText\(readFileSync\(filePath, 'utf8'\)\)\)/)
  assert.match(verifyScript, /function computeLegacyWindowsFingerprint\(runtimeManifestContent\)/)
  assert.match(verifyScript, /actualFingerprint !== expectedFingerprint && actualFingerprint !== legacyWindowsFingerprint/)
})
