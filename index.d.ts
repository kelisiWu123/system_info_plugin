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
      getCpuInfo: () => Promise<{ brand: string; physicalCores: string; performanceCores: string }>
      getMemInfo: () => Promise<{ total: number; available: number; active: number }>
      getGpuInfo: () => Promise<{model:string,vram:number}>
      spellCheck:()=>Promise<void>
      loadDic:()=>Promise<void>
    }
  }
}
