import assert from 'node:assert/strict'
import test from 'node:test'

import { getOverviewGpuLines, getOverviewStorageLines } from '../src/utils/overview'

test('builds a single overview GPU line from the primary GPU summary', () => {
  assert.deepEqual(
    getOverviewGpuLines({
      model: 'NVIDIA GeForce RTX 4070',
      memoryTotal: 12288,
      bus: 'PCIe',
    }),
    ['NVIDIA GeForce RTX 4070 / 12 GB / PCIe']
  )
})

test('omits overview GPU lines when no primary GPU is available', () => {
  assert.deepEqual(getOverviewGpuLines(undefined), [])
})

test('builds overview storage lines from aggregated usage only', () => {
  assert.deepEqual(
    getOverviewStorageLines({
      total: 1024 ** 4,
      used: 512 * 1024 ** 3,
    }),
    ['已用 512 GB / 1.00 TB']
  )
})

test('omits overview storage lines when aggregate capacity is missing', () => {
  assert.deepEqual(getOverviewStorageLines({ total: 0, used: 0 }), [])
})
