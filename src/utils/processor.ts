import type { SensorEnhancementPlatform } from './platform'

export type ProcessorAuxDisplayMode = 'voltage' | 'fan'
export interface ProcessorLoadLike {
  currentLoad?: number | null
  currentLoadIdle?: number | null
}

export function getProcessorAuxDisplayMode(platform: SensorEnhancementPlatform): ProcessorAuxDisplayMode {
  return platform === 'macos' ? 'fan' : 'voltage'
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
