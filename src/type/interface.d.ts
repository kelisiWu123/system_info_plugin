interface CpuData {
  brand: string
  performanceCores: number
  physicalCores: number
  manufacturer: string
  cores: number
  speed: number
}
interface GpuData {
  model: string
  vram: number
  memoryTotal: number
  memoryUsed: number
  bus: string
}

interface MemoData {
  total: number
  available: number
  active: number
}

interface MemoLayoutData {
  clockSpeed: number
  size: number
  type: string
  manufacturer: string
}
interface DiskData {
  name: string
  size: number
  type: string
  interfaceType: string
  used: number
  available: number
  mount: string
}
interface BoardData {
  manufacturer: string
  model: string
  serial: string
  version: string
}
interface NetworkStateData {
  rx_sec: number
  tx_sec: number
}

// 添加 Window 接口扩展
interface Window {
  services: {
    getCpuInfo: () => Promise<CpuData>
    getMemInfo: () => Promise<MemoData>
    getMemoryLayout: () => Promise<MemoLayoutData[]>
    getGpuInfo: () => Promise<GpuData[]>
    getDiskData: () => Promise<DiskData[]>
    getBoardData: () => Promise<BoardData>
    getNetworkInfo: () => Promise<NetworkStateData>
    getCpuFullLoad: () => Promise<number>
    getWinId: () => string
    alwaysOnTop: (flag: boolean) => void
    closeWindow: () => void
    creatSomething: (fileName: string, height?: number, width?: number, backgroundColor?: number) => void
  }
}
