const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

function loadTsModule(relativePath) {
  const filePath = path.join(__dirname, '..', relativePath)
  const source = fs.readFileSync(filePath, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  })

  const module = { exports: {} }
  const wrapped = new Function('require', 'module', 'exports', '__filename', '__dirname', compiled.outputText)
  wrapped(require, module, module.exports, filePath, path.dirname(filePath))
  return module.exports
}

test('uses OHM-specific Windows labels while keeping macOS enhancement wording', () => {
  const {
    getSensorEnhancementActionLabel,
    getSensorEnhancementControlLabel,
    getSensorEnhancementMenuAriaLabel,
    getSensorEnhancementPrimaryActionLabel,
  } = loadTsModule('src/utils/platform.ts')

  assert.equal(getSensorEnhancementActionLabel('windows', false), 'OpenHardwareMonitor')
  assert.equal(getSensorEnhancementActionLabel('windows', true), '收起 OHM 菜单')
  assert.equal(getSensorEnhancementControlLabel('windows'), 'OpenHardwareMonitor')
  assert.equal(getSensorEnhancementMenuAriaLabel('windows'), '打开 OpenHardwareMonitor 菜单')
  assert.equal(getSensorEnhancementPrimaryActionLabel('windows', false), '启用 OHM 支持')
  assert.equal(getSensorEnhancementPrimaryActionLabel('windows', true), '关闭 OHM 支持')

  assert.equal(getSensorEnhancementActionLabel('macos', false), '传感器增强')
  assert.equal(getSensorEnhancementActionLabel('macos', true), '收起增强模式')
  assert.equal(getSensorEnhancementControlLabel('macos'), '传感器增强')
  assert.equal(getSensorEnhancementMenuAriaLabel('macos'), '打开传感器增强菜单')
  assert.equal(getSensorEnhancementPrimaryActionLabel('macos', false), '启用增强模式')
  assert.equal(getSensorEnhancementPrimaryActionLabel('macos', true), '关闭增强模式')
})
