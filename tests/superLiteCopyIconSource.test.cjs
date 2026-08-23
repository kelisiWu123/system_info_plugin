const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

test('super-lite footer uses explicit labels instead of font-dependent symbol icons', () => {
  const watch = fs.readFileSync(path.join(__dirname, '..', 'src/components/Watch/index.vue'), 'utf8')
  const utility = fs.readFileSync(path.join(__dirname, '..', 'src/utils/superLiteMonitor.ts'), 'utf8')

  assert.match(watch, /`运行 \$\{formatWatchRuntime\(/)
  assert.doesNotMatch(watch, /⏱/)
  assert.match(utility, /return `更新 \$\{/)
  assert.doesNotMatch(utility, /↻/)
})
