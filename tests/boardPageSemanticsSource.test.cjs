const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

test('board page does not infer UEFI support or firmware mode from BIOS vendor presence', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/components/BoardPage/index.vue'), 'utf8')

  assert.match(source, /label: '固件模式', value: isDarwinPlatform\.value \? 'Apple 平台固件' : '系统未提供'/)
  assert.doesNotMatch(source, /UEFI \/ Legacy 兼容/)
  assert.doesNotMatch(source, /UEFI 固件支持/)
  assert.match(source, /音频设备已识别/)
  assert.match(source, /网络接口已识别/)
  assert.doesNotMatch(source, /板载音频已识别|板载网络已识别/)
})

test('board page distinguishes failed reads from missing hardware and retains partial details', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/components/BoardPage/index.vue'), 'utf8')

  assert.match(source, /fetchState,/)
  assert.match(source, /const pageStateBlock = computed/)
  assert.match(source, /title: '主板数据读取失败'/)
  assert.match(source, /title: '未识别到主板信息'/)
  assert.match(source, /const partialReadStatus = computed/)
  assert.match(source, /const partialReadDetails = computed/)
  assert.match(source, /getServiceErrorDescription\(\s*fetchState\[key\]\.note/)
  assert.match(source, /部分内容暂未更新/)
  assert.match(source, /:title="partialReadDetails"/)
  assert.match(source, /重新读取/)
  assert.match(source, /读取状态：\$\{partialReadStatus\.value\}/)
})
