import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createMonitoringDiagnostics,
  DEFAULT_MONITORING_REFRESH_SETTINGS,
  getDynamicMetricRequirementsForScopes,
  getMonitoringRefreshIntervals,
  normalizeMonitoringRefreshSettings,
} from '../src/utils/monitoring'

test('uses balanced refresh settings by default', () => {
  assert.deepEqual(DEFAULT_MONITORING_REFRESH_SETTINGS, {
    profile: 'balanced',
    backgroundThrottleEnabled: true,
  })
})

test('normalizes invalid refresh settings back to safe defaults', () => {
  assert.deepEqual(
    normalizeMonitoringRefreshSettings({
      profile: 'turbo' as never,
      backgroundThrottleEnabled: 'yes' as never,
    }),
    {
      profile: 'balanced',
      backgroundThrottleEnabled: true,
    }
  )
})

test('maps active scopes to only the dynamic metrics they need', () => {
  assert.deepEqual(getDynamicMetricRequirementsForScopes(['overview']), {
    cpuTemp: true,
    cpuLoad: true,
    cpuLoadDetail: false,
    cpuSpeed: true,
    cpuAux: false,
    gpu: true,
    memory: true,
    disk: true,
    time: true,
  })

  assert.deepEqual(getDynamicMetricRequirementsForScopes(['processor']), {
    cpuTemp: true,
    cpuLoad: true,
    cpuLoadDetail: true,
    cpuSpeed: true,
    cpuAux: true,
    gpu: false,
    memory: false,
    disk: false,
    time: true,
  })
})

test('merges multiple active scopes without enabling unrelated heavy metrics in the background', () => {
  const requirements = getDynamicMetricRequirementsForScopes(['overview', 'storage'])
  assert.equal(requirements.cpuLoad, true)
  assert.equal(requirements.disk, true)
  assert.equal(requirements.cpuAux, false)
})

test('applies stronger throttling when the window is in the background', () => {
  const foreground = getMonitoringRefreshIntervals('balanced', false)
  const background = getMonitoringRefreshIntervals('balanced', true)

  assert.equal(foreground.base, 4000)
  assert.equal(background.base, 12000)
  assert.equal(background.gpu, 0)
  assert.equal(background.cpuAux, 0)
  assert.equal(background.cpuLoadDetail, 0)
})

test('tracks monitoring diagnostics for activations and refresh outcomes', () => {
  const diagnostics = createMonitoringDiagnostics('test-scope')

  diagnostics.markActivated(1)
  diagnostics.markRefreshAttempt(true, false)
  diagnostics.markRefreshSuccess(false)
  diagnostics.markRefreshSkipped('background-paused', true)
  diagnostics.markDeactivated(0)

  assert.equal(diagnostics.state.activeSubscribers, 0)
  assert.equal(diagnostics.state.activationCount, 1)
  assert.equal(diagnostics.state.deactivationCount, 1)
  assert.equal(diagnostics.state.refreshAttemptCount, 1)
  assert.equal(diagnostics.state.refreshSuccessCount, 1)
  assert.equal(diagnostics.state.forcedRefreshCount, 1)
  assert.equal(diagnostics.state.skippedRefreshCount, 1)
  assert.equal(diagnostics.state.foregroundRefreshCount, 1)
  assert.equal(diagnostics.state.lastRefreshMode, 'foreground')
  assert.equal(diagnostics.state.lastMode, 'background')
  assert.equal(diagnostics.state.lastSkipReason, 'background-paused')
})
