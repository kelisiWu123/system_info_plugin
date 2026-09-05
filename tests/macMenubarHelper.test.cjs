const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

function loadMacMenubarSettingsFunctions() {
  const source = fs.readFileSync(path.join(__dirname, '../utools/services/system.js'), 'utf8')
  
  const normMatch = source.match(/function normalizeMacMenubarSettings\(input\) \{[\s\S]*?\n\}/)
  if (!normMatch) throw new Error('normalizeMacMenubarSettings not found')

  const code = `
    ${normMatch[0]}
    module.exports = { normalizeMacMenubarSettings };
  `
  const context = { module: { exports: {} } }
  vm.runInNewContext(code, context)
  return context.module.exports
}

test('normalizeMacMenubarSettings normalizes empty or partial inputs to sensible defaults', () => {
  const { normalizeMacMenubarSettings } = loadMacMenubarSettingsFunctions()

  const defaults = normalizeMacMenubarSettings({})
  assert.equal(defaults.enabled, false)
  assert.equal(defaults.showTemp, true)
  assert.equal(defaults.showLoad, true)
  assert.equal(defaults.showIcon, true)

  const customized = normalizeMacMenubarSettings({
    enabled: true,
    showTemp: false,
    showLoad: true,
    showIcon: false,
  })
  assert.equal(customized.enabled, true)
  assert.equal(customized.showTemp, false)
  assert.equal(customized.showLoad, true)
  assert.equal(customized.showIcon, false)
})

test('macMenubarHelper telemetry serialization formats JSON payload correctly', () => {
  const source = fs.readFileSync(path.join(__dirname, '../utools/services/macMenubarHelper.js'), 'utf8')
  assert.ok(source.includes('updateMacMenubarTelemetry'), 'macMenubarHelper must export updateMacMenubarTelemetry')
  assert.ok(source.includes('startMacMenubarHelper'), 'macMenubarHelper must export startMacMenubarHelper')
  assert.ok(source.includes('stopMacMenubarHelper'), 'macMenubarHelper must export stopMacMenubarHelper')
  assert.ok(source.includes('getMacMenubarStatus'), 'macMenubarHelper must export getMacMenubarStatus')
})
