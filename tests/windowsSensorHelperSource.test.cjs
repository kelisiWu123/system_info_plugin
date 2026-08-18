const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('Windows sensor helper is an elevated single-instance named-pipe backend with shared snapshot caching', () => {
  const helper = readProjectFile('native/windows-sensor-helper/Program.cs')
  const manifest = readProjectFile('native/windows-sensor-helper/app.manifest')

  assert.match(helper, /DefaultPipeName = "hwinfox-sensor-helper-v1"/)
  assert.match(helper, /Local\\\\HWInfoXSensorHelper-v1/)
  assert.match(helper, /SnapshotCacheMilliseconds = 700/)
  assert.match(helper, /IdleExitMilliseconds = 1800000/)
  assert.match(helper, /case "ping":/)
  assert.match(helper, /case "snapshot":/)
  assert.match(helper, /case "shutdown":/)
  assert.match(helper, /D:\(A;;GA;;;SY\)\(A;;GA;;;BA\)\(A;;GRGW;;;AU\)S:\(ML;;NW;;;ME\)/)
  assert.match(helper, /hardware\.Update\(\)/)
  assert.match(helper, /foreach \(var subHardware in hardware\.SubHardware\)/)
  assert.match(manifest, /requestedExecutionLevel level="requireAdministrator"/)
})

test('Windows helper regeneration is explicit while normal release builds verify the prebuilt asset', () => {
  const buildScript = readProjectFile('scripts/build-windows-sensor-helper.mjs')
  const verifyScript = readProjectFile('scripts/verify-windows-sensor-helper.mjs')
  const packageJson = JSON.parse(readProjectFile('package.json'))

  assert.match(buildScript, /OPEN_HARDWARE_MONITOR_LIBRARY_ID = 'OpenHardwareMonitorLib'/)
  assert.match(buildScript, /OPEN_HARDWARE_MONITOR_LIBRARY_VERSION = '1\.0\.9513'/)
  assert.match(buildScript, /vendor\/openhardwaremonitor\/sensor-helper/)
  assert.match(buildScript, /HWInfoXSensorHelper\.source\.sha256/)
  assert.match(buildScript, /runtime-manifest\.json/)
  assert.match(buildScript, /Microsoft\.NET.*Framework64.*v4\.0\.30319.*csc\.exe/s)
  assert.match(buildScript, /\/reference:System\.Web\.Extensions\.dll/)
  assert.doesNotMatch(buildScript, /`\/reference:\$\{backendAssembly\}`/)
  assert.match(buildScript, /Windows sensor helper regeneration requires Windows/)
  assert.match(verifyScript, /HWInfoXSensorHelper\.exe/)
  assert.match(verifyScript, /HWInfoXSensorHelper\.source\.sha256/)
  assert.match(verifyScript, /runtime-manifest\.json/)
  assert.match(verifyScript, /OpenHardwareMonitorLib\.dll/)
  assert.match(verifyScript, /createHash\('sha256'\)/)
  assert.match(packageJson.scripts.build, /verify-windows-sensor-helper\.mjs/)
  assert.doesNotMatch(packageJson.scripts.build, /build-windows-sensor-helper\.mjs/)
  assert.equal(packageJson.scripts['build:windows-helper'], 'node scripts/build-windows-sensor-helper.mjs')
  assert.equal(packageJson.scripts['verify:windows-helper'], 'node scripts/verify-windows-sensor-helper.mjs')
  assert.equal(Object.prototype.hasOwnProperty.call(packageJson.dependencies, 'LibreHardwareMonitor'), false)
})

test('preload sensor client uses named pipes and hidden UAC startup instead of a visible monitor application', () => {
  const client = readProjectFile('utools/services/windowsSensorHelper.js')

  assert.match(client, /import net from 'node:net'/)
  assert.match(client, /WINDOWS_SENSOR_HELPER_PIPE_NAME = 'hwinfox-sensor-helper-v1'/)
  assert.match(client, /net\.connect\(WINDOWS_SENSOR_HELPER_PIPE_PATH\)/)
  assert.match(client, /'-WindowStyle Hidden -Verb RunAs -PassThru'/)
  assert.match(client, /requestWindowsSensorHelper\('shutdown'/)
  assert.match(client, /source: 'WindowsSensorHelper'/)
})

test('system service prefers helper telemetry, keeps a hidden legacy fallback, and stops both when enhancement is disabled', () => {
  const service = readProjectFile('utools/services/system.js')

  assert.match(service, /const helperSensors = await getWindowsSensorHelperSensors\(sensorType\)[\s\S]*if \(helperSensors\.length\) return helperSensors[\s\S]*return queryWmiSensors/)
  assert.match(service, /async function startPreferredWindowsSensorBackend\(\)[\s\S]*if \(helperResolved\.exists\)[\s\S]*startWindowsSensorHelper\([\s\S]*startBundledOpenHardwareMonitor\(\)/)
  assert.match(service, /'-WindowStyle Hidden -PassThru'/)
  assert.match(service, /await stopWindowsSensorHelper\(\)[\s\S]*await stopPluginManagedOpenHardwareMonitor\(\)/)
  assert.match(service, /getWindowsSensorEnhancementStatus: getOpenHardwareMonitorStatus/)
  assert.match(service, /startWindowsSensorEnhancement: startOpenHardwareMonitorManually/)
  assert.match(service, /openWindowsSensorComponentDirectory: openOpenHardwareMonitorDirectory/)
})

test('CPU temperature retries the generic enhanced sensor path after the Windows backend becomes ready', () => {
  const service = readProjectFile('utools/services/system.js')

  assert.match(service, /openHardwareMonitorStatus = await ensureOpenHardwareMonitorRunning\(\)[\s\S]*const enhancedTemperature = await getHardwareMonitorCpuTemperatureFromNamespace\(OPEN_HARDWARE_MONITOR_WMI_NAMESPACE\)/)
  assert.match(service, /openHardwareMonitorStatus\?\.backend === 'legacy-ohm'[\s\S]*readOpenHardwareMonitorHttp/)
  assert.match(service, /Windows 传感器增强未返回可信 CPU 温度/)
})

test('normal Windows UI uses generic sensor enhancement APIs and hides OHM ports and app-launch wording', () => {
  const controller = readProjectFile('src/composables/useSensorEnhancementController.ts')
  const processor = readProjectFile('src/components/Processor/index.vue')
  const watch = readProjectFile('src/components/Watch/index.vue')

  assert.match(controller, /window\.services\.startWindowsSensorEnhancement\(\)/)
  assert.match(controller, /window\.services\.getWindowsSensorEnhancementStatus\(\)/)
  assert.match(processor, /不需要手动打开其他监控软件/)
  assert.match(processor, /后端：\{\{ windowsSensorBackendLabel \}\}/)
  assert.doesNotMatch(processor, /<span>端口：\{\{ sensorSettings\.openHardwareMonitorPort \}\}<\/span>/)
  assert.doesNotMatch(processor, />尝试启动 OHM</)
  assert.match(watch, /window\.services\.getWindowsSensorEnhancementStatus\(\)/)
})
