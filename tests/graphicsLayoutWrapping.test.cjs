const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('graphics page prevents status pills and display output chips from awkward wrapping', () => {
  const source = readSource('src/components/GraphicsPage/index.vue')

  assert.match(source, /\.status-pill\s*{[\s\S]*white-space:\s*nowrap;/)
  assert.match(source, /\.status-pill\s*{[\s\S]*flex-shrink:\s*0;/)
  assert.match(source, /\.port-grid\s*{[\s\S]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(120px,\s*1fr\)\);/)
  assert.match(source, /\.port-chip\s*{[\s\S]*min-width:\s*0;/)
  assert.match(source, /\.port-chip\s*{[\s\S]*strong\s*{[\s\S]*line-height:\s*1\.25;/)
  assert.match(source, /const detailSpecs = computed\(\(\) => {[\s\S]*\.filter\(\(item\) => item\.value && item\.value !== '--'\)/)
  assert.match(source, /未提供检测结果/)
  assert.match(source, /typeof gpu\?\.vramDynamic === 'boolean'/)
  assert.doesNotMatch(source, /gpu\?\.vendor\) \? '已检测'/)
  assert.match(source, /status: gpu\?\.pciBus \? '已枚举' : '未知'/)
  assert.match(source, /const gpuTemperature = safeNumber\(gpu\?\.temperatureGpu\)/)
  assert.match(source, /status: gpuTemperature === null \? '暂无'/)
  assert.match(source, /status: memoryTemperature === null \? '暂无'/)
  assert.match(source, /function buildHistoryFooter\(values: number\[\], current: number \| null/)
  assert.match(source, /if \(current === null && !values\.length\)/)
})
