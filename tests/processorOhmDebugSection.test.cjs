const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('processor page exposes a Windows-only collapsible CPU frequency diagnostics section with anomaly copy action', () => {
  const source = readSource('src/components/Processor/index.vue')

  assert.match(source, /const currentSpeedDiagnostics = computed\(\(\) => cpuCurrentSpeed\.value\.frequencyDiagnostics \|\| null\)/)
  assert.match(source, /const visibleCpuClockSensors = computed\(\(\) => isWindowsPlatform\.value \? \(cpuCurrentSpeed\.value\.allCpuClockSensors \|\| \[\]\) : \[\]\)/)
  assert.match(source, /const hasCpuClockSensorDiagnostics = computed\(\(\) => visibleCpuClockSensors\.value\.length > 0\)/)
  assert.match(
    source,
    /const hasCpuSpeedDiagnosticsPanel = computed\(\(\) => isWindowsPlatform\.value && \(hasCpuClockSensorDiagnostics\.value \|\| Boolean\(currentSpeedDiagnostics\.value\)\)\)/
  )
  assert.match(source, /function formatCpuClockFilterReason\(reason\?: string\)/)
  assert.match(source, /function formatCpuFrequencyAnomalyReason\(reason\?: string\)/)
  assert.match(source, /const cpuSpeedDiagnosticReportText = computed\(\(\) => \{/)
  assert.match(source, /async function copyCpuSpeedDiagnosticReport\(\)/)
  assert.match(source, /await writeClipboard\(cpuSpeedDiagnosticReportText\.value\)/)
  assert.match(source, /<details v-if="hasCpuSpeedDiagnosticsPanel" class="sensor-debug-panel">/)
  assert.match(source, /<summary>CPU 频率诊断信息<\/summary>/)
  assert.match(source, /复制异常信息/)
  assert.match(source, /v-for="sensor in visibleCpuClockSensors"/)
  assert.match(source, /当前展示频率/)
  assert.match(source, /异常判定/)
  assert.match(source, /原始频率/)
  assert.match(source, /判定结果/)
  assert.match(source, /已采用/)
  assert.match(source, /已忽略/)
  assert.match(
    source,
    /<\/div>\s*<details v-if="hasCpuSpeedDiagnosticsPanel" class="sensor-debug-panel">[\s\S]*?<\/details>\s*<div v-if="sensorEnhancementPlatform === 'macos' && showSensorEnhancementPanel"/
  )
})
