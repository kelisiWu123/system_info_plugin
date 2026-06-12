import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildWatchCpuOverviewSideItems,
  formatWatchRuntime,
  formatWatchCpuSpeedSourceLabel,
  getWatchCpuAuxMetricIds,
  getWatchOverviewSideColumnCount,
  getWatchCpuPalette,
  getWatchGpuPalette,
  getWatchMemoryPalette,
  WATCH_MODE_POLL_PROFILES,
} from '../src/utils/watch'

test('uses purple palette for CPU watch charts', () => {
  const palette = getWatchCpuPalette()

  assert.deepEqual(palette, {
    icon: '#a775ff',
    fill: 'rgba(167, 117, 255, 0.22)',
    stroke: '#a775ff',
    progress: 'linear-gradient(90deg, #9568ff, #b98dff)',
    border: 'rgba(167, 117, 255, 0.34)',
  })
})

test('uses cyan-blue palette for GPU watch charts', () => {
  const palette = getWatchGpuPalette()

  assert.deepEqual(palette, {
    icon: '#79e7ff',
    fill: 'rgba(121, 231, 255, 0.30)',
    stroke: '#79e7ff',
    progress: 'linear-gradient(90deg, #4bd9ff, #9df2ff)',
    border: 'rgba(121, 231, 255, 0.40)',
  })
})

test('uses memory pressure palette on macOS watch charts', () => {
  assert.deepEqual(getWatchMemoryPalette('darwin', 'normal'), {
    icon: '#79d84f',
    fill: 'rgba(121, 216, 79, 0.22)',
    stroke: '#79d84f',
    progress: 'linear-gradient(90deg, #67c93f, #8de061)',
    border: 'rgba(121, 216, 79, 0.34)',
  })

  assert.deepEqual(getWatchMemoryPalette('darwin', 'warning'), {
    icon: '#ffb14d',
    fill: 'rgba(255, 177, 77, 0.22)',
    stroke: '#ffb14d',
    progress: 'linear-gradient(90deg, #ff9f36, #ffc164)',
    border: 'rgba(255, 177, 77, 0.34)',
  })

  assert.deepEqual(getWatchMemoryPalette('darwin', 'critical'), {
    icon: '#ff7f87',
    fill: 'rgba(255, 127, 135, 0.22)',
    stroke: '#ff7f87',
    progress: 'linear-gradient(90deg, #ff6b75, #ff9299)',
    border: 'rgba(255, 127, 135, 0.34)',
  })
})

test('falls back to green memory palette for unknown macOS pressure and non-macOS', () => {
  const fallback = {
    icon: '#79d84f',
    fill: 'rgba(121, 216, 79, 0.22)',
    stroke: '#79d84f',
    progress: 'linear-gradient(90deg, #67c93f, #8de061)',
    border: 'rgba(121, 216, 79, 0.34)',
  }

  assert.deepEqual(getWatchMemoryPalette('darwin', 'unknown'), fallback)
  assert.deepEqual(getWatchMemoryPalette('win32', 'critical'), fallback)
})

test('uses user-facing CPU frequency source labels in watch', () => {
  assert.equal(formatWatchCpuSpeedSourceLabel({ source: 'powermetrics', helper: true }), '传感器增强')
  assert.equal(formatWatchCpuSpeedSourceLabel({ source: 'powermetrics', helper: false }), '增强采样')
  assert.equal(
    formatWatchCpuSpeedSourceLabel({ source: 'systeminformation', nativeErrorCode: 'MACOS_POWERMETRICS_HELPER_UNAVAILABLE' }),
    '内置采集'
  )
  assert.equal(
    formatWatchCpuSpeedSourceLabel({ source: 'systeminformation', nativeErrorCode: 'MACOS_POWERMETRICS_PERMISSION_REQUIRED' }),
    '可启用传感器增强'
  )
})

test('builds CPU overview side items with temperature and power', () => {
  assert.deepEqual(
    buildWatchCpuOverviewSideItems({
      temperatureValue: '58°C',
      powerValue: '14.2 W',
    }),
    [
      { id: 'temperature', icon: 'temperature', label: '温度', value: '58°C' },
      { id: 'power', icon: 'dashboard', label: '功耗', value: '14.2 W' },
    ]
  )
})

test('overview watch mode polls CPU temperature and power without auxiliary sensors', () => {
  assert.equal(WATCH_MODE_POLL_PROFILES.overview.cpuTemp, 4500)
  assert.equal(WATCH_MODE_POLL_PROFILES.overview.cpuPower, 10000)
  assert.equal(WATCH_MODE_POLL_PROFILES.overview.cpuAux, 0)
})

test('watch CPU detail uses platform-aware auxiliary metrics', () => {
  assert.deepEqual(getWatchCpuAuxMetricIds('darwin'), ['fan'])
  assert.deepEqual(getWatchCpuAuxMetricIds('win32'), ['voltage', 'fan'])
  assert.deepEqual(getWatchCpuAuxMetricIds('other'), ['voltage', 'fan'])
})

test('watch overview uses a single side column for one or two metrics', () => {
  assert.equal(getWatchOverviewSideColumnCount(1), 1)
  assert.equal(getWatchOverviewSideColumnCount(2), 1)
})

test('formats watch runtime with explicit days after 24 hours', () => {
  assert.equal(formatWatchRuntime(), '--:--:--')
  assert.equal(formatWatchRuntime(3661), '01:01:01')
  assert.equal(formatWatchRuntime(90061), '1天 01:01:01')
  assert.equal(formatWatchRuntime(176461), '2天 01:01:01')
})
