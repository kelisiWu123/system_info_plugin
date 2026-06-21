import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getSensorEnhancementControlLabel,
  getSensorEnhancementMenuAriaLabel,
  getSensorEnhancementPrimaryActionLabel,
  getSensorEnhancementActionLabel,
  getSensorEnhancementPlatform,
  isSensorEnhancementDefaultEnabled,
  normalizeOsPlatform,
  shouldAutoPrepareSensorEnhancement,
} from '../src/utils/platform'
import { getProcessorAuxDisplayMode, getProcessorIdlePercent } from '../src/utils/processor'
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

test('uses platform-specific sensor enhancement action labels', () => {
  assert.equal(getSensorEnhancementActionLabel('windows', false), 'OpenHardwareMonitor')
  assert.equal(getSensorEnhancementActionLabel('windows', true), '收起 OHM 菜单')
  assert.equal(getSensorEnhancementActionLabel('macos', false), '传感器增强')
  assert.equal(getSensorEnhancementActionLabel('macos', true), '收起增强模式')
})

test('uses platform-specific control labels for sensor enhancement entrypoints', () => {
  assert.equal(getSensorEnhancementControlLabel('windows'), 'OpenHardwareMonitor')
  assert.equal(getSensorEnhancementControlLabel('macos'), '传感器增强')
  assert.equal(getSensorEnhancementMenuAriaLabel('windows'), '打开 OpenHardwareMonitor 菜单')
  assert.equal(getSensorEnhancementMenuAriaLabel('macos'), '打开传感器增强菜单')
})

test('defaults sensor enhancement on for supported platforms', () => {
  assert.equal(isSensorEnhancementDefaultEnabled('windows'), true)
  assert.equal(isSensorEnhancementDefaultEnabled('macos'), true)
  assert.equal(isSensorEnhancementDefaultEnabled('unsupported'), false)
})

test('uses explicit primary labels for the visible enhancement control', () => {
  assert.equal(getSensorEnhancementPrimaryActionLabel('windows', true), '关闭 OHM 支持')
  assert.equal(getSensorEnhancementPrimaryActionLabel('windows', false), '启用 OHM 支持')
  assert.equal(getSensorEnhancementPrimaryActionLabel('macos', true), '关闭增强模式')
  assert.equal(getSensorEnhancementPrimaryActionLabel('macos', false), '启用增强模式')
})

test('auto prepares sensor enhancement only when enabled and not ready', () => {
  assert.equal(shouldAutoPrepareSensorEnhancement('windows', true, false), true)
  assert.equal(shouldAutoPrepareSensorEnhancement('macos', true, false), true)
  assert.equal(shouldAutoPrepareSensorEnhancement('windows', true, true), false)
  assert.equal(shouldAutoPrepareSensorEnhancement('macos', false, false), false)
  assert.equal(shouldAutoPrepareSensorEnhancement('unsupported', true, false), false)
})

test('uses CPU fan instead of voltage on macOS processor panel', () => {
  assert.equal(getProcessorAuxDisplayMode('macos'), 'fan')
  assert.equal(getProcessorAuxDisplayMode('windows'), 'voltage')
  assert.equal(getProcessorAuxDisplayMode('unsupported'), 'voltage')
})

test('computes CPU idle percent from currentLoadIdle when available', () => {
  assert.equal(getProcessorIdlePercent({ currentLoadIdle: 73.6 }), 73.6)
})

test('falls back to 100 - currentLoad when idle percent is missing', () => {
  assert.equal(getProcessorIdlePercent({ currentLoad: 42.4 }), 57.6)
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
