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

test('uses one user-facing sensor enhancement vocabulary on Windows and macOS', () => {
  const {
    getSensorEnhancementActionLabel,
    getSensorEnhancementControlLabel,
    getSensorEnhancementMenuAriaLabel,
    getSensorEnhancementPrimaryActionLabel,
  } = loadTsModule('src/utils/platform.ts')

  for (const platform of ['windows', 'macos']) {
    assert.equal(getSensorEnhancementActionLabel(platform, false), '传感器增强')
    assert.equal(getSensorEnhancementActionLabel(platform, true), '收起增强模式')
    assert.equal(getSensorEnhancementControlLabel(platform), '传感器增强')
    assert.equal(getSensorEnhancementMenuAriaLabel(platform), '打开传感器增强菜单')
    assert.equal(getSensorEnhancementPrimaryActionLabel(platform, false), '启用增强模式')
    assert.equal(getSensorEnhancementPrimaryActionLabel(platform, true), '关闭增强模式')
  }
})
