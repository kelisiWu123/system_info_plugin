const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('interactive page navigation exposes selected state to assistive technology', () => {
  const app = readProjectFile('src/App.vue')
  const watch = readProjectFile('src/components/Watch/index.vue')
  const board = readProjectFile('src/components/BoardPage/index.vue')
  const dashboard = readProjectFile('src/components/MonitoringDashboard/index.vue')

  assert.match(app, /:aria-current="selectedSection === item\.id \? 'page' : undefined"/)
  assert.match(watch, /:aria-pressed="monitorMode === 'overview'"/)
  assert.match(watch, /:aria-pressed="monitorMode === 'cpu'"/)
  assert.match(watch, /:aria-pressed="monitorMode === 'gpu'"/)
  assert.match(watch, /role="group" aria-label="监控视图"/)
  assert.match(board, /role="tablist" aria-label="主板信息分类"/)
  assert.match(board, /role="tab"[\s\S]*:aria-selected="activeTab === tab\.id"/)
  assert.match(dashboard, /:aria-pressed="monitoringRefreshSettings\.profile === profile\.id"/)
})
