const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('main shell exposes copy/export actions outside development mode and removes dead navigation branches', () => {
  const source = readSource('src/App.vue')

  assert.match(source, /const showMainHeaderActions = computed\(\(\) =>\s*currentPage\.value === 'computer' && Boolean\(currentDevCopyTarget\.value\)\s*\)/)
  assert.doesNotMatch(source, /v-if="isDev && currentPage === 'computer' && currentDevCopyTarget"/)
  assert.doesNotMatch(source, /secondaryNavItems/)
  assert.doesNotMatch(source, /placeholder-panel/)
  assert.doesNotMatch(source, /模块开发中/)
})

test('advanced refresh controls stay in monitoring while sensor controls are limited to CPU and GPU details', () => {
  const app = readSource('src/App.vue')
  const monitor = readSource('src/components/MonitoringDashboard/index.vue')
  const sensorController = readSource('src/composables/useSensorEnhancementController.ts')

  assert.doesNotMatch(app, /切换刷新档位/)
  assert.doesNotMatch(app, /切换后台降频/)
  assert.match(monitor, /monitor-profile-button/)
  assert.match(monitor, /后台降频/)
  assert.match(app, /selectedSection\.value === 'processor' \|\| selectedSection\.value === 'graphics'/)
  assert.match(sensorController, /getSensorEnhancementMenuAriaLabel/)
  assert.match(app, /:aria-label="processorSensorControlAriaLabel"/)
  assert.match(app, /copySensorDiagnostics/)
  assert.match(app, /复制诊断/)
})

test('sensor-heavy pages explain when telemetry needs enhancement instead of saying everything is unsupported', () => {
  const app = readSource('src/App.vue')
  const processor = readSource('src/components/Processor/index.vue')
  const graphics = readSource('src/components/GraphicsPage/index.vue')

  assert.match(processor, /function sensorMetricFallbackLabel/)
  assert.match(processor, /return '需要传感器增强'/)
  assert.match(processor, /return enhancementReady \? '系统未提供' : '增强组件未就绪'/)
  assert.match(graphics, /sensorEnhancementEnabled\?: boolean/)
  assert.match(graphics, /sensorEnhancementReady\?: boolean/)
  assert.match(graphics, /function graphicsMetricFallbackLabel/)
  assert.match(graphics, /return '需要传感器增强'/)
  assert.match(graphics, /return '增强组件未就绪'/)
  assert.match(app, /:sensor-enhancement-enabled="sensorSettings\.enhancedSensorEnabled"/)
  assert.match(app, /:sensor-enhancement-ready="sensorEnhancementReady"/)
  assert.doesNotMatch(graphics, /<button type="button" class="panel-action">监控设置<\/button>/)
})

test('overview, processor, and board pages use the shared StateBlock component', () => {
  const stateBlock = readSource('src/components/common/StateBlock.vue')
  const overview = readSource('src/components/Computer/index.vue')
  const processor = readSource('src/components/Processor/index.vue')
  const board = readSource('src/components/BoardPage/index.vue')

  assert.match(stateBlock, /defineProps/)
  assert.match(stateBlock, /variant: 'loading' \| 'empty' \| 'error' \| 'soon'/)
  assert.match(overview, /<StateBlock[\s\S]*v-if="!loading && pageStateBlock"/)
  assert.match(overview, /class="overview-progress"/)
  assert.match(processor, /<StateBlock[\s\S]*@retry="retryProcessorPage"/)
  assert.match(board, /<StateBlock[\s\S]*variant="soon"/)
})

test('stores expose explicit force-refresh retry entrypoints for state blocks', () => {
  const overviewStore = readSource('src/composables/useOverviewHardwareData.ts')
  const sharedStore = readSource('src/composables/useHardwareData.ts')
  const processorStore = readSource('src/composables/useProcessorHardwareData.ts')

  assert.match(overviewStore, /export async function refreshOverviewHardwareData\(\)/)
  assert.match(sharedStore, /export async function refreshHardwareData\(/)
  assert.match(processorStore, /export async function refreshProcessorHardwareData\(\)/)
})
