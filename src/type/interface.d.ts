interface CpuData {
    brand: string;
    performanceCores: number;
    physicalCores: number;
    manufacturer:string;
}
interface GpuData{
    model:string;
    vram:number;
    memoryTotal:number;
    memoryUsed:number;
    bus:string

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
interface DiskData{
    name: string;
    size: number;
    type: string;
    interfaceType: string;
}
interface BoardData {
    manufacturer:string
    model:string
}
interface NetworkStateData{
    rx_sec:number
    tx_sec:number
}
