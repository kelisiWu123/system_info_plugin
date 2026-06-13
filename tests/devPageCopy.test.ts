import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveDevPageCopyTarget } from '../src/utils/devPageCopy'

test('resolves the dev copy target for each supported hardware section', () => {
  assert.deepEqual(resolveDevPageCopyTarget('overview'), {
    section: 'overview',
    methodName: 'copyOverviewInfo',
    buttonLabel: '拷贝当前页信息',
  })

  assert.deepEqual(resolveDevPageCopyTarget('processor'), {
    section: 'processor',
    methodName: 'copyProcessorInfo',
    buttonLabel: '拷贝当前页信息',
  })

  assert.deepEqual(resolveDevPageCopyTarget('graphics'), {
    section: 'graphics',
    methodName: 'copyGraphicsInfo',
    buttonLabel: '拷贝当前页信息',
  })
})

test('returns null for sections without a dev copy action', () => {
  assert.equal(resolveDevPageCopyTarget('watch'), null)
  assert.equal(resolveDevPageCopyTarget('settings'), null)
})
