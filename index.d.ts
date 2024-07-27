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
      getCpuInfo: () => Promise<CpuData>
      getMemInfo: () => Promise<MemoData>
      getGpuInfo: () => Promise<{model:string,vram:number}>
      getMemoryLayout: () => Promise<MemoLayoutData[]>
      getCpuFullLoad: () => Promise<number>
      getDiskData: () => Promise<DiskData[]>
      getBoardData: () => Promise<BoardData>
      creatSomething:()=>void
    }
  }
}
