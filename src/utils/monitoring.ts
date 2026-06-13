import { reactive } from 'vue'
import { clampPercent } from '../utils'

export type HardwareMonitorScope = 'overview' | 'processor' | 'graphics' | 'board' | 'memory' | 'storage'

export type MonitoringRefreshProfile = 'eco' | 'balanced' | 'realtime'

export interface MonitoringRefreshSettingsData {
  profile: MonitoringRefreshProfile
  backgroundThrottleEnabled: boolean
}

export interface DynamicMetricRequirements {
  cpuTemp: boolean
  cpuLoad: boolean
  cpuLoadDetail: boolean
  cpuSpeed: boolean
  cpuAux: boolean
  gpu: boolean
  memory: boolean
  disk: boolean
  time: boolean
}

export interface MonitoringRefreshIntervals {
  base: number
  cpuTemp: number
  cpuSpeed: number
  cpuAux: number
  cpuLoadDetail: number
  gpu: number
  memory: number
  disk: number
  time: number
}

export interface MonitoringDiagnosticsState {
  scope: string
  activeSubscribers: number
  activationCount: number
  deactivationCount: number
  refreshAttemptCount: number
  refreshSuccessCount: number
  forcedRefreshCount: number
  skippedRefreshCount: number
  backgroundRefreshCount: number
  foregroundRefreshCount: number
  lastMode: 'foreground' | 'background' | 'unknown'
  lastRefreshMode?: 'foreground' | 'background'
  lastActivatedAt?: number
  lastDeactivatedAt?: number
  lastAttemptedAt?: number
  lastRefreshedAt?: number
  lastSkippedAt?: number
  lastSkipReason?: string
}

export const DEFAULT_MONITORING_REFRESH_SETTINGS: MonitoringRefreshSettingsData = {
  profile: 'balanced',
  backgroundThrottleEnabled: true,
}

const EMPTY_DYNAMIC_REQUIREMENTS: DynamicMetricRequirements = {
  cpuTemp: false,
  cpuLoad: false,
  cpuLoadDetail: false,
  cpuSpeed: false,
  cpuAux: false,
  gpu: false,
  memory: false,
  disk: false,
  time: false,
}

const SCOPE_REQUIREMENTS: Record<HardwareMonitorScope, DynamicMetricRequirements> = {
  overview: {
    cpuTemp: true,
    cpuLoad: true,
    cpuLoadDetail: false,
    cpuSpeed: true,
    cpuAux: false,
    gpu: true,
    memory: true,
    disk: true,
    time: true,
  },
  processor: {
    cpuTemp: true,
    cpuLoad: true,
    cpuLoadDetail: true,
    cpuSpeed: true,
    cpuAux: true,
    gpu: false,
    memory: false,
    disk: false,
    time: true,
  },
  graphics: {
    cpuTemp: false,
    cpuLoad: false,
    cpuLoadDetail: false,
    cpuSpeed: false,
    cpuAux: false,
    gpu: true,
    memory: false,
    disk: false,
    time: false,
  },
  board: {
    cpuTemp: false,
    cpuLoad: false,
    cpuLoadDetail: false,
    cpuSpeed: false,
    cpuAux: false,
    gpu: false,
    memory: false,
    disk: false,
    time: false,
  },
  memory: {
    cpuTemp: false,
    cpuLoad: false,
    cpuLoadDetail: false,
    cpuSpeed: false,
    cpuAux: false,
    gpu: false,
    memory: true,
    disk: false,
    time: true,
  },
  storage: {
    cpuTemp: false,
    cpuLoad: false,
    cpuLoadDetail: false,
    cpuSpeed: false,
    cpuAux: false,
    gpu: false,
    memory: false,
    disk: true,
    time: false,
  },
}

const PROFILE_INTERVALS: Record<MonitoringRefreshProfile, MonitoringRefreshIntervals> = {
  eco: {
    base: 8000,
    cpuTemp: 10000,
    cpuSpeed: 8000,
    cpuAux: 18000,
    cpuLoadDetail: 10000,
    gpu: 12000,
    memory: 8000,
    disk: 10000,
    time: 10000,
  },
  balanced: {
    base: 4000,
    cpuTemp: 7000,
    cpuSpeed: 4000,
    cpuAux: 12000,
    cpuLoadDetail: 4000,
    gpu: 8000,
    memory: 4000,
    disk: 6000,
    time: 5000,
  },
  realtime: {
    base: 2000,
    cpuTemp: 3500,
    cpuSpeed: 2000,
    cpuAux: 8000,
    cpuLoadDetail: 2000,
    gpu: 4000,
    memory: 2000,
    disk: 4000,
    time: 4000,
  },
}

