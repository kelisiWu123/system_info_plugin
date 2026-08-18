import type { Systeminformation } from 'systeminformation'

declare global {
  type CpuData = Systeminformation.CpuData
  interface CpuCurrentSpeedData extends Systeminformation.CpuCurrentSpeedData {
    source?: 'powermetrics' | 'systeminformation' | 'OpenHardwareMonitor'
    sensorName?: string
    allCpuClockSensors?: Array<{
      name: string
      identifier: string
      value: number | null
      hardwareName?: string
      coreIndex?: number
      accepted?: boolean
      filterReason?: string
    }>
    frequencyDiagnostics?: {
      displayValueGHz: number | null
      displayChosenFrom: 'max_core' | 'avg_fallback' | 'unavailable'
      telemetrySource: 'powermetrics' | 'systeminformation' | 'OpenHardwareMonitor' | 'unknown'
      validCoreCount: number
      avgGHz: number | null
      cpuSpeedMaxGHz: number | null
      maxAcceptedCoreGHz: number | null
      maxIgnoredCoreGHz: number | null
      rawSensorCount: number
      ignoredSensorCount: number
      anomalyDetected: boolean
      anomalyReasons: string[]
    }
    nativeSource?: 'powermetrics'
    nativeErrorCode?: string
    nativeReason?: string
    nativeMessage?: string
    nativeSuggestion?: string
    privileged?: boolean
    helper?: boolean
  }
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
    idleResidencyGpu?: number | null
    utilizationMemory?: number | null
    temperatureGpu?: number | null
    gpuCoreTemperatures?: Array<{
      name: string
      identifier?: string
      value: number | null
      hardwareName?: string
    }>
    temperatureMemory?: number | null
    powerDraw?: number | null
    powerLimit?: number | null
    clockCore?: number | null
    clockMemory?: number | null
    fanSpeed?: number | null
    driverVersion?: string
    pciBus?: string
    helper?: boolean
    telemetrySource?: 'systeminformation' | 'powermetrics' | 'OpenHardwareMonitor'
    temperatureSource?: 'systeminformation' | 'macos-temperature-sensor' | 'apple-smc' | 'OpenHardwareMonitor'
    nativeTemperatureErrorCode?: string
    nativeTemperatureReason?: string
    nativeTemperatureMessage?: string
    nativeTemperatureSuggestion?: string
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
  type SystemData = Systeminformation.SystemData
  type BiosInfoData = Systeminformation.BiosData
  interface NetworkStatusData {
    defaultInterface: string
    gateway: string
    latencyMs: number | null
    operstate: string
    rxSec: number | null
    txSec: number | null
  }
  interface NetworkAdapterSpecData {
    iface: string
    name: string
    vendor: string
    model: string
    type: string
    mac: string
    ip4: string
    speed: number | null
    default: boolean
    operstate: string
  }
  interface StorageIoData {
    readBytesPerSec: number | null
    writeBytesPerSec: number | null
    totalBytesPerSec: number | null
    readIops: number | null
    writeIops: number | null
    totalIops: number | null
    waitPercent: number | null
  }
  interface TopProcessData {
    pid: number
    name: string
    cpu: number
    mem: number
    memRss: number
    user: string
  }
  type CpuTemperatureData = Systeminformation.CpuTemperatureData & {
    ok?: boolean
    value?: number | null
    source?:
      | 'systeminformation'
      | 'apple-smc'
      | 'macos-temperature-sensor'
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
    reason?: string
    message?: string
    suggestion?: string
    raw?: unknown
  }
  interface HardwareSensorSettingsData {
    enhancedSensorEnabled: boolean
    openHardwareMonitorAutoStart: boolean
    openHardwareMonitorPort: number
  }
  interface MonitoringRefreshSettingsData {
    profile: 'eco' | 'balanced' | 'realtime'
    backgroundThrottleEnabled: boolean
  }
  type AppThemePreference = 'system' | 'light' | 'dark'
  type AppResolvedTheme = 'light' | 'dark'
  interface AppThemeSettingsData {
    preference: AppThemePreference
  }
  type FloatingMonitorMode = 'standard' | 'super-lite'
  interface FloatingMonitorSettingsData {
    mode: FloatingMonitorMode
    pinned: boolean
    standardSize: {
      width: number
      height: number
    }
    superLiteSize: {
      width: number
      height: number
    }
    position?: {
      x: number
      y: number
    }
    opacity?: number
  }
  interface WindowsSensorEnhancementStatusData {
    platform: 'win32' | 'other'
    settings: HardwareSensorSettingsData
    running: boolean
    backend: 'helper' | 'legacy-ohm' | 'none'
    helperAvailable: boolean
    helperRunning: boolean
    legacyFallback: boolean
    executableExists: boolean
    executablePath?: string
    executableDirectory?: string
    port: number
    started?: boolean
    reason?: string
    suggestion?: string
  }
  type OpenHardwareMonitorStatusData = WindowsSensorEnhancementStatusData
  interface OpenHardwareMonitorDirectoryResultData {
    ok: boolean
    directoryPath?: string
    reason?: string
    suggestion?: string
  }
  interface MacPowermetricsHelperStatusData {
    ok?: boolean
    platform: 'darwin' | 'other'
    supported: boolean
    label: string
    bundledExists: boolean
    bundledPath: string
    runtimePath?: string
    insideAsar?: boolean
    installed: boolean
    loaded: boolean
    socketExists: boolean
    installPath: string
    plistPath: string
    socketPath: string
    reason?: string
    suggestion?: string
  }
  interface CpuPowerData {
    value: number | null
    source: 'powermetrics' | 'OpenHardwareMonitor' | 'unsupported'
    sensorName?: string
    sensors?: Array<{
      name: string
      value: number
    }>
    errorCode?: string
    reason?: string
    message?: string
    suggestion?: string
    privileged?: boolean
    helper?: boolean
  }
  interface CpuVoltageData {
    value: number | null
    source: 'OpenHardwareMonitor' | 'unsupported'
    sensorName?: string
    unit: 'V'
    max?: number | null
  }
  interface CpuFanData {
    value: number | null
    source: 'apple-smc' | 'OpenHardwareMonitor' | 'unsupported'
    sensorName?: string
    unit: 'RPM'
    max?: number | null
    errorCode?: string
    reason?: string
    message?: string
    suggestion?: string
  }
  type DiskLayoutData = Systeminformation.DiskLayoutData
  type AudioDeviceData = Systeminformation.AudioData
  type OsInfoData = Systeminformation.OsData
  type TimeData = Systeminformation.TimeData
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
      getHardwareSensorSettings: () => Promise<HardwareSensorSettingsData>
      updateHardwareSensorSettings: (patch: Partial<HardwareSensorSettingsData>) => Promise<HardwareSensorSettingsData>
      getMonitoringRefreshSettings: () => Promise<MonitoringRefreshSettingsData>
      updateMonitoringRefreshSettings: (patch: Partial<MonitoringRefreshSettingsData>) => Promise<MonitoringRefreshSettingsData>
      getFloatingMonitorSettings: () => Promise<FloatingMonitorSettingsData>
      updateFloatingMonitorSettings: (patch: Partial<FloatingMonitorSettingsData>) => Promise<FloatingMonitorSettingsData>
      getAppThemeSettings: () => Promise<AppThemeSettingsData>
      updateAppThemeSettings: (patch: Partial<AppThemeSettingsData>) => Promise<AppThemeSettingsData>
      getWindowsSensorEnhancementStatus: () => Promise<WindowsSensorEnhancementStatusData>
      startWindowsSensorEnhancement: () => Promise<WindowsSensorEnhancementStatusData>
      openWindowsSensorComponentDirectory: () => Promise<OpenHardwareMonitorDirectoryResultData>
      getOpenHardwareMonitorStatus: () => Promise<OpenHardwareMonitorStatusData>
      startOpenHardwareMonitor: () => Promise<OpenHardwareMonitorStatusData>
      openOpenHardwareMonitorDirectory: () => Promise<OpenHardwareMonitorDirectoryResultData>
      getMacPowermetricsHelperStatus: () => Promise<MacPowermetricsHelperStatusData>
      installMacPowermetricsHelper: () => Promise<MacPowermetricsHelperStatusData>
      uninstallMacPowermetricsHelper: () => Promise<MacPowermetricsHelperStatusData>
      getCpuInfo: () => Promise<CpuData | undefined>
      getCpuFullLoad: () => Promise<number>
      getCpuTemperature: () => Promise<CpuTemperatureData | undefined>
      getCpuPower: () => Promise<CpuPowerData | undefined>
      getCpuCurrentSpeed: () => Promise<CpuCurrentSpeedData | undefined>
      getCpuLoadData: () => Promise<CurrentLoadData | undefined>
      getCpuVoltage: () => Promise<CpuVoltageData | undefined>
      getCpuFanSpeed: () => Promise<CpuFanData | undefined>
      getMemInfo: () => Promise<MemoData>
      getStaticMemInfo: () => Promise<MemoData>
      getMemoryLayout: () => Promise<MemoLayoutData[]>
      getGpuInfo: () => Promise<GpuData[]>
      getStaticGpuInfo: () => Promise<GpuData[]>
      getNetworkStatus: () => Promise<NetworkStatusData>
      getNetworkAdapters: () => Promise<NetworkAdapterSpecData[]>
      getNetworkInterfaces: () => Promise<NetworkInterfaceData[]>
      getTopProcesses: () => Promise<TopProcessData[]>
      getDiskData: () => Promise<DiskData[]>
      getStorageIo: () => Promise<StorageIoData>
      getDiskLayout: () => Promise<DiskLayoutData[]>
      getBiosData: () => Promise<BiosInfoData | undefined>
      getSystemData: () => Promise<SystemData | undefined>
      getDisplaysData: () => Promise<DisplayData[]>
      getBoardData: () => Promise<BoardData | undefined>
      getAudioDevices: () => Promise<AudioDeviceData[]>
      getOsInfo: () => Promise<OsInfoData | undefined>
      getTimeInfo: () => Promise<TimeData | undefined>
      getWinId: () => string | undefined
      alwaysOnTop: (flag: boolean) => void
      closeWindow: () => void
      minimizeWindow?: () => void
      toggleMaximizeWindow?: () => void
      resizeWindow: (width: number, height: number) => void
      createWindow: (fileName: string, height?: number, width?: number, backgroundColor?: number) => Promise<void>
      creatSomething: (fileName: string, height?: number, width?: number, backgroundColor?: number) => void
    }
  }
}

export {}
