const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

test('overview processor summary labels the static frequency separately from live frequency', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/components/Computer/index.vue'), 'utf8')

  assert.match(source, /cpuData\.value\?\.speed \? `标称 \$\{cpuData\.value\.speed\} GHz`/)
  assert.match(source, /fieldItems\.push\('CPU 标称频率'\)/)
  assert.doesNotMatch(source, /fieldItems\.push\('CPU 当前频率'\)/)
})
