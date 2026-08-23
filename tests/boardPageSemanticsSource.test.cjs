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
