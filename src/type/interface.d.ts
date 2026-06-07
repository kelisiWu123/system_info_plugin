import type { Systeminformation } from 'systeminformation'

declare global {
  type CpuData = Systeminformation.CpuData
  type CpuCurrentSpeedData = Systeminformation.CpuCurrentSpeedData
  type CurrentLoadData = Systeminformation.CurrentLoadData
  interface GpuData {
    model: string
    name?: string
    vendor?: string
    subVendor?: string
    vendorId?: string
    deviceId?: string
    vram: number
    vramDynamic?: boolean
    cores?: number
    memoryTotal?: number | null
    memoryUsed?: number | null
    memoryFree?: number | null
    utilizationGpu?: number | null
    utilizationMemory?: number | null
    temperatureGpu?: number | null
    temperatureMemory?: number | null
    powerDraw?: number | null
    powerLimit?: number | null
    clockCore?: number | null
    clockMemory?: number | null
    fanSpeed?: number | null
    driverVersion?: string
    pciBus?: string
    bus: string
  }

  interface MemoData {
    total: number
    available: number
    active: number
    free?: number
    used?: number
    rawActive?: number
    rawAvailable?: number
    normalizedPlatform?: string
    swaptotal?: number
    swapused?: number
    swapfree?: number
    pressure?: {
      level: 'normal' | 'warning' | 'critical' | 'unknown'
      rawLevel: number | null
      availablePercent: number | null
      source: 'sysctl-memorystatus' | 'fallback'
    }
  }
  type MemoLayoutData = Systeminformation.MemLayoutData
  type BoardData = Systeminformation.BaseboardData
  type BiosInfoData = Systeminformation.BiosData
  interface NetworkStateData {
    rx_sec: number
    tx_sec: number
  }
  type CpuTemperatureData = Systeminformation.CpuTemperatureData & {
    value?: number | null
    source?:
      | 'systeminformation'
      | 'LibreHardwareMonitor'
      | 'OpenHardwareMonitor'
      | 'unsupported'
    hardwareName?: string
    sensorName?: string
    identifier?: string
    confidence?: 'high' | 'medium' | 'low' | 'unsupported'
    unit?: '°C'
    allCpuTemperatureSensors?: Array<{
      name: string
      identifier: string
      value: number | null
      hardwareName?: string
    }>
    errorCode?: string
    message?: string
  }
  interface CpuPowerData {
    value: number
    source: 'LibreHardwareMonitor' | 'OpenHardwareMonitor'
    sensorName?: string
    sensors?: Array<{
      name: string
      value: number
    }>
  }
  interface CpuVoltageData {
    value: number | null
    source: 'LibreHardwareMonitor' | 'OpenHardwareMonitor' | 'unsupported'
    sensorName?: string
    unit: 'V'
    max?: number | null
  }
  interface CpuFanData {
    value: number | null
    source: 'LibreHardwareMonitor' | 'OpenHardwareMonitor' | 'unsupported'
    sensorName?: string
    unit: 'RPM'
    max?: number | null
  }
  interface BoardMetricData {
    value: number | null
    source: 'LibreHardwareMonitor' | 'OpenHardwareMonitor' | 'unsupported'
    sensorName?: string
    unit: '°C' | 'V' | 'RPM'
    max?: number | null
  }
  interface BoardTelemetryData {
    boardTemperature: BoardMetricData
    vrmTemperature: BoardMetricData
    chipsetTemperature: BoardMetricData
    systemFan: BoardMetricData
    voltage12V: BoardMetricData
    voltage5V: BoardMetricData
    voltage3V: BoardMetricData
    voltageVBat: BoardMetricData
    pchVoltage: BoardMetricData
  }
  type BatteryInfoData = Systeminformation.BatteryData
  type DiskLayoutData = Systeminformation.DiskLayoutData
  type UsbDeviceData = Systeminformation.UsbData
  type AudioDeviceData = Systeminformation.AudioData
  type BluetoothDeviceData = Systeminformation.BluetoothDeviceData
  type PrinterInfoData = Systeminformation.PrinterData
  type OsInfoData = Systeminformation.OsData
  type VersionInfoData = Systeminformation.VersionData
  type TimeData = Systeminformation.TimeData
  type WifiInterfaceData = Systeminformation.WifiInterfaceData
  type WifiConnectionData = Systeminformation.WifiConnectionData
  type NetworkInterfaceData = Systeminformation.NetworkInterfacesData
  type GraphicsData = Systeminformation.GraphicsData
  type DisplayData = Systeminformation.GraphicsDisplayData
  type StaticHardwareData = Systeminformation.StaticData

  interface DiskData {
    name: string
    fs?: string
    size: number
    type: string
    used: number
    available: number
    mount: string
    interfaceType?: string
  }

  interface Window {
    services: {
      getCpuInfo: () => Promise<CpuData | undefined>
      getCpuFullLoad: () => Promise<number>
      getCpuTemperature: () => Promise<CpuTemperatureData | undefined>
      getCpuPower: () => Promise<CpuPowerData | undefined>
      getCpuCurrentSpeed: () => Promise<CpuCurrentSpeedData | undefined>
      getCpuLoadData: () => Promise<CurrentLoadData | undefined>
      getCpuVoltage: () => Promise<CpuVoltageData | undefined>
      getCpuFanSpeed: () => Promise<CpuFanData | undefined>
      getBoardTelemetry: () => Promise<BoardTelemetryData>
      getMemInfo: () => Promise<MemoData>
      getMemoryLayout: () => Promise<MemoLayoutData[]>
      getGpuInfo: () => Promise<GpuData[]>
      getNetworkInfo: () => Promise<NetworkStateData>
      getNetworkInterfaces: () => Promise<NetworkInterfaceData[]>
      getWifiInterfaces: () => Promise<WifiInterfaceData[]>
      getWifiConnections: () => Promise<WifiConnectionData[]>
      getDiskData: () => Promise<DiskData[]>
      getDiskLayout: () => Promise<DiskLayoutData[]>
      getBiosData: () => Promise<BiosInfoData | undefined>
      getDisplaysData: () => Promise<DisplayData[]>
      getBoardData: () => Promise<BoardData | undefined>
      getBatteryInfo: () => Promise<BatteryInfoData | undefined>
      getUsbDevices: () => Promise<UsbDeviceData[]>
      getAudioDevices: () => Promise<AudioDeviceData[]>
      getBluetoothDevices: () => Promise<BluetoothDeviceData[]>
      getPrinterInfo: () => Promise<PrinterInfoData[]>
      getOsInfo: () => Promise<OsInfoData | undefined>
      getTimeInfo: () => Promise<TimeData | undefined>
      getSysEnv: () => Promise<VersionInfoData>
      getWinId: () => string | undefined
      alwaysOnTop: (flag: boolean) => void
      closeWindow: () => void
      minimizeWindow?: () => void
      toggleMaximizeWindow?: () => void
      resizeWindow: (width: number, height: number) => void
      createWindow: (fileName: string, height?: number, width?: number, backgroundColor?: number) => void
      creatSomething: (fileName: string, height?: number, width?: number, backgroundColor?: number) => void
    }
  }
}

export {}
