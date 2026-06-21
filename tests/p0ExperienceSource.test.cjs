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

test('topbar controls include accessibility labels and sensor error diagnostics can be copied', () => {
  const source = readSource('src/App.vue')

  assert.match(source, /:aria-label="`切换刷新档位为 \$\{profile\.label\}`"/)
  assert.match(source, /aria-label="切换后台降频"/)
  assert.match(source, /aria-label="打开传感器增强菜单"/)
  assert.match(source, /copySensorDiagnostics/)
  assert.match(source, /复制诊断/)
})

test('overview, processor, and board pages use the shared StateBlock component', () => {
  const stateBlock = readSource('src/components/common/StateBlock.vue')
  const overview = readSource('src/components/Computer/index.vue')
  const processor = readSource('src/components/Processor/index.vue')
  const board = readSource('src/components/BoardPage/index.vue')

  assert.match(stateBlock, /defineProps/)
  assert.match(stateBlock, /variant: 'loading' \| 'empty' \| 'error' \| 'soon'/)
  assert.match(overview, /<StateBlock[\s\S]*variant="loading"/)
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
