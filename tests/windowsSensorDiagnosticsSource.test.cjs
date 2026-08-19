const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('Windows helper diagnostic snapshot preserves raw helper errors and sensors', () => {
  const helper = readProjectFile('utools/services/windowsSensorHelper.js')

  assert.match(helper, /export async function readWindowsSensorHelperDiagnosticSnapshot\(\)/)
  assert.match(helper, /WINDOWS_SENSOR_HELPER_SNAPSHOT_NO_RESPONSE/)
  assert.match(helper, /received: true/)
  assert.match(helper, /ok: Boolean\(response\.ok\)/)
  assert.match(helper, /sensors: Array\.isArray\(response\.sensors\) \? response\.sensors : \[\]/)
  assert.match(helper, /error: typeof response\.error === 'string' \? response\.error : ''/)
})

test('Windows sensor diagnostics classify empty, missing CPU, filter mismatch, and missing temperature states', () => {
  const service = readProjectFile('utools/services/system.js')

  assert.match(service, /async function getWindowsSensorEnhancementDiagnostics\(\)/)
  assert.match(service, /WINDOWS_SENSOR_HELPER_SNAPSHOT_EMPTY/)
  assert.match(service, /WINDOWS_SENSOR_HELPER_CPU_NOT_ENUMERATED/)
  assert.match(service, /WINDOWS_SENSOR_CPU_FILTER_MISMATCH/)
  assert.match(service, /WINDOWS_SENSOR_HELPER_CPU_TEMPERATURE_MISSING/)
  assert.match(service, /WINDOWS_SENSOR_HELPER_PIPE_UNREACHABLE/)
  assert.match(service, /WINDOWS_SENSOR_HELPER_CRASHED/)
  assert.match(service, /WINDOWS_SENSOR_HELPER_EXITED_EARLY/)
  assert.match(service, /HWInfoXSensorHelper\.error\.log/)
  assert.match(service, /processPresent/)
  assert.match(service, /crashLog/)
  assert.match(service, /cpuHardwareSensorCount/)
  assert.match(service, /cpuFilterMatchCount/)
  assert.match(service, /sensorTypeCounts/)
  assert.match(service, /hardwareTypeCounts/)
  assert.match(service, /samples: buildWindowsSensorDiagnosticSamples\(sensors\)/)
  assert.match(service, /getWindowsSensorEnhancementDiagnostics,/)
})

test('Processor shows and copies Windows helper diagnostics when enhanced CPU telemetry is still missing', () => {
  const processor = readProjectFile('src/components/Processor/index.vue')
  const controller = readProjectFile('src/composables/useSensorEnhancementController.ts')
  const app = readProjectFile('src/App.vue')

  assert.match(processor, /window\.services\.getWindowsSensorEnhancementDiagnostics\(\)/)
  assert.match(processor, /WINDOWS_SENSOR_UI_PIPELINE_MISMATCH/)
  assert.match(processor, /增强后端诊断/)
  assert.match(processor, /CPU 候选/)
  assert.match(processor, /CPU 温度/)
  assert.match(processor, /复制完整诊断/)
  assert.match(processor, /\[Raw sensor samples\]/)
  assert.match(controller, /windowsSensorDiagnostics/)
  assert.match(controller, /getWindowsSensorEnhancementDiagnostics\(\)/)
  assert.match(app, /sensorEnhancementPlatform === 'windows' && sensorSettings\.enhancedSensorEnabled/)
})
