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

test('computes GPU idle percent from explicit idle telemetry when available', () => {
  const { getGpuIdlePercent } = loadTsModule('src/utils/gpu.ts')

  assert.equal(getGpuIdlePercent({ idleResidencyGpu: 61.4 }), 61.4)
})

test('falls back to 100 - utilization when GPU idle telemetry is missing', () => {
  const { getGpuIdlePercent } = loadTsModule('src/utils/gpu.ts')

  assert.equal(getGpuIdlePercent({ utilizationGpu: 37.2 }), 62.8)
})

test('graphics page derives displayed GPU idle percent through the shared helper', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/components/GraphicsPage/index.vue'), 'utf8')

  assert.match(source, /getGpuIdlePercent/)
  assert.doesNotMatch(source, /formatPercent\(safeNumber\(gpu\?\.idleResidencyGpu\)\)/)
  assert.doesNotMatch(source, /typeof gpu\?\.idleResidencyGpu !== 'number'/)
})

test('system service derives GPU idle residency before returning runtime telemetry', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'utools/services/system.js'), 'utf8')

  assert.match(source, /function deriveGpuIdleResidency\(idleResidencyGpu, utilizationGpu\)/)
  assert.match(source, /const idleResidencyGpu = deriveGpuIdleResidency\(/)
  assert.match(source, /return Math\.round\(\(100 - normalizedUtilization\) \* 10\) \/ 10/)
})
