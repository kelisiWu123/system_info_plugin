const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

test('navigation and sibling actions clear stale header feedback', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/App.vue'), 'utf8')

  assert.match(source, /function clearCopyFeedback\(\)[\s\S]*copyFeedback\.value = 'idle'/)
  assert.match(source, /function selectSection\(id: SidebarItem\['id'\]\) {[\s\S]*clearCopyFeedback\(\)/)
  assert.match(source, /async function copyCurrentSectionInfo\(\) {[\s\S]*clearExportFeedback\(\)/)
  assert.match(source, /function exportCurrentSectionReport\(\) {[\s\S]*if \(copyPending\.value\) return[\s\S]*clearCopyFeedback\(\)/)
})
