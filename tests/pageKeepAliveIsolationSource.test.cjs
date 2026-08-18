const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('hardware detail tabs use KeepAlive instead of keeping every page in the active DOM tree', () => {
  const app = readSource('src/App.vue')

  assert.match(app, /<KeepAlive>[\s\S]*<Computer[\s\S]*v-if="selectedSection === 'overview'"/)
  assert.match(app, /<Processor[\s\S]*v-else-if="selectedSection === 'processor'"/)
  assert.match(app, /<GraphicsPage[\s\S]*v-else-if="selectedSection === 'graphics'"/)
  assert.match(app, /<BoardPage[\s\S]*v-else-if="selectedSection === 'board'"/)
  assert.match(app, /<MemoryPage[\s\S]*v-else-if="selectedSection === 'memory'"/)
  assert.match(app, /<StoragePage[\s\S]*v-else/)
  assert.doesNotMatch(app, /v-show="selectedSection === '(overview|processor|graphics|board|memory|storage)'"/)
})

test('cached hardware pages share one activation lifecycle that releases polling on deactivation and unmount', () => {
  const lifecycle = readSource('src/composables/useActivePageLifecycle.ts')
  const pages = [
    'src/components/Computer/index.vue',
    'src/components/Processor/index.vue',
    'src/components/GraphicsPage/index.vue',
    'src/components/BoardPage/index.vue',
    'src/components/MemoryPage/index.vue',
    'src/components/StoragePage/index.vue',
  ]

  assert.match(lifecycle, /onActivated\(\(\) =>/)
  assert.match(lifecycle, /onDeactivated\(\(\) =>/)
  assert.match(lifecycle, /onUnmounted\(\(\) =>/)
  assert.match(lifecycle, /watch\([\s\S]*isActive[\s\S]*\{ immediate: true \}/)

  for (const page of pages) {
    const source = readSource(page)
    assert.match(source, /useActivePageLifecycle\(/, `${page} should use the shared page lifecycle`)
  }
})

test('sensor details wait for the cached processor page to reactivate before using its template ref', () => {
  const app = readSource('src/App.vue')

  assert.match(app, /openProcessorDetails: async \(\) => \{[\s\S]*selectedSection\.value = 'processor'[\s\S]*await nextTick\(\)[\s\S]*processorRef\.value\?\.openSensorEnhancementPanel/)
})
