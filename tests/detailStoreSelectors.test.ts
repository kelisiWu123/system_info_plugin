import assert from 'node:assert/strict'
import test from 'node:test'

import { selectPrimaryGpu } from '../src/utils/gpu'
import { appendMetricHistory } from '../src/utils/monitoring'

test('prefers discrete GPU telemetry when selecting the primary GPU', () => {
  const primary = selectPrimaryGpu([
    {
      model: 'Intel Iris Xe',
      vendor: 'Intel',
      vram: 1536,
      memoryTotal: 1536,
      bus: 'Built-In',
      utilizationGpu: 18,
      temperatureGpu: 54,
    },
    {
      model: 'NVIDIA GeForce RTX 4070',
      vendor: 'NVIDIA',
      vram: 12288,
      memoryTotal: 12288,
      bus: 'PCIe x16',
      utilizationGpu: 52,
      temperatureGpu: 71,
      powerDraw: 162,
    },
  ])

  assert.equal(primary?.model, 'NVIDIA GeForce RTX 4070')
})

test('bounds metric history length and normalizes invalid values', () => {
  const history = Array.from({ length: 24 }, (_, index) => index + 1)

  appendMetricHistory(history, Number.NaN)

  assert.equal(history.length, 24)
  assert.equal(history[0], 2)
  assert.equal(history.at(-1), 0)
})

test('clamps percentage-based metric history entries when requested', () => {
  const history: number[] = []

  appendMetricHistory(history, 132, true)

  assert.deepEqual(history, [100])
})
