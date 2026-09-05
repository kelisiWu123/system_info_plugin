const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

test('switching hardware sections closes the sensor enhancement menu', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/App.vue'), 'utf8')

  assert.match(source, /function selectSection\(id: SidebarItem\['id'\]\) {[\s\S]*sensorMenuOpen\.value = false/)
  assert.match(source, /function selectSection\(id: SidebarItem\['id'\]\) {[\s\S]*sensorActionMessage\.value = ''/)
  assert.match(source, /function closeSensorMenuOnOutsidePointer\(event: PointerEvent\)/)
  assert.match(source, /!sensorMenuRootRef\.value\?\.contains\(event\.target\)/)
  assert.match(source, /document\.addEventListener\('pointerdown', closeSensorMenuOnOutsidePointer\)/)
  assert.match(source, /document\.removeEventListener\('pointerdown', closeSensorMenuOnOutsidePointer\)/)
})
