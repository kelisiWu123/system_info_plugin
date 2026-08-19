import { computed, ref, type Ref } from 'vue'
import {
  getSensorEnhancementControlLabel,
  getSensorEnhancementMenuAriaLabel,
  getSensorEnhancementPlatform,
  getSensorEnhancementPrimaryActionLabel,
  shouldAutoPrepareSensorEnhancement,
} from '../utils/platform'
import { writeClipboardText } from '../utils/presentation'

interface SensorEnhancementControllerOptions {
  osInfo: Ref<OsInfoData | undefined>
  refreshProcessorState?: () => Promise<void> | undefined
  openProcessorDetails?: () => void
}

export function useSensorEnhancementController(options: SensorEnhancementControllerOptions) {
  const resolvedOsInfo = ref<OsInfoData>()
  const sensorSettings = ref<HardwareSensorSettingsData>({
    enhancedSensorEnabled: false,
    openHardwareMonitorAutoStart: false,
    openHardwareMonitorPort: 18085,
  })
  const sensorSettingsLoading = ref(false)
  const sensorActionLoading = ref(false)
  const sensorAutoPrepareAttempted = ref(false)
  const sensorMenuOpen = ref(false)
  const sensorAuthorizationPromptVisible = ref(false)
  const sensorActionMessage = ref('')
  const openHardwareMonitorStatus = ref<WindowsSensorEnhancementStatusData | null>(null)
  const windowsSensorDiagnostics = ref<WindowsSensorEnhancementDiagnosticsData | null>(null)
  const macHelperStatus = ref<MacPowermetricsHelperStatusData | null>(null)

  const platform = computed(() => getSensorEnhancementPlatform(options.osInfo.value || resolvedOsInfo.value))
  const ready = computed(() => {
    if (platform.value === 'windows') return Boolean(openHardwareMonitorStatus.value?.running)
    if (platform.value === 'macos') return Boolean(macHelperStatus.value?.loaded && macHelperStatus.value?.socketExists)
    return false
  })
  const active = computed(() => sensorSettings.value.enhancedSensorEnabled && ready.value)
  const disabled = computed(() => sensorSettingsLoading.value || sensorActionLoading.value)
  const controlLabel = computed(() => getSensorEnhancementControlLabel(platform.value))
  const controlAriaLabel = computed(() => getSensorEnhancementMenuAriaLabel(platform.value))
  const primaryActionLabel = computed(() => getSensorEnhancementPrimaryActionLabel(
    platform.value,
    sensorSettings.value.enhancedSensorEnabled
  ))
  const status = computed<'off' | 'running' | 'preparing' | 'needs-auth' | 'error' | 'pending'>(() => {
    if (!sensorSettings.value.enhancedSensorEnabled) return 'off'
    if (sensorActionLoading.value) return 'preparing'
    if (ready.value) return 'running'

    if (platform.value === 'macos') {
      if (macHelperStatus.value?.reason === 'MACOS_POWERMETRICS_HELPER_INSTALL_FAILED') return 'error'
      if (!macHelperStatus.value?.installed) return 'needs-auth'
    }

    if (platform.value === 'windows') {
      const reason = openHardwareMonitorStatus.value?.reason || ''
      if (
        reason === 'WINDOWS_SENSOR_HELPER_START_FAILED'
        || reason === 'WINDOWS_SENSOR_BACKEND_START_FAILED'
        || reason === 'OHM_START_FAILED'
        || reason === 'OHM_EXE_NOT_FOUND'
        || reason === 'OHM_RUNTIME_COPY_FAILED'
      ) return 'error'
    }

    return 'pending'
  })
  const statusLabel = computed(() => {
    switch (status.value) {
      case 'off': return '已关闭'
      case 'running': return '运行中'
      case 'preparing': return '准备中'
      case 'needs-auth': return '需授权'
      case 'error': return '异常'
      default: return '待启用'
    }
  })
  const controlTitle = computed(() => `${controlLabel.value}：${statusLabel.value}`)
  const description = computed(() => {
    if (platform.value === 'windows') {
      if (!sensorSettings.value.enhancedSensorEnabled) {
        return '已关闭。需要时可启用传感器增强补齐温度、频率、功耗等数据。'
      }
      if (status.value === 'running') {
        return openHardwareMonitorStatus.value?.backend === 'legacy-ohm'
          ? '传感器增强正在运行，当前使用后台兼容模式。'
          : '传感器增强正在通过内置后台组件补齐温度、频率、功耗等数据。'
      }
      if (status.value === 'preparing') return '正在准备 Windows 传感器增强组件，请稍候。'
      if (status.value === 'error') return 'Windows 传感器增强组件未能就绪，可以重试或查看详情。'
      return '传感器增强已启用，组件就绪后会自动补齐缺失数据。'
    }

    if (!sensorSettings.value.enhancedSensorEnabled) return '已关闭'
    if (status.value === 'running') return '正在补齐温度、频率、功耗等传感器数据。'
    if (status.value === 'preparing') return '正在准备增强组件，请稍候。'
    if (status.value === 'needs-auth') return '需要一次系统授权，授权后会自动启用增强采样。'
    if (status.value === 'error') return '增强组件未能就绪，可以重试或查看详情。'
    return '增强模式默认开启，组件就绪后会自动补齐缺失数据。'
  })

  const diagnosticsText = computed(() => {
    const lines = [
      platform.value === 'windows' ? 'Windows 传感器增强诊断' : '传感器增强诊断',
      `生成时间：${new Date().toLocaleString('zh-CN')}`,
      `平台：${platform.value}`,
      `状态：${statusLabel.value}`,
      `增强开关：${sensorSettings.value.enhancedSensorEnabled ? '已开启' : '已关闭'}`,
    ]

    if (platform.value === 'windows' && openHardwareMonitorStatus.value) {
      lines.push(
        '',
        '[Windows sensor backend]',
        `running：${Boolean(openHardwareMonitorStatus.value.running)}`,
        `backend：${openHardwareMonitorStatus.value.backend}`,
        `helperAvailable：${Boolean(openHardwareMonitorStatus.value.helperAvailable)}`,
        `helperRunning：${Boolean(openHardwareMonitorStatus.value.helperRunning)}`,
        `legacyFallback：${Boolean(openHardwareMonitorStatus.value.legacyFallback)}`,
        `reason：${openHardwareMonitorStatus.value.reason || ''}`,
        `suggestion：${openHardwareMonitorStatus.value.suggestion || ''}`,
        `executableExists：${Boolean(openHardwareMonitorStatus.value.executableExists)}`
      )
      if (openHardwareMonitorStatus.value.backend === 'legacy-ohm') {
        lines.push(`legacyPort：${sensorSettings.value.openHardwareMonitorPort}`)
      }
    }

    if (platform.value === 'windows' && windowsSensorDiagnostics.value) {
      const diagnostics = windowsSensorDiagnostics.value
      lines.push(
        '',
        '[Windows helper snapshot]',
        `failureCode：${diagnostics.failureCode || ''}`,
        `failureMessage：${diagnostics.failureMessage || ''}`,
        `helperVersion：${diagnostics.helper.helperVersion || ''}`,
        `helperBackend：${diagnostics.helper.backend || ''}`,
        `helperPid：${diagnostics.helper.processId ?? ''}`,
        `processPresent：${diagnostics.helper.processPresent}`,
        `elevated：${diagnostics.helper.elevated}`,
        `runtimeAvailable：${diagnostics.helper.runtimeAvailable}`,
        `helperPath：${diagnostics.helper.executablePath || ''}`,
        `crashLogPath：${diagnostics.helper.crashLogPath || ''}`,
        `crashLogExists：${diagnostics.helper.crashLogExists}`,
        `snapshotReceived：${diagnostics.helper.snapshotReceived}`,
        `snapshotOk：${diagnostics.helper.snapshotOk}`,
        `snapshotError：${diagnostics.helper.snapshotError || ''}`,
        'crashLog：',
        diagnostics.helper.crashLog || '无',
        `sensorTotal：${diagnostics.sensors.total}`,
        `rawTemperatureCount：${diagnostics.sensors.rawTemperatureCount}`,
        `cpuHardwareSensorCount：${diagnostics.sensors.cpuHardwareSensorCount}`,
        `cpuFilterMatchCount：${diagnostics.sensors.cpuFilterMatchCount}`,
        `cpuTemperatureCount：${diagnostics.sensors.cpuTemperatureCount}`,
        `cpuClockCount：${diagnostics.sensors.cpuClockCount}`,
        `cpuPowerCount：${diagnostics.sensors.cpuPowerCount}`,
        `cpuVoltageCount：${diagnostics.sensors.cpuVoltageCount}`,
        `cpuFanCount：${diagnostics.sensors.cpuFanCount}`,
        `sensorTypeCounts：${JSON.stringify(diagnostics.sensors.sensorTypeCounts)}`,
        `hardwareTypeCounts：${JSON.stringify(diagnostics.sensors.hardwareTypeCounts)}`,
        'samples：',
        JSON.stringify(diagnostics.sensors.samples, null, 2)
      )
    }

    if (platform.value === 'macos' && macHelperStatus.value) {
      lines.push(
        '',
        '[macOS powermetrics helper]',
        `installed：${Boolean(macHelperStatus.value.installed)}`,
        `loaded：${Boolean(macHelperStatus.value.loaded)}`,
        `socketExists：${Boolean(macHelperStatus.value.socketExists)}`,
        `reason：${macHelperStatus.value.reason || ''}`,
        `suggestion：${macHelperStatus.value.suggestion || ''}`
      )
    }

    return lines.join('\n')
  })

  async function ensurePlatformInfo() {
    if (platform.value !== 'unsupported') return platform.value

    try {
      resolvedOsInfo.value = await window.services.getOsInfo()
    } catch {
      resolvedOsInfo.value = undefined
    }

    return platform.value
  }

  async function refreshState() {
    await ensurePlatformInfo()
    if (platform.value === 'unsupported') return
    sensorSettingsLoading.value = true
    try {
      sensorSettings.value = await window.services.getHardwareSensorSettings()
      if (platform.value === 'windows') {
        openHardwareMonitorStatus.value = await window.services.getWindowsSensorEnhancementStatus()
        windowsSensorDiagnostics.value = sensorSettings.value.enhancedSensorEnabled
          ? await window.services.getWindowsSensorEnhancementDiagnostics()
          : null
      } else if (platform.value === 'macos') {
        macHelperStatus.value = await window.services.getMacPowermetricsHelperStatus()
      }
    } finally {
      sensorSettingsLoading.value = false
    }
  }

  async function refreshProcessorState() {
    await options.refreshProcessorState?.()
  }

  async function prepare(auto: boolean) {
    await ensurePlatformInfo()
    if (platform.value === 'unsupported') return
    if (auto && sensorAutoPrepareAttempted.value) return
    if (auto) sensorAutoPrepareAttempted.value = true

    if (!shouldAutoPrepareSensorEnhancement(
      platform.value,
      sensorSettings.value.enhancedSensorEnabled,
      ready.value
    )) return

    sensorActionLoading.value = true
    try {
      if (platform.value === 'windows') {
        openHardwareMonitorStatus.value = await window.services.startWindowsSensorEnhancement()
        openHardwareMonitorStatus.value = await window.services.getWindowsSensorEnhancementStatus()
        windowsSensorDiagnostics.value = await window.services.getWindowsSensorEnhancementDiagnostics()
      } else if (platform.value === 'macos') {
        if (!macHelperStatus.value?.installed) {
          sensorAuthorizationPromptVisible.value = true
          return
        }
        macHelperStatus.value = await window.services.installMacPowermetricsHelper()
        macHelperStatus.value = await window.services.getMacPowermetricsHelperStatus()
      }
      await refreshProcessorState()
    } finally {
      sensorActionLoading.value = false
    }
  }

  async function setEnabled(nextEnabled: boolean) {
    await ensurePlatformInfo()
    if (platform.value === 'unsupported' || sensorActionLoading.value) return
    sensorActionLoading.value = true
    try {
      sensorActionMessage.value = ''
      sensorSettings.value = await window.services.updateHardwareSensorSettings({
        enhancedSensorEnabled: nextEnabled,
        openHardwareMonitorAutoStart: nextEnabled,
      })

      if (nextEnabled) {
        sensorAutoPrepareAttempted.value = false
        await prepare(false)
      } else if (platform.value === 'macos' && macHelperStatus.value?.installed) {
        macHelperStatus.value = await window.services.uninstallMacPowermetricsHelper()
      } else if (platform.value === 'windows') {
        openHardwareMonitorStatus.value = await window.services.getWindowsSensorEnhancementStatus()
        windowsSensorDiagnostics.value = null
      }

      await refreshProcessorState()
      sensorMenuOpen.value = false
    } finally {
      sensorActionLoading.value = false
    }
  }

  async function continueAuthorization() {
    if (platform.value !== 'macos' || sensorActionLoading.value) return
    sensorAuthorizationPromptVisible.value = false
    sensorActionLoading.value = true
    try {
      sensorActionMessage.value = '正在请求系统授权...'
      macHelperStatus.value = await window.services.installMacPowermetricsHelper()
      macHelperStatus.value = await window.services.getMacPowermetricsHelperStatus()
      sensorActionMessage.value = macHelperStatus.value.loaded && macHelperStatus.value.socketExists
        ? '增强模式已运行'
        : macHelperStatus.value.suggestion || '增强组件尚未就绪'
      await refreshProcessorState()
      sensorMenuOpen.value = false
    } finally {
      sensorActionLoading.value = false
    }
  }

  async function disableFromPrompt() {
    sensorAuthorizationPromptVisible.value = false
    await setEnabled(false)
  }

  async function retry() {
    sensorAutoPrepareAttempted.value = false
    await refreshState()
    await prepare(false)
    sensorMenuOpen.value = false
  }

  async function refreshFromMenu() {
    await refreshState()
    await refreshProcessorState()
  }

  async function copyDiagnostics() {
    try {
      if (platform.value === 'windows' && sensorSettings.value.enhancedSensorEnabled) {
        windowsSensorDiagnostics.value = await window.services.getWindowsSensorEnhancementDiagnostics()
      }
      await writeClipboardText(diagnosticsText.value)
      sensorActionMessage.value = '诊断信息已复制'
    } catch (error) {
      console.error('复制传感器诊断失败:', error)
      sensorActionMessage.value = '诊断信息复制失败'
    }
  }

  function toggleMenu() {
    sensorMenuOpen.value = !sensorMenuOpen.value
  }

  function openDetails() {
    sensorMenuOpen.value = false
    options.openProcessorDetails?.()
  }

  return {
    sensorSettings,
    sensorSettingsLoading,
    sensorActionLoading,
    sensorMenuOpen,
    sensorAuthorizationPromptVisible,
    sensorActionMessage,
    openHardwareMonitorStatus,
    windowsSensorDiagnostics,
    macHelperStatus,
    platform,
    ready,
    active,
    disabled,
    controlLabel,
    controlAriaLabel,
    primaryActionLabel,
    status,
    statusLabel,
    controlTitle,
    description,
    refreshState,
    prepare,
    setEnabled,
    continueAuthorization,
    disableFromPrompt,
    retry,
    refreshFromMenu,
    copyDiagnostics,
    toggleMenu,
    openDetails,
  }
}
