const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.join(__dirname, '..')

function readSource(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('shared detail store loads only the static and dynamic data required by each active scope', () => {
  const source = readSource('src/composables/useHardwareData.ts')

  assert.match(source, /export type SharedHardwareScope = 'board' \| 'memory' \| 'storage'/)
  assert.match(source, /memory:\s*\['memoryLayout', 'boardData'\]/)
  assert.match(source, /storage:\s*\['diskLayout', 'osInfo'\]/)
  assert.match(source, /if \(scope === 'memory'\) return refreshMemory\(force\)/)
  assert.match(source, /if \(scope === 'storage'\) return refreshStorage\(force\)/)

  assert.doesNotMatch(source, /getCpuTemperature\(/)
  assert.doesNotMatch(source, /getCpuFullLoad\(/)
  assert.doesNotMatch(source, /getCpuCurrentSpeed\(/)
  assert.doesNotMatch(source, /getGpuInfo\(/)
  assert.doesNotMatch(source, /getDisplaysData\(/)
})

test('shared detail store continues polling after an unexpected refresh failure', () => {
  const source = readSource('src/composables/useHardwareData.ts')

  assert.match(source, /function scheduleNextPoll\(\)[\s\S]*try \{[\s\S]*await refreshActiveDynamicScopes\(\)[\s\S]*catch \(error\) \{[\s\S]*console\.error\('硬件详情轮询失败:', error\)[\s\S]*finally \{[\s\S]*scheduleNextPoll\(\)/)
})

test('independent dynamic pages reschedule polling after an unexpected refresh failure', () => {
  const pages = [
    ['src/composables/useOverviewHardwareData.ts', 'refreshOverviewMetrics', '系统概览轮询失败'],
    ['src/composables/useProcessorHardwareData.ts', 'refreshProcessorDynamicMetrics', '处理器轮询失败'],
    ['src/composables/useGraphicsHardwareData.ts', 'refreshGraphicsDynamicMetrics', '显卡轮询失败'],
  ]

  for (const [relativePath, refreshFunction, errorLabel] of pages) {
    const source = readSource(relativePath)
    const escapedRefreshFunction = refreshFunction.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const escapedErrorLabel = errorLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    assert.match(
      source,
      new RegExp(`function startPolling\\(\\)[\\s\\S]*try \\{[\\s\\S]*await ${escapedRefreshFunction}\\(\\)[\\s\\S]*catch \\(error\\) \\{[\\s\\S]*console\\.error\\('${escapedErrorLabel}:', error\\)[\\s\\S]*finally \\{[\\s\\S]*scheduleNext\\(\\)`),
      relativePath,
    )
  }
})

test('graphics refresh records source failures without rejecting its background callers', () => {
  const graphics = readSource('src/composables/useGraphicsHardwareData.ts')

  assert.match(graphics, /catch \(error\) \{[\s\S]*setFetchState\('gpuInfo', 'error', normalizeErrorMessage\(error\)\)[\s\S]*diagnostics\.markRefreshSkipped\('gpu-read-failed', backgroundThrottled\.value\)[\s\S]*return/)
  assert.doesNotMatch(graphics, /setFetchState\('gpuInfo', 'error', normalizeErrorMessage\(error\)\)[\s\S]*throw error/)
})

test('hardware overview uses static GPU identity and does not poll sensor-only metrics', () => {
  const source = readSource('src/composables/useOverviewHardwareData.ts')

  assert.match(source, /window\.services\.getStaticGpuInfo\(\)/)
  assert.doesNotMatch(source, /window\.services\.getGpuInfo\(\)/)
  assert.doesNotMatch(source, /window\.services\.getCpuTemperature\(\)/)
  assert.doesNotMatch(source, /window\.services\.getCpuCurrentSpeed\(\)/)
  assert.doesNotMatch(source, /window\.services\.getSystemData\(\)/)
})

test('board summary asks for static GPU identity rather than starting dynamic telemetry', () => {
  const source = readSource('src/components/BoardPage/index.vue')

  assert.match(source, /window\.services\.getStaticGpuInfo\(\)/)
  assert.doesNotMatch(source, /window\.services\.getGpuInfo\(\)/)
})

test('sensor enhancement is prepared only for monitor or sensor-heavy detail pages', () => {
  const app = readSource('src/App.vue')
  const controller = readSource('src/composables/useSensorEnhancementController.ts')

  assert.match(app, /const needsEnhancedSensors = page === 'monitor'/)
  assert.match(app, /section === 'processor' \|\| section === 'graphics'/)
  assert.match(app, /if \(!hasExplicitRoute \|\| !needsEnhancedSensors\) return/)
  assert.match(app, /await refreshGlobalSensorEnhancementState\(\)/)
  assert.match(controller, /resolvedOsInfo\.value = await window\.services\.getOsInfo\(\)/)
  assert.match(controller, /shouldAutoPrepareSensorEnhancement/)
})

test('sensor enhancement settings report save failures through the existing menu feedback', () => {
  const controller = readSource('src/composables/useSensorEnhancementController.ts')

  assert.match(controller, /async function setEnabled\(nextEnabled: boolean\) \{[\s\S]*catch \(error\) \{[\s\S]*console\.error\('更新传感器增强设置失败:', error\)[\s\S]*sensorActionMessage\.value = '传感器增强设置失败，请重试'/)
})

test('sensor enhancement status refresh reports failures through the existing menu feedback', () => {
  const controller = readSource('src/composables/useSensorEnhancementController.ts')

  assert.match(controller, /async function refreshFromMenu\(\) \{[\s\S]*try \{[\s\S]*await refreshState\(\)[\s\S]*await refreshProcessorState\(\)[\s\S]*catch \(error\) \{[\s\S]*console\.error\('重新检测传感器增强状态失败:', error\)[\s\S]*sensorActionMessage\.value = '传感器状态读取失败，请重试'/)
})

test('sensor enhancement state reads degrade instead of rejecting page initialization', () => {
  const controller = readSource('src/composables/useSensorEnhancementController.ts')

  assert.match(controller, /async function refreshState\(\) \{[\s\S]*try \{[\s\S]*getHardwareSensorSettings\(\)[\s\S]*catch \(error\) \{[\s\S]*console\.error\('读取传感器增强状态失败:', error\)[\s\S]*sensorActionMessage\.value = '传感器状态读取失败，请重试'[\s\S]*finally \{[\s\S]*sensorSettingsLoading\.value = false/)
})

test('sensor enhancement preparation degrades instead of rejecting automatic startup', () => {
  const controller = readSource('src/composables/useSensorEnhancementController.ts')

  assert.match(controller, /async function prepare\(auto: boolean\) \{[\s\S]*try \{[\s\S]*startWindowsSensorEnhancement\(\)[\s\S]*catch \(error\) \{[\s\S]*console\.error\('准备传感器增强失败:', error\)[\s\S]*sensorActionMessage\.value = '传感器增强准备失败，请重试'[\s\S]*finally \{[\s\S]*sensorActionLoading\.value = false/)
})

test('sensor enhancement authorization reports failures through the existing menu feedback', () => {
  const controller = readSource('src/composables/useSensorEnhancementController.ts')

  assert.match(controller, /async function continueAuthorization\(\) \{[\s\S]*try \{[\s\S]*installMacPowermetricsHelper\(\)[\s\S]*catch \(error\) \{[\s\S]*console\.error\('请求传感器增强授权失败:', error\)[\s\S]*sensorActionMessage\.value = '授权失败，请重试'/)
})

test('standalone monitoring resolves its own platform and uses a global authorization overlay', () => {
  const app = readSource('src/App.vue')
  const controller = readSource('src/composables/useSensorEnhancementController.ts')

  assert.match(controller, /async function ensurePlatformInfo\(\)/)
  assert.match(controller, /resolvedOsInfo\.value = await window\.services\.getOsInfo\(\)/)
  assert.match(app, /await refreshGlobalSensorEnhancementState\(\)/)
  assert.match(app, /<div v-if="sensorAuthorizationPromptVisible" class="sensor-auth-overlay">/)
  assert.match(app, /\.sensor-auth-overlay \{[\s\S]*position: fixed;[\s\S]*inset: 0;/)
})

test('monitor refresh profile does not leak into normal hardware pages', () => {
  const monitor = readSource('src/composables/useMonitorDashboardData.ts')
  const regularStores = [
    'src/composables/useOverviewHardwareData.ts',
    'src/composables/useHardwareData.ts',
    'src/composables/useProcessorHardwareData.ts',
    'src/composables/useGraphicsHardwareData.ts',
  ]

  assert.match(monitor, /window\.services\.getMonitoringRefreshSettings\(\)/)
  assert.match(monitor, /window\.services\.updateMonitoringRefreshSettings\(patch\)/)

  for (const relativePath of regularStores) {
    const source = readSource(relativePath)
    assert.doesNotMatch(source, /getMonitoringRefreshSettings\(\)/, relativePath)
    assert.doesNotMatch(source, /updateMonitoringRefreshSettings\(/, relativePath)
    assert.match(source, /getMonitoringRefreshIntervals\('balanced', backgroundThrottled\.value\)/, relativePath)
  }
})

test('clipboard and text report DOM fallbacks live in one shared utility', () => {
  const utility = readSource('src/utils/presentation.ts')
  const consumers = [
    'src/App.vue',
    'src/components/Computer/index.vue',
    'src/components/Processor/index.vue',
    'src/components/GraphicsPage/index.vue',
    'src/components/BoardPage/index.vue',
    'src/components/MemoryPage/index.vue',
    'src/components/StoragePage/index.vue',
    'src/components/DeviceSpecsLite/index.vue',
  ]

  assert.match(utility, /export async function writeClipboardText/)
  assert.match(utility, /await navigator\.clipboard\.writeText\(text\)/)
  assert.match(utility, /catch \{[\s\S]*document fallback/)
  assert.match(utility, /export function downloadTextFile/)
  assert.match(utility, /document\.createElement\('textarea'\)/)
  assert.match(utility, /new Blob\(\[text\]/)
  assert.match(utility, /document\.body\.appendChild\(anchor\)/)
  assert.match(utility, /globalThis\.setTimeout\(\(\) => URL\.revokeObjectURL\(url\), 0\)/)

  for (const relativePath of consumers) {
    const source = readSource(relativePath)
    assert.doesNotMatch(source, /document\.createElement\('textarea'\)/, relativePath)
    assert.doesNotMatch(source, /new Blob\(\[/, relativePath)
  }
})

test('obsolete overview components and unused public hardware services stay removed', () => {
  const removedComponents = [
    'src/components/CpuCard/index.vue',
    'src/components/GpuCard/index.vue',
    'src/components/MemoCard/index.vue',
    'src/components/DiskCard/index.vue',
    'src/components/BoardCard/index.vue',
    'src/components/SystemOverview/index.vue',
    'src/components/OptionCard/index.vue',
    'src/components/LabelIcon/index.vue',
    'src/components/CardHeader/index.vue',
  ]

  for (const relativePath of removedComponents) {
    assert.equal(fs.existsSync(path.join(root, relativePath)), false, relativePath)
  }

  const service = readSource('utools/services/system.js')
  const types = readSource('src/type/interface.d.ts')
  const removedServiceNames = [
    'getBoardTelemetry',
    'getNetworkInfo',
    'getWifiInterfaces',
    'getWifiConnections',
    'getBatteryInfo',
    'getUsbDevices',
    'getBluetoothDevices',
    'getPrinterInfo',
    'getSysEnv',
  ]

  for (const name of removedServiceNames) {
    assert.doesNotMatch(service, new RegExp(`\\b${name}\\b`), name)
    assert.doesNotMatch(types, new RegExp(`\\b${name}\\b`), name)
  }
})
