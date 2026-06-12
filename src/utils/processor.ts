import type { SensorEnhancementPlatform } from './platform'

export type ProcessorAuxDisplayMode = 'voltage' | 'fan'

export function getProcessorAuxDisplayMode(platform: SensorEnhancementPlatform): ProcessorAuxDisplayMode {
  return platform === 'macos' ? 'fan' : 'voltage'
}
