import { get } from 'http'

export interface ProcessVersions {
  node: () => string
  chrome: () => string
  electron: () => string
}

declare global {
  interface Window {
    versions: ProcessVersions
    services: {
      getCpuInfo: () => Promise<{ brand: string; cores: string; performanceCores: string }>
      getMemInfo: () => Promise<{ total: number; available: number; active: number }>
    }
  }
}
