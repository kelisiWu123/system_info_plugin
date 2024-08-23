import { get } from 'http'

export interface ProcessVersions {
  node: () => string
  chrome: () => string
  electron: () => string
}

declare global {
  interface Window {
    versions: ProcessVersions;
    services: {
      getCpuInfo: () => Promise<CpuData>;
      getMemInfo: () => Promise<MemoData>;
      getGpuInfo: () => Promise<{
        model: string;
        vram: number;
        memoryTotal: number;
        memoryUsed: number;
      }>;
      getMemoryLayout: () => Promise<MemoLayoutData[]>;
      getCpuFullLoad: () => Promise<number>;
      getDiskData: () => Promise<DiskData[]>;
      getBoardData: () => Promise<BoardData>;
      getNetworkInfo: () => Promise<NetworkStateData>;
      creatSomething: (
        fileName: string,
        height?: number,
        width?: number,
      ) => void;
      closeWindow: () => void;
    };
  }
}
