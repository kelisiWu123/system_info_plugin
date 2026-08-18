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
  assert.match(utility, /export function downloadTextFile/)
  assert.match(utility, /document\.createElement\('textarea'\)/)
  assert.match(utility, /new Blob\(\[text\]/)

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
