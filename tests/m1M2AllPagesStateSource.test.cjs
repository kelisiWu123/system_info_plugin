const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('graphics, memory, storage, processor, and overview pages use StateBlock for loading and retryable error or empty states', () => {
  const graphics = readSource('src/components/GraphicsPage/index.vue')
  const memory = readSource('src/components/MemoryPage/index.vue')
  const storage = readSource('src/components/StoragePage/index.vue')
  const processor = readSource('src/components/Processor/index.vue')
  const overview = readSource('src/components/Computer/index.vue')

  for (const source of [graphics, memory, storage, processor, overview]) {
    assert.match(source, /import StateBlock from '..\/common\/StateBlock.vue'/)
    assert.match(source, /<StateBlock[\s\S]*variant="loading"/)
    assert.match(source, /<StateBlock[\s\S]*:variant="pageStateBlock\.variant"/)
    assert.match(source, /@retry="retry[A-Za-z]+Page"/)
  }
})

test('graphics, memory, storage, processor, and overview pages consume fetchState instead of relying only on field placeholders', () => {
  const graphics = readSource('src/components/GraphicsPage/index.vue')
  const memory = readSource('src/components/MemoryPage/index.vue')
  const storage = readSource('src/components/StoragePage/index.vue')
  const processor = readSource('src/components/Processor/index.vue')
  const overview = readSource('src/components/Computer/index.vue')

  assert.match(graphics, /fetchState/)
  assert.match(graphics, /fetchState\.gpuInfo/)
  assert.match(memory, /fetchState\.memInfo/)
  assert.match(memory, /fetchState\.memoryLayout/)
  assert.match(storage, /fetchState\.diskData/)
  assert.match(storage, /fetchState\.diskLayout/)
  assert.match(processor, /fetchState\.cpuInfo/)
  assert.match(processor, /fetchState\.cpuTemperature/)
  assert.match(overview, /fetchState\.cpuInfo/)
  assert.match(overview, /fetchState\.memInfo/)
})

test('graphics store exposes fetchState and explicit force refresh for page retry', () => {
  const graphicsStore = readSource('src/composables/useGraphicsHardwareData.ts')

  assert.match(graphicsStore, /type FetchStatus = 'pending' \| 'ok' \| 'missing' \| 'error'/)
  assert.match(graphicsStore, /fetchState = reactive/)
  assert.match(graphicsStore, /setFetchState\('gpuInfo'/)
  assert.match(graphicsStore, /export async function refreshGraphicsHardwareData\(\)/)
  assert.match(graphicsStore, /fetchState,/)
})

test('processor store exposes fetchState and tracks processor service results', () => {
  const processorStore = readSource('src/composables/useProcessorHardwareData.ts')

  assert.match(processorStore, /type FetchStatus = 'pending' \| 'ok' \| 'missing' \| 'error'/)
  assert.match(processorStore, /type ProcessorServiceKey =/)
  assert.match(processorStore, /fetchState = reactive/)
  assert.match(processorStore, /setFetchState\('cpuInfo'/)
  assert.match(processorStore, /setFetchState\('cpuTemperature'/)
  assert.match(processorStore, /normalizeErrorMessage/)
  assert.match(processorStore, /fetchState,/)
})
