import type { SensorEnhancementPlatform } from './platform'

export type ProcessorAuxDisplayMode = 'voltage' | 'fan'
export interface ProcessorLoadLike {
  currentLoad?: number | null
  currentLoadIdle?: number | null
  cpus?: Array<{
    load?: number | null
  }> | null
}

export interface ProcessorCpuTopologyLike {
  physicalCores?: number | null
  cores?: number | null
  performanceCores?: number | null
  efficiencyCores?: number | null
}

export interface ProcessorCpuSpeedLike {
  cores?: Array<number | null | undefined> | null
  source?: string | null
}

export interface CpuHybridCoreCounts {
  performance: number
  efficiency: number
  total: number
}

function normalizePositiveCount(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0
  return Math.max(0, Math.round(value))
}

function countValidSpeedCores(cores?: Array<number | null | undefined> | null) {
  if (!Array.isArray(cores)) return 0
  return cores.filter((value) => typeof value === 'number' && Number.isFinite(value) && value > 0).length
}

function countLoadCores(cpus?: Array<{ load?: number | null }> | null) {
  return Array.isArray(cpus) ? cpus.length : 0
}

export function getProcessorAuxDisplayMode(platform: SensorEnhancementPlatform): ProcessorAuxDisplayMode {
  return platform === 'macos' ? 'fan' : 'voltage'
}

export function getCpuHybridCoreCounts(cpu?: ProcessorCpuTopologyLike | null): CpuHybridCoreCounts {
  const performance = normalizePositiveCount(cpu?.performanceCores)
  const efficiency = normalizePositiveCount(cpu?.efficiencyCores)

  if (!performance || !efficiency) {
    return {
      performance: 0,
      efficiency: 0,
      total: 0,
    }
  }

  const total = performance + efficiency
  const physical = normalizePositiveCount(cpu?.physicalCores)
  const logical = normalizePositiveCount(cpu?.cores)
  const upperBound = physical || logical

  if (upperBound > 0 && total > upperBound) {
    return {
      performance: 0,
      efficiency: 0,
      total: 0,
    }
  }

  return {
    performance,
    efficiency,
    total,
  }
}

export function getProcessorDisplayCoreCount(
  cpu?: ProcessorCpuTopologyLike | null,
  speed?: ProcessorCpuSpeedLike | null,
  loadData?: ProcessorLoadLike | null
) {
  const hybrid = getCpuHybridCoreCounts(cpu)
  if (hybrid.total > 0) return hybrid.total

  const physical = normalizePositiveCount(cpu?.physicalCores)
  if (physical > 0) return physical

  const speedCount = countValidSpeedCores(speed?.cores)
  if (speedCount > 0 && speed?.source && speed.source !== 'systeminformation') {
    return speedCount
  }

  const logical = normalizePositiveCount(cpu?.cores)
  if (logical > 0 && speedCount > 0) {
    return Math.min(logical, speedCount)
  }

  if (logical > 0) return logical

  const loadCount = countLoadCores(loadData?.cpus)
  return speedCount || loadCount
}

export function getProcessorIdlePercent(loadData?: ProcessorLoadLike | null): number {
  const currentLoadIdle = typeof loadData?.currentLoadIdle === 'number' && Number.isFinite(loadData.currentLoadIdle)
    ? loadData.currentLoadIdle
    : null

  if (currentLoadIdle !== null) {
    return Math.max(0, Math.min(100, currentLoadIdle))
  }

  const currentLoad = typeof loadData?.currentLoad === 'number' && Number.isFinite(loadData.currentLoad)
    ? loadData.currentLoad
    : 0

  return Math.max(0, Math.min(100, 100 - currentLoad))
}
