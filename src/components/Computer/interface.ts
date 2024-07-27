interface CpuData {
  brand: string;
  performanceCores: number;
  physicalCores: number;
}
interface GpuData{
  model:string;
  vram:number;
}

interface MemoData {
  total: number;
  available: number;
  active: number;
}

interface MemoLayoutData {
  clockSpeed: number;
  size: number;
  type: string;
}
