const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

test('plugin listing metadata describes the actual HWInfoX product without changing its plugin id', () => {
  const plugin = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugin.json'), 'utf8'))

  assert.equal(typeof plugin.name, 'string')
  assert.ok(plugin.name.trim())
  assert.equal(plugin.pluginName, 'HWInfoX 硬件信息')
  assert.match(plugin.description, /处理器.*显卡.*内存.*存储.*实时监控/)
})
