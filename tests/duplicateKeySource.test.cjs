const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

test('repeated display lines use positional keys instead of user-facing text', () => {
  const computer = readProjectFile('src/components/Computer/index.vue')
  const specs = readProjectFile('src/components/DeviceSpecsLite/index.vue')

  assert.match(computer, /v-for="\(line, lineIndex\) in card\.lines"\s+:key="`\$\{card\.id\}-line-\$\{lineIndex\}`"/)
  assert.match(computer, /v-for="\(line, lineIndex\) in row\.lines"\s+:key="`\$\{row\.id\}-line-\$\{lineIndex\}`"/)
  assert.match(specs, /v-for="\(fact, factIndex\) in card\.facts"\s+:key="`\$\{card\.id\}-fact-\$\{factIndex\}`"/)
  assert.match(specs, /v-for="\(line, lineIndex\) in row\.lines"\s+:key="`\$\{row\.id\}-line-\$\{lineIndex\}`"/)
})
