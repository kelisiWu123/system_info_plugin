import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getSensorEnhancementActionLabel,
  getSensorEnhancementPlatform,
  normalizeOsPlatform,
} from '../src/utils/platform'
import { getProcessorAuxDisplayMode } from '../src/utils/processor'
import { formatGpuTemperatureSensorLabel, getGraphicsPlatformPanelVisibility } from '../src/utils/gpu'

test('normalizes Windows platform variants to win32', () => {
  assert.equal(normalizeOsPlatform({ platform: 'win32', distro: 'Microsoft Windows 11 Pro' }), 'win32')
  assert.equal(normalizeOsPlatform({ platform: 'Windows_NT', distro: 'Windows 11 Pro' }), 'win32')
})

test('normalizes macOS platform variants to darwin', () => {
  assert.equal(normalizeOsPlatform({ platform: 'darwin', distro: 'macOS Sequoia' }), 'darwin')
  assert.equal(normalizeOsPlatform({ platform: 'mac os', distro: '' }), 'darwin')
})

test('falls back to other for unsupported platforms', () => {
  assert.equal(normalizeOsPlatform({ platform: 'linux', distro: 'Ubuntu 24.04' }), 'other')
  assert.equal(normalizeOsPlatform({ platform: '', distro: '' }), 'other')
})

test('maps normalized platforms to the correct sensor enhancement variant', () => {
  assert.equal(getSensorEnhancementPlatform({ platform: 'win32', distro: 'Windows 11 Pro' }), 'windows')
  assert.equal(getSensorEnhancementPlatform({ platform: 'darwin', distro: 'macOS Sequoia' }), 'macos')
  assert.equal(getSensorEnhancementPlatform({ platform: 'linux', distro: 'Ubuntu' }), 'unsupported')
})

test('uses unified sensor enhancement action labels', () => {
  assert.equal(getSensorEnhancementActionLabel('windows', false), '传感器增强')
  assert.equal(getSensorEnhancementActionLabel('windows', true), '收起增强模式')
  assert.equal(getSensorEnhancementActionLabel('macos', false), '传感器增强')
  assert.equal(getSensorEnhancementActionLabel('macos', true), '收起增强模式')
})

test('uses CPU fan instead of voltage on macOS processor panel', () => {
  assert.equal(getProcessorAuxDisplayMode('macos'), 'fan')
  assert.equal(getProcessorAuxDisplayMode('windows'), 'voltage')
  assert.equal(getProcessorAuxDisplayMode('unsupported'), 'voltage')
})

test('formats raw AppleSMC GPU sensor labels into human-readable names', () => {
  assert.equal(formatGpuTemperatureSensorLabel({ name: 'AppleSMC Tg0C', identifier: 'Tg0C' }, 0), 'GPU 测点 1')
  assert.equal(formatGpuTemperatureSensorLabel({ name: 'GPU hotspot', identifier: 'Tg0H' }, 1), 'GPU 热点')
  assert.equal(formatGpuTemperatureSensorLabel({ name: 'GPU cluster', identifier: 'Tg05' }, 2), 'GPU 集群测点 3')
})

test('uses platform-specific GPU monitoring panels', () => {
  assert.deepEqual(getGraphicsPlatformPanelVisibility('darwin'), {
    temperatureProbes: true,
    telemetryDetails: false,
  })
  assert.deepEqual(getGraphicsPlatformPanelVisibility('win32'), {
    temperatureProbes: false,
    telemetryDetails: true,
  })
  assert.deepEqual(getGraphicsPlatformPanelVisibility('other'), {
    temperatureProbes: false,
    telemetryDetails: false,
  })
})