export function normalizeMonitoringRefreshSettings(input: Partial<MonitoringRefreshSettingsData> | null | undefined): MonitoringRefreshSettingsData {
  const profile = input?.profile === 'eco' || input?.profile === 'balanced' || input?.profile === 'realtime'
    ? input.profile
    : DEFAULT_MONITORING_REFRESH_SETTINGS.profile

  return {
    profile,
    backgroundThrottleEnabled:
      typeof input?.backgroundThrottleEnabled === 'boolean'
        ? input.backgroundThrottleEnabled
        : DEFAULT_MONITORING_REFRESH_SETTINGS.backgroundThrottleEnabled,
  }
}

export function getDynamicMetricRequirementsForScopes(scopes: HardwareMonitorScope[]): DynamicMetricRequirements {
  return scopes.reduce<DynamicMetricRequirements>((merged, scope) => {
    const next = SCOPE_REQUIREMENTS[scope]
    return {
      cpuTemp: merged.cpuTemp || next.cpuTemp,
      cpuLoad: merged.cpuLoad || next.cpuLoad,
      cpuLoadDetail: merged.cpuLoadDetail || next.cpuLoadDetail,
      cpuSpeed: merged.cpuSpeed || next.cpuSpeed,
      cpuAux: merged.cpuAux || next.cpuAux,
      gpu: merged.gpu || next.gpu,
      memory: merged.memory || next.memory,
      disk: merged.disk || next.disk,
      time: merged.time || next.time,
    }
  }, { ...EMPTY_DYNAMIC_REQUIREMENTS })
}

export function getMonitoringRefreshIntervals(profile: MonitoringRefreshProfile, isBackground: boolean): MonitoringRefreshIntervals {
  const base = PROFILE_INTERVALS[profile]
  if (!isBackground) return { ...base }

  return {
    base: base.base * 3,
    cpuTemp: base.cpuTemp * 2,
    cpuSpeed: base.cpuSpeed * 2,
    cpuAux: 0,
    cpuLoadDetail: 0,
    gpu: 0,
    memory: base.memory * 2,
    disk: base.disk * 2,
    time: base.time * 2,
  }
}

export function appendMetricHistory(history: number[], value: number, clamp = false, limit = 24) {
  const nextValue = clamp ? clampPercent(value) : Number.isFinite(value) ? value : 0
  history.push(nextValue)

  while (history.length > limit) {
    history.shift()
  }

  return history
}

function getMonitoringDiagnosticsRegistry() {
  const host = globalThis as typeof globalThis & {
    __SYSTEM_INFO_MONITORING_DIAGNOSTICS__?: Record<string, MonitoringDiagnosticsState>
  }

  if (!host.__SYSTEM_INFO_MONITORING_DIAGNOSTICS__) {
    host.__SYSTEM_INFO_MONITORING_DIAGNOSTICS__ = {}
  }

  return host.__SYSTEM_INFO_MONITORING_DIAGNOSTICS__
}

export function createMonitoringDiagnostics(scope: string) {
  const state = reactive<MonitoringDiagnosticsState>({
    scope,
    activeSubscribers: 0,
    activationCount: 0,
    deactivationCount: 0,
    refreshAttemptCount: 0,
    refreshSuccessCount: 0,
    forcedRefreshCount: 0,
    skippedRefreshCount: 0,
    backgroundRefreshCount: 0,
    foregroundRefreshCount: 0,
    lastMode: 'unknown',
  })

  getMonitoringDiagnosticsRegistry()[scope] = state

  function setActiveSubscribers(count: number) {
    state.activeSubscribers = Math.max(0, count)
  }

  function markActivated(count: number) {
    setActiveSubscribers(count)
    state.activationCount += 1
    state.lastActivatedAt = Date.now()
  }

  function markDeactivated(count: number) {
    setActiveSubscribers(count)
    state.deactivationCount += 1
    state.lastDeactivatedAt = Date.now()
  }

  function markRefreshAttempt(forced: boolean, isBackground: boolean) {
    state.refreshAttemptCount += 1
    state.lastAttemptedAt = Date.now()
    state.lastMode = isBackground ? 'background' : 'foreground'
    if (forced) state.forcedRefreshCount += 1
  }

  function markRefreshSuccess(isBackground: boolean) {
    state.refreshSuccessCount += 1
    state.lastRefreshedAt = Date.now()
    state.lastMode = isBackground ? 'background' : 'foreground'
    state.lastRefreshMode = isBackground ? 'background' : 'foreground'
    if (isBackground) state.backgroundRefreshCount += 1
    else state.foregroundRefreshCount += 1
    state.lastSkipReason = ''
  }

  function markRefreshSkipped(reason: string, isBackground: boolean) {
    state.skippedRefreshCount += 1
    state.lastSkippedAt = Date.now()
    state.lastSkipReason = reason
    state.lastMode = isBackground ? 'background' : 'foreground'
  }

  return {
    state,
    setActiveSubscribers,
    markActivated,
    markDeactivated,
    markRefreshAttempt,
    markRefreshSuccess,
    markRefreshSkipped,
  }
}
