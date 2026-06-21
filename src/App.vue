<script setup lang="ts">
import {
  Chip,
  Computer as ComputerIcon,
  Cpu,
  GraphicDesign,
  HardDisk,
  Memory,
} from '@icon-park/vue-next'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { overviewHardwareStore, updateOverviewMonitoringRefreshSettings } from './composables/useOverviewHardwareData'
import { resolveDevPageCopyTarget } from './utils/devPageCopy'
import {
  resolveInitialFloatingEntry,
  resolveInitialFloatingMode,
  resolvePageName,
  type PageName,
} from './utils/hashRoute'
import {
  getSensorEnhancementControlLabel,
  getSensorEnhancementMenuAriaLabel,
  getSensorEnhancementPlatform,
  getSensorEnhancementPrimaryActionLabel,
  shouldAutoPrepareSensorEnhancement,
} from './utils/platform'

type ComputerSection =
  | 'overview'
  | 'processor'
  | 'graphics'
  | 'board'
  | 'memory'
  | 'storage'

interface SidebarItem {
  id: ComputerSection
  label: string
  icon: unknown
  page?: PageName
}

interface CopyablePageHandle {
  exportReport?: () => void
  copyOverviewInfo?: () => Promise<boolean>
  copyProcessorInfo?: () => Promise<boolean>
  copyGraphicsInfo?: () => Promise<boolean>
  copyBoardInfo?: () => Promise<boolean>
  copyMemoryInfo?: () => Promise<boolean>
  copyStorageInfo?: () => Promise<boolean>
  openSensorEnhancementPanel?: () => void
  refreshSensorEnhancementState?: () => Promise<void>
}

const currentHash = ref(window.location.hash)
const selectedSection = ref<ComputerSection>('overview')
const copyPending = ref(false)
const copyFeedback = ref<'idle' | 'success' | 'error'>('idle')
const computerRef = ref<CopyablePageHandle | null>(null)
const processorRef = ref<CopyablePageHandle | null>(null)
const graphicsRef = ref<CopyablePageHandle | null>(null)
const boardRef = ref<CopyablePageHandle | null>(null)
const memoryRef = ref<CopyablePageHandle | null>(null)
const storageRef = ref<CopyablePageHandle | null>(null)
let copyFeedbackTimerId: number | undefined

const primaryNavItems: SidebarItem[] = [
  { id: 'overview', label: '概览', icon: ComputerIcon, page: 'computer' },
  { id: 'processor', label: '处理器', icon: Cpu, page: 'computer' },
  { id: 'graphics', label: '显卡', icon: GraphicDesign, page: 'computer' },
  { id: 'board', label: '主板', icon: Chip, page: 'computer' },
  { id: 'memory', label: '内存', icon: Memory, page: 'computer' },
  { id: 'storage', label: '存储', icon: HardDisk, page: 'computer' },
]

function syncHash() {
  currentHash.value = window.location.hash
}

const currentPage = computed<PageName>(() => resolvePageName(currentHash.value))
const initialFloatingMode = computed(() => resolveInitialFloatingMode(currentHash.value))
const initialFloatingEntry = computed(() => resolveInitialFloatingEntry(currentHash.value))
const isWatchPage = computed(() => currentPage.value === 'watch')
const isDeviceSpecsPage = computed(() => currentPage.value === 'deviceSpecs')
const currentDevCopyTarget = computed(() => resolveDevPageCopyTarget(selectedSection.value))
const overviewRefreshSettings = overviewHardwareStore.monitoringRefreshSettings
const overviewBackgroundThrottled = overviewHardwareStore.backgroundThrottled
const refreshSettingsPending = ref(false)
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
const openHardwareMonitorStatus = ref<OpenHardwareMonitorStatusData | null>(null)
const macHelperStatus = ref<MacPowermetricsHelperStatusData | null>(null)

const refreshProfiles = [
  { id: 'eco', label: '省电' },
  { id: 'balanced', label: '平衡' },
  { id: 'realtime', label: '实时' },
] as const

function syncBodyMode() {
  document.body.classList.toggle('watch-window-body', isWatchPage.value)
}

function selectSection(id: SidebarItem['id']) {
  selectedSection.value = id

  if (currentPage.value !== 'computer' || !window.location.hash) {
    window.location.hash = 'computer'
  }
}

function resetCopyFeedbackLater() {
  if (copyFeedbackTimerId) {
    window.clearTimeout(copyFeedbackTimerId)
  }

  copyFeedbackTimerId = window.setTimeout(() => {
    copyFeedback.value = 'idle'
    copyFeedbackTimerId = undefined
  }, 1800)
}

function getCurrentCopyHandle() {
  switch (selectedSection.value) {
    case 'overview':
      return computerRef.value
    case 'processor':
      return processorRef.value
    case 'graphics':
      return graphicsRef.value
    case 'board':
      return boardRef.value
    case 'memory':
      return memoryRef.value
    case 'storage':
      return storageRef.value
    default:
      return null
  }
}

async function copyCurrentSectionInfo() {
  if (!currentDevCopyTarget.value || copyPending.value) return

  const handle = getCurrentCopyHandle()
  const method = handle?.[currentDevCopyTarget.value.methodName]
  if (typeof method !== 'function') {
    copyFeedback.value = 'error'
    resetCopyFeedbackLater()
    return
  }

  copyPending.value = true
  try {
    const ok = await method()
    copyFeedback.value = ok ? 'success' : 'error'
    resetCopyFeedbackLater()
  } finally {
    copyPending.value = false
  }
}

function exportCurrentSectionReport() {
  getCurrentCopyHandle()?.exportReport?.()
}

async function writeClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  document.body.removeChild(textarea)

  if (!copied) {
    throw new Error('execCommand copy failed')
  }
}

async function applyOverviewRefreshProfile(profile: MonitoringRefreshSettingsData['profile']) {
  if (refreshSettingsPending.value || overviewRefreshSettings.value.profile === profile) return

  refreshSettingsPending.value = true
  try {
    await updateOverviewMonitoringRefreshSettings({ profile })
  } finally {
    refreshSettingsPending.value = false
  }
}

async function toggleOverviewBackgroundThrottle() {
  if (refreshSettingsPending.value) return

  refreshSettingsPending.value = true
  try {
    await updateOverviewMonitoringRefreshSettings({
      backgroundThrottleEnabled: !overviewRefreshSettings.value.backgroundThrottleEnabled,
    })
  } finally {
    refreshSettingsPending.value = false
  }
}

const devCopyButtonClass = computed(() => [
  'debug-button',
  copyFeedback.value === 'success' ? 'debug-button--success' : '',
  copyFeedback.value === 'error' ? 'debug-button--error' : '',
])

const devCopyButtonText = computed(() => {
  if (copyPending.value) return '拷贝中...'
  if (copyFeedback.value === 'success') return '已拷贝'
  if (copyFeedback.value === 'error') return '拷贝失败'
  return currentDevCopyTarget.value?.buttonLabel || '拷贝当前页信息'
})

const processorSensorControlVisible = computed(() =>
  currentPage.value === 'computer' && sensorEnhancementPlatform.value !== 'unsupported'
)
const sensorEnhancementPlatform = computed(() => getSensorEnhancementPlatform(overviewHardwareStore.osInfo.value))
const sensorEnhancementReady = computed(() => {
  if (sensorEnhancementPlatform.value === 'windows') return Boolean(openHardwareMonitorStatus.value?.running)
  if (sensorEnhancementPlatform.value === 'macos') return Boolean(macHelperStatus.value?.loaded && macHelperStatus.value?.socketExists)
  return false
})
const processorSensorControlActive = computed(() => sensorSettings.value.enhancedSensorEnabled && sensorEnhancementReady.value)
const processorSensorControlDisabled = computed(() => sensorSettingsLoading.value || sensorActionLoading.value)
const processorSensorControlLabel = computed(() => getSensorEnhancementControlLabel(sensorEnhancementPlatform.value))
const processorSensorControlAriaLabel = computed(() => getSensorEnhancementMenuAriaLabel(sensorEnhancementPlatform.value))
const processorSensorControlTitle = computed(() => `${processorSensorControlLabel.value}：${processorSensorControlStatus.value}`)
const processorSensorPrimaryActionLabel = computed(() => getSensorEnhancementPrimaryActionLabel(
  sensorEnhancementPlatform.value,
  sensorSettings.value.enhancedSensorEnabled
))
const sensorEnhancementStatus = computed<'off' | 'running' | 'preparing' | 'needs-auth' | 'error' | 'pending'>(() => {
  if (!sensorSettings.value.enhancedSensorEnabled) return 'off'
  if (sensorActionLoading.value) return 'preparing'
  if (sensorEnhancementReady.value) return 'running'

  if (sensorEnhancementPlatform.value === 'macos') {
    if (macHelperStatus.value?.reason === 'MACOS_POWERMETRICS_HELPER_INSTALL_FAILED') return 'error'
    if (!macHelperStatus.value?.installed) return 'needs-auth'
  }

  if (sensorEnhancementPlatform.value === 'windows') {
    const reason = openHardwareMonitorStatus.value?.reason || ''
    if (reason === 'OHM_START_FAILED' || reason === 'OHM_EXE_NOT_FOUND' || reason === 'OHM_RUNTIME_COPY_FAILED') return 'error'
  }

  return 'pending'
})
const processorSensorControlStatus = computed(() => {
  switch (sensorEnhancementStatus.value) {
    case 'off':
      return '已关闭'
    case 'running':
      return '运行中'
    case 'preparing':
      return '准备中'
    case 'needs-auth':
      return '需授权'
    case 'error':
      return '异常'
    default:
      return '待启用'
  }
})
const sensorEnhancementDescription = computed(() => {
  if (sensorEnhancementPlatform.value === 'windows') {
    if (!sensorSettings.value.enhancedSensorEnabled) {
      return 'OHM 已关闭。需要时可启用 OpenHardwareMonitor 补齐温度、频率和功耗数据。'
    }
    if (sensorEnhancementStatus.value === 'running') return 'OpenHardwareMonitor 正在补齐温度、频率、功耗等传感器数据。'
    if (sensorEnhancementStatus.value === 'preparing') return '正在准备 OpenHardwareMonitor 组件，请稍候。'
    if (sensorEnhancementStatus.value === 'error') return 'OpenHardwareMonitor 未能就绪，可以重试或查看详情。'
    return 'OpenHardwareMonitor 已启用，组件就绪后会自动补齐缺失数据。'
  }

  if (!sensorSettings.value.enhancedSensorEnabled) return '已关闭'
  if (sensorEnhancementStatus.value === 'running') return '正在补齐温度、频率、功耗等传感器数据。'
  if (sensorEnhancementStatus.value === 'preparing') return '正在准备增强组件，请稍候。'
  if (sensorEnhancementStatus.value === 'needs-auth') return '需要一次系统授权，授权后会自动启用增强采样。'
  if (sensorEnhancementStatus.value === 'error') return '增强组件未能就绪，可以重试或查看详情。'
  return '增强模式默认开启，组件就绪后会自动补齐缺失数据。'
})
const showMainHeaderActions = computed(() =>
  currentPage.value === 'computer' && Boolean(currentDevCopyTarget.value)
)

const sensorDiagnosticsText = computed(() => {
  const lines = [
    sensorEnhancementPlatform.value === 'windows' ? 'OpenHardwareMonitor 诊断' : '传感器增强诊断',
    `生成时间：${new Date().toLocaleString('zh-CN')}`,
    `平台：${sensorEnhancementPlatform.value}`,
    `状态：${processorSensorControlStatus.value}`,
    `${
      sensorEnhancementPlatform.value === 'windows' ? 'OHM 支持' : '增强开关'
    }：${sensorSettings.value.enhancedSensorEnabled ? '已开启' : '已关闭'}`,
  ]

  if (sensorEnhancementPlatform.value === 'windows') {
    lines.push(
      `OHM 自启动：${sensorSettings.value.openHardwareMonitorAutoStart ? '已开启' : '已关闭'}`,
      `OHM 端口：${sensorSettings.value.openHardwareMonitorPort}`
    )
  }

  if (sensorEnhancementPlatform.value === 'windows' && openHardwareMonitorStatus.value) {
    lines.push(
      '',
      '[OpenHardwareMonitor]',
      `running：${Boolean(openHardwareMonitorStatus.value.running)}`,
      `reason：${openHardwareMonitorStatus.value.reason || ''}`,
      `suggestion：${openHardwareMonitorStatus.value.suggestion || ''}`,
      `executableExists：${Boolean(openHardwareMonitorStatus.value.executableExists)}`
    )
  }

  if (sensorEnhancementPlatform.value === 'macos' && macHelperStatus.value) {
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

async function copySensorDiagnostics() {
  try {
    await writeClipboard(sensorDiagnosticsText.value)
    sensorActionMessage.value = '诊断信息已复制'
  } catch (error) {
    console.error('复制传感器诊断失败:', error)
    sensorActionMessage.value = '诊断信息复制失败'
  }
}

function toggleSensorMenu() {
  sensorMenuOpen.value = !sensorMenuOpen.value
}

async function setProcessorSensorEnhancementEnabled(nextEnabled: boolean) {
  if (sensorEnhancementPlatform.value === 'unsupported' || sensorActionLoading.value) return

  sensorActionLoading.value = true

  try {
    sensorActionMessage.value = ''
    sensorSettings.value = await window.services.updateHardwareSensorSettings({
      enhancedSensorEnabled: nextEnabled,
      openHardwareMonitorAutoStart: nextEnabled,
    })

    if (nextEnabled) {
      sensorAutoPrepareAttempted.value = false
      await prepareGlobalSensorEnhancement(false)
    } else if (sensorEnhancementPlatform.value === 'macos' && macHelperStatus.value?.installed) {
      macHelperStatus.value = await window.services.uninstallMacPowermetricsHelper()
    } else if (sensorEnhancementPlatform.value === 'windows') {
      openHardwareMonitorStatus.value = await window.services.getOpenHardwareMonitorStatus()
    }

    await processorRef.value?.refreshSensorEnhancementState?.()
    sensorMenuOpen.value = false
  } finally {
    sensorActionLoading.value = false
  }
}

function openProcessorSensorDetails() {
  if (selectedSection.value !== 'processor') {
    selectedSection.value = 'processor'
  }

  sensorMenuOpen.value = false
  processorRef.value?.openSensorEnhancementPanel?.()
}

async function refreshGlobalSensorEnhancementState() {
  if (sensorEnhancementPlatform.value === 'unsupported') return

  sensorSettingsLoading.value = true

  try {
    sensorSettings.value = await window.services.getHardwareSensorSettings()

    if (sensorEnhancementPlatform.value === 'windows') {
      openHardwareMonitorStatus.value = await window.services.getOpenHardwareMonitorStatus()
    } else if (sensorEnhancementPlatform.value === 'macos') {
      macHelperStatus.value = await window.services.getMacPowermetricsHelperStatus()
    }
  } finally {
    sensorSettingsLoading.value = false
  }
}

async function prepareGlobalSensorEnhancement(auto: boolean) {
  if (auto && sensorAutoPrepareAttempted.value) return
  if (auto) sensorAutoPrepareAttempted.value = true

  if (!shouldAutoPrepareSensorEnhancement(
    sensorEnhancementPlatform.value,
    sensorSettings.value.enhancedSensorEnabled,
    sensorEnhancementReady.value
  )) {
    return
  }

  sensorActionLoading.value = true

  try {
    if (sensorEnhancementPlatform.value === 'windows') {
      openHardwareMonitorStatus.value = await window.services.startOpenHardwareMonitor()
      openHardwareMonitorStatus.value = await window.services.getOpenHardwareMonitorStatus()
    } else if (sensorEnhancementPlatform.value === 'macos') {
      if (!macHelperStatus.value?.installed) {
        sensorAuthorizationPromptVisible.value = true
        return
      }

      macHelperStatus.value = await window.services.installMacPowermetricsHelper()
      macHelperStatus.value = await window.services.getMacPowermetricsHelperStatus()
    }

    await processorRef.value?.refreshSensorEnhancementState?.()
  } finally {
    sensorActionLoading.value = false
  }
}

async function continueSensorAuthorization() {
  if (sensorEnhancementPlatform.value !== 'macos' || sensorActionLoading.value) return

  sensorAuthorizationPromptVisible.value = false
  sensorActionLoading.value = true

  try {
    sensorActionMessage.value = '正在请求系统授权...'
    macHelperStatus.value = await window.services.installMacPowermetricsHelper()
    macHelperStatus.value = await window.services.getMacPowermetricsHelperStatus()
    sensorActionMessage.value = macHelperStatus.value.loaded && macHelperStatus.value.socketExists
      ? '增强模式已运行'
      : macHelperStatus.value.suggestion || '增强组件尚未就绪'
    await processorRef.value?.refreshSensorEnhancementState?.()
    sensorMenuOpen.value = false
  } finally {
    sensorActionLoading.value = false
  }
}

async function disableSensorFromPrompt() {
  sensorAuthorizationPromptVisible.value = false
  await setProcessorSensorEnhancementEnabled(false)
}

async function retrySensorEnhancement() {
  sensorAutoPrepareAttempted.value = false
  await refreshGlobalSensorEnhancementState()
  await prepareGlobalSensorEnhancement(false)
  sensorMenuOpen.value = false
}

async function refreshSensorEnhancementFromMenu() {
  await refreshGlobalSensorEnhancementState()
  await processorRef.value?.refreshSensorEnhancementState?.()
}

const headerMeta = computed(() => {
  if (selectedSection.value === 'processor') {
    return {
      title: '处理器',
      description: '查看 CPU 的核心规格、实时频率、温度和功耗',
    }
  }

  if (selectedSection.value === 'graphics') {
    return {
      title: '显卡',
      description: '查看 GPU 的核心规格、实时温度、频率、显存与负载情况',
    }
  }

  if (selectedSection.value === 'board') {
    return {
      title: '主板',
      description: '查看主板型号、芯片组、BIOS 和扩展接口等信息',
    }
  }

  if (selectedSection.value === 'memory') {
    return {
      title: '内存',
      description: '查看内存规格、时序、使用率和运行状态',
    }
  }

  if (selectedSection.value === 'storage') {
    return {
      title: '存储',
      description: '查看磁盘、固态硬盘和存储设备的详细信息与健康状态',
    }
  }

  const navLabel = primaryNavItems.find((item) => item.id === selectedSection.value)?.label

  if (selectedSection.value !== 'overview') {
    return {
      title: navLabel || '系统概览',
      description: '快速了解你的电脑硬件配置',
    }
  }

  return {
    title: '系统概览',
    description: '快速了解你的电脑硬件配置',
  }
})

watch(currentPage, () => {
  syncBodyMode()
})

watch(
  [sensorEnhancementPlatform, currentPage],
  async ([platform, page]) => {
    if (page !== 'computer' || platform === 'unsupported') return
    await refreshGlobalSensorEnhancementState()
    await prepareGlobalSensorEnhancement(true)
  },
  { immediate: true }
)

onMounted(() => {
  if (!window.location.hash) {
    window.location.hash = 'computer'
  }
  window.addEventListener('hashchange', syncHash)
  syncBodyMode()
})

onUnmounted(() => {
  window.removeEventListener('hashchange', syncHash)
  document.body.classList.remove('watch-window-body')
  if (copyFeedbackTimerId) {
    window.clearTimeout(copyFeedbackTimerId)
    copyFeedbackTimerId = undefined
  }
})
</script>

<template>
  <div v-if="isWatchPage" class="watch-stage">
    <Watch :active="true" :initial-floating-mode="initialFloatingMode" :initial-floating-entry="initialFloatingEntry" />
  </div>

  <div v-else-if="isDeviceSpecsPage" class="device-specs-stage">
    <div class="window-titlebar device-specs-titlebar">
      <div class="window-titlebar__brand device-specs-titlebar__brand">
        <span class="window-titlebar__mark" aria-hidden="true">H</span>
        <span class="device-specs-titlebar__text">设备规格</span>
      </div>

      <div class="window-titlebar__drag-spacer" aria-hidden="true" />

      <div class="window-titlebar__actions">
        <Bar />
      </div>
    </div>

    <main class="device-specs-standalone-content">
      <DeviceSpecsLite :active="true" />
    </main>
  </div>

  <div v-else class="desktop-shell">
    <div class="window-titlebar">
      <div class="window-titlebar__brand">
        <span class="window-titlebar__mark" aria-hidden="true">H</span>
      </div>

      <div class="window-titlebar__drag-spacer" aria-hidden="true" />

      <div class="window-titlebar__right">
        <div v-if="currentPage === 'computer'" class="window-titlebar__controls">
          <div class="header-refresh-group">
            <div class="header-refresh-chips">
              <button
                v-for="profile in refreshProfiles"
                :key="profile.id"
                type="button"
                :disabled="refreshSettingsPending"
                :aria-label="`切换刷新档位为 ${profile.label}`"
                :title="`切换刷新档位为 ${profile.label}`"
                :class="['header-chip', { 'header-chip--active': overviewRefreshSettings.profile === profile.id }]"
                @click="applyOverviewRefreshProfile(profile.id)"
              >
                {{ profile.label }}
              </button>
            </div>

            <button
              type="button"
              :disabled="refreshSettingsPending"
              aria-label="切换后台降频"
              :title="overviewRefreshSettings.backgroundThrottleEnabled ? '关闭窗口后台时自动降频' : '开启窗口后台时自动降频'"
              :class="['header-toggle', { 'header-toggle--active': overviewRefreshSettings.backgroundThrottleEnabled }]"
              @click="toggleOverviewBackgroundThrottle()"
            >
              后台降频
              <em>{{ overviewBackgroundThrottled ? '生效中' : overviewRefreshSettings.backgroundThrottleEnabled ? '已开启' : '已关闭' }}</em>
            </button>
          </div>

          <div v-if="processorSensorControlVisible" class="header-sensor-menu">
            <button
              type="button"
              :disabled="processorSensorControlDisabled"
              :aria-label="processorSensorControlAriaLabel"
              :title="processorSensorControlTitle"
              :class="[
                'header-sensor-trigger',
                `header-sensor-trigger--${sensorEnhancementStatus}`,
                { 'header-sensor-trigger--active': processorSensorControlActive },
              ]"
              @click="toggleSensorMenu()"
            >
              <span>{{ processorSensorControlLabel }}</span>
              <em>{{ processorSensorControlStatus }}</em>
              <strong aria-hidden="true">⌄</strong>
            </button>

            <div v-if="sensorMenuOpen" class="sensor-menu-popover">
              <div class="sensor-menu-popover__head">
                <span>{{ processorSensorControlLabel }}</span>
                <strong>{{ processorSensorControlStatus }}</strong>
              </div>
              <p>{{ sensorEnhancementDescription }}</p>
              <p v-if="sensorActionMessage" class="sensor-menu-popover__message">{{ sensorActionMessage }}</p>

              <div class="sensor-menu-popover__actions">
                <button
                  v-if="sensorEnhancementStatus === 'off'"
                  type="button"
                  class="sensor-menu-action sensor-menu-action--primary"
                  :disabled="sensorActionLoading"
                  @click="setProcessorSensorEnhancementEnabled(true)"
                >
                  {{ processorSensorPrimaryActionLabel }}
                </button>
                <button
                  v-else-if="sensorEnhancementStatus === 'needs-auth'"
                  type="button"
                  class="sensor-menu-action sensor-menu-action--primary"
                  :disabled="sensorActionLoading"
                  @click="sensorAuthorizationPromptVisible = true"
                >
                  继续授权
                </button>
                <button
                  v-else-if="sensorEnhancementStatus === 'error'"
                  type="button"
                  class="sensor-menu-action sensor-menu-action--primary"
                  :disabled="sensorActionLoading"
                  @click="retrySensorEnhancement()"
                >
                  重试
                </button>
                <button
                  v-else
                  type="button"
                  class="sensor-menu-action"
                  :disabled="sensorActionLoading"
                  @click="setProcessorSensorEnhancementEnabled(false)"
                >
                  {{ processorSensorPrimaryActionLabel }}
                </button>

                <button
                  type="button"
                  class="sensor-menu-action"
                  :disabled="sensorSettingsLoading || sensorActionLoading"
                  @click="refreshSensorEnhancementFromMenu()"
                >
                  重新检测
                </button>
                <button
                  type="button"
                  class="sensor-menu-action"
                  @click="openProcessorSensorDetails()"
                >
                  查看详情
                </button>
                <button
                  v-if="sensorEnhancementStatus === 'error'"
                  type="button"
                  class="sensor-menu-action"
                  @click="copySensorDiagnostics()"
                >
                  复制诊断
                </button>
              </div>

              <div v-if="sensorSettings.enhancedSensorEnabled" class="sensor-menu-popover__note">
                关闭后仍可查看基础硬件信息，但部分温度、频率或功耗可能显示为暂不支持。
              </div>
            </div>
          </div>
        </div>

        <div class="window-titlebar__actions">
          <Bar />
        </div>
      </div>
    </div>

    <div v-if="sensorAuthorizationPromptVisible" class="sensor-auth-overlay">
      <section class="sensor-auth-dialog">
        <div class="sensor-auth-dialog__head">
          <span>传感器增强</span>
          <h2>启用传感器增强</h2>
        </div>
        <p>
          为了读取更完整的温度、频率和功耗数据，需要一次系统授权。授权后会自动启用增强模式，你也可以随时在顶部关闭。
        </p>
        <div class="sensor-auth-dialog__actions">
          <button
            type="button"
            class="sensor-menu-action"
            :disabled="sensorActionLoading"
            @click="disableSensorFromPrompt()"
          >
            暂不启用
          </button>
          <button
            type="button"
            class="sensor-menu-action sensor-menu-action--primary"
            :disabled="sensorActionLoading"
            @click="continueSensorAuthorization()"
          >
            继续授权
          </button>
        </div>
      </section>
    </div>

    <aside class="sidebar">
      <nav class="sidebar-nav">
        <button
          v-for="item in primaryNavItems"
          :key="item.id"
          type="button"
          :class="['nav-item', { 'nav-item--active': selectedSection === item.id }]"
          @click="selectSection(item.id)"
        >
          <component :is="item.icon" theme="outline" size="18" fill="currentColor" :strokeWidth="3" />
          <span>{{ item.label }}</span>
        </button>
      </nav>

      <div class="sidebar-footer">
        <div class="sidebar-version">v1.0.0</div>
      </div>
    </aside>

    <section class="main-shell">
      <header class="main-header">
        <div class="main-header__copy">
          <h1>{{ headerMeta.title }}</h1>
          <p>{{ headerMeta.description }}</p>
        </div>

        <div v-if="showMainHeaderActions" class="main-header__actions">
          <button
            type="button"
            :disabled="copyPending"
            :class="devCopyButtonClass"
            @click="copyCurrentSectionInfo()"
          >
            {{ devCopyButtonText }}
          </button>
          <button
            type="button"
            class="export-button"
            @click="exportCurrentSectionReport()"
          >
            导出报告
          </button>
        </div>
      </header>

      <main class="main-content">
        <Computer ref="computerRef" v-show="selectedSection === 'overview'" :active="selectedSection === 'overview'" />
        <Processor ref="processorRef" v-show="selectedSection === 'processor'" :active="selectedSection === 'processor'" />
        <GraphicsPage ref="graphicsRef" v-show="selectedSection === 'graphics'" :active="selectedSection === 'graphics'" />
        <BoardPage ref="boardRef" v-show="selectedSection === 'board'" :active="selectedSection === 'board'" />
        <MemoryPage ref="memoryRef" v-show="selectedSection === 'memory'" :active="selectedSection === 'memory'" />
        <StoragePage ref="storageRef" v-show="selectedSection === 'storage'" :active="selectedSection === 'storage'" />
      </main>
    </section>
  </div>
</template>

<style scoped lang="less">
.watch-stage {
  height: 100%;
  width: 100%;
}

.device-specs-stage {
  display: grid;
  grid-template-rows: 44px minmax(0, 1fr);
  height: 100%;
  width: 100%;
  background: var(--app-background);
}

.device-specs-titlebar {
  grid-row: 1;
  grid-column: 1;
  min-height: 44px;
  padding: 0 10px 0 14px;
  border-bottom: 1px solid var(--panel-border);
}

.window-titlebar__brand.device-specs-titlebar__brand {
  flex: 0 0 auto;
  min-width: 112px;
  gap: 10px;
}

.device-specs-titlebar .window-titlebar__mark {
  width: 28px;
  height: 28px;
  border-radius: 10px;
}

.device-specs-titlebar__text {
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 800;
}

.device-specs-standalone-content {
  grid-row: 2;
  min-width: 0;
  min-height: 0;
  padding: 14px 16px 16px;
  overflow: hidden;
}

.desktop-shell {
  display: grid;
  grid-template-rows: 54px minmax(0, 1fr);
  grid-template-columns: 176px minmax(0, 1fr);
  height: 100%;
  width: 100%;
  background: var(--app-background);
}

.sidebar {
  grid-row: 2;
  grid-column: 1;
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
  padding: 18px 14px;
  border-right: 1px solid var(--panel-border);
  background: linear-gradient(180deg, rgba(18, 25, 36, 0.98), rgba(13, 20, 30, 0.98));
}

.sidebar-nav,
.sidebar-footer {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sidebar-footer {
  margin-top: auto;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  padding: 0 14px;
  border: 1px solid transparent;
  border-radius: var(--frame-radius);
  color: var(--frame-fg);
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease, transform 0.18s ease;
}

.nav-item:hover {
  background: rgba(255, 255, 255, 0.03);
  color: var(--frame-fg-strong);
}

.nav-item--secondary {
  min-height: 44px;
}

.nav-item--active {
  background: var(--frame-active-bg);
  border-color: var(--frame-active-border);
  color: var(--frame-fg-strong);
  box-shadow:
    inset 3px 0 0 var(--accent-blue),
    0 10px 24px rgba(4, 10, 18, 0.24);
}

.nav-item span {
  font-size: 15px;
  font-weight: 600;
}

.sidebar-version {
  padding: 10px 14px 0;
  color: var(--text-subtle);
  font-size: 12px;
}

.main-shell {
  grid-row: 2;
  grid-column: 2;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: 18px 30px 24px;
}

.window-titlebar {
  grid-row: 1;
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 54px;
  padding: 0 12px 0 18px;
  border-bottom: 1px solid var(--panel-border);
  background:
    linear-gradient(180deg, rgba(18, 27, 39, 0.98), rgba(15, 23, 34, 0.98));
  -webkit-app-region: drag;
  cursor: grab;
  user-select: none;
}

.window-titlebar:active {
  cursor: grabbing;
}

.window-titlebar__brand {
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  flex: 0 0 42px;
  color: var(--text-primary);
}

.window-titlebar__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 10px;
  background: var(--brand-bg);
  color: var(--brand-fg);
  font-size: 15px;
  font-weight: 800;
  box-shadow: var(--brand-shadow);
}

.window-titlebar__actions {
  display: flex;
  align-items: center;
  -webkit-app-region: no-drag;
}

.window-titlebar__drag-spacer {
  flex: 1 1 auto;
  align-self: stretch;
  min-width: 96px;
}

.window-titlebar__right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex: 0 1 auto;
  gap: 14px;
  min-width: 0;
  -webkit-app-region: no-drag;
}

.window-titlebar__controls {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex: 0 1 auto;
  gap: 10px;
  min-width: 0;
  flex-wrap: wrap;
  -webkit-app-region: no-drag;
}

.main-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding: 6px 0 10px;
  margin-bottom: 18px;
  border-bottom: 1px solid rgba(96, 116, 146, 0.1);
}

.main-header__actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: flex-end;
  padding-top: 6px;
}

.header-refresh-group {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.header-refresh-chips {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px;
  border: 1px solid var(--frame-border);
  border-radius: var(--frame-radius);
  background: var(--frame-bg);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
}

.header-sensor-menu {
  display: inline-flex;
  align-items: center;
  position: relative;
  justify-content: center;
}

.header-chip,
.header-toggle,
.header-sensor-trigger,
.sensor-menu-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--control-height);
  border-radius: var(--control-radius);
  border: 1px solid var(--control-border);
  color: var(--control-fg);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease;
}

.header-chip {
  min-width: 52px;
  padding: 0 12px;
  background: transparent;
}

.header-chip:hover,
.header-toggle:hover,
.header-sensor-trigger:hover,
.sensor-menu-action:hover {
  color: var(--control-fg-strong);
  border-color: var(--control-border-strong);
}

.header-chip--active {
  border-color: var(--control-active-border);
  background: var(--control-active-bg);
  color: var(--control-fg-strong);
  box-shadow: var(--control-active-shadow);
}

.header-toggle {
  gap: 8px;
  padding: 0 14px;
  background: var(--control-bg);
}

.header-toggle em,
.header-sensor-trigger em {
  color: var(--text-subtle);
  font-style: normal;
  font-size: 12px;
  font-weight: 600;
}

.header-toggle--active {
  border-color: rgba(126, 214, 113, 0.3);
  background: linear-gradient(180deg, rgba(67, 153, 74, 0.14), rgba(36, 88, 43, 0.08));
  color: var(--control-fg-strong);
}

.header-sensor-trigger {
  gap: 8px;
  padding: 0 14px;
  min-width: 146px;
  border-color: rgba(255, 207, 87, 0.28);
  background: linear-gradient(180deg, rgba(58, 44, 18, 0.34), rgba(20, 29, 42, 0.7));
  color: var(--control-fg-strong);

  strong {
    color: var(--text-subtle);
    font-size: 13px;
    line-height: 1;
  }
}

.header-sensor-trigger--active,
.header-sensor-trigger--running {
  border-color: rgba(126, 214, 113, 0.3);
  background: linear-gradient(180deg, rgba(67, 153, 74, 0.14), rgba(36, 88, 43, 0.08));
}

.header-sensor-trigger--active em,
.header-sensor-trigger--running em {
  color: var(--accent-green);
}

.header-sensor-trigger--needs-auth em {
  color: var(--accent-yellow);
}

.header-sensor-trigger--error {
  border-color: rgba(255, 126, 107, 0.38);
  background: linear-gradient(180deg, rgba(113, 45, 35, 0.26), rgba(42, 28, 31, 0.72));
}

.header-sensor-trigger--error em {
  color: var(--accent-danger);
}

.header-sensor-trigger--off {
  border-color: var(--control-border);
  background: var(--control-bg);
}

.sensor-menu-popover {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  z-index: 20;
  width: 288px;
  padding: 14px;
  border: 1px solid var(--panel-border);
  border-radius: 12px;
  background: linear-gradient(180deg, rgba(20, 29, 42, 0.98), rgba(15, 23, 34, 0.98));
  box-shadow: 0 18px 42px rgba(2, 8, 18, 0.38);
  -webkit-app-region: no-drag;

  p {
    margin: 10px 0 0;
    color: var(--text-muted);
    font-size: 13px;
    line-height: 1.55;
  }
}

.sensor-menu-popover__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;

  span {
    color: var(--text-primary);
    font-size: 14px;
    font-weight: 800;
  }

  strong {
    min-height: 24px;
    padding: 0 9px;
    border-radius: var(--pill-radius);
    background: var(--state-info-bg);
    color: var(--state-info-fg);
    display: inline-flex;
    align-items: center;
    font-size: 12px;
    font-weight: 800;
  }
}

.sensor-menu-popover__message {
  color: var(--accent-cyan) !important;
}

.sensor-menu-popover__actions {
  display: grid;
  gap: 8px;
  margin-top: 14px;
}

.sensor-menu-action {
  min-height: 36px;
  padding: 0 12px;
  background: var(--control-bg);
  color: var(--control-fg);
}

.sensor-menu-action--primary {
  border-color: var(--button-primary-border);
  background: var(--button-primary-bg);
  color: var(--button-primary-fg);
}

.sensor-menu-action:disabled {
  cursor: not-allowed;
  opacity: 0.56;
}

.sensor-menu-popover__note {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--panel-border-soft);
  color: var(--text-subtle);
  font-size: 12px;
  line-height: 1.5;
}

.sensor-auth-overlay {
  grid-row: 1 / -1;
  grid-column: 1 / -1;
  z-index: 30;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(5, 10, 18, 0.52);
  backdrop-filter: blur(10px);
}

.sensor-auth-dialog {
  width: min(440px, 100%);
  padding: 20px;
  border: 1px solid var(--panel-border);
  border-radius: 14px;
  background: linear-gradient(180deg, rgba(20, 29, 42, 0.98), rgba(15, 23, 34, 0.98));
  box-shadow: 0 24px 54px rgba(2, 8, 18, 0.46);

  p {
    margin: 12px 0 0;
    color: var(--text-muted);
    font-size: 14px;
    line-height: 1.65;
  }
}

.sensor-auth-dialog__head {
  span {
    color: var(--accent-cyan);
    font-size: 12px;
    font-weight: 800;
  }

  h2 {
    margin: 6px 0 0;
    color: var(--text-primary);
    font-size: 20px;
    font-weight: 800;
  }
}

.sensor-auth-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 18px;
}

.main-header__copy {
  position: relative;
  padding-left: 16px;

  &::before {
    content: '';
    position: absolute;
    left: 0;
    top: 10px;
    width: 4px;
    height: 34px;
    border-radius: 999px;
    background: linear-gradient(180deg, rgba(74, 174, 255, 0.95), rgba(74, 174, 255, 0.22));
    box-shadow: 0 0 16px rgba(74, 174, 255, 0.18);
  }

  h1 {
    margin: 0;
    color: var(--text-primary);
    font-size: 28px;
    font-weight: 700;
    letter-spacing: -0.03em;
  }

  p {
    margin: 10px 0 0;
    color: var(--text-subtle);
    font-size: 15px;
  }
}

.export-button {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: var(--button-height-lg);
  padding: 0 18px;
  border: 1px solid var(--button-border);
  border-radius: var(--button-radius-lg);
  background: var(--button-bg);
  color: var(--button-fg);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease;
}

.primary-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--button-height-lg);
  padding: 0 18px;
  border: 1px solid var(--button-primary-border);
  border-radius: var(--button-radius-lg);
  background: var(--button-primary-bg);
  color: var(--button-primary-fg);
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease;
}

.primary-button:hover {
  background: var(--button-primary-hover-bg);
  border-color: var(--button-primary-hover-border);
}

.debug-button {
  min-height: var(--button-height-lg);
  padding: 0 16px;
  border: 1px dashed rgba(92, 112, 144, 0.48);
  border-radius: var(--button-radius-lg);
  background: rgba(20, 29, 42, 0.5);
  color: var(--text-muted);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease;
}

.debug-button:hover {
  background: rgba(28, 39, 55, 0.76);
  border-color: rgba(108, 130, 166, 0.58);
  color: var(--text-primary);
}

.debug-button--success {
  border-color: rgba(89, 201, 118, 0.54);
  color: var(--button-feedback-success);
}

.debug-button--error {
  border-color: rgba(255, 126, 107, 0.56);
  color: var(--button-feedback-error);
}

.export-button:hover {
  background: var(--button-hover-bg);
  border-color: var(--button-hover-border);
}

.main-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

@media (max-width: 1120px) {
  .desktop-shell {
    grid-template-columns: 148px minmax(0, 1fr);
  }

  .main-shell {
    padding: 16px 22px 20px;
  }

  .nav-item span {
    font-size: 14px;
  }
}

@media (max-width: 760px) {
  .main-shell {
    padding: 16px 18px 18px;
  }

  .window-titlebar {
    min-height: 52px;
    padding: 0 10px 0 12px;
  }

  .window-titlebar__drag-spacer {
    min-width: 32px;
  }

  .window-titlebar__controls {
    justify-content: flex-end;
  }

  .main-header__copy {
    padding-left: 14px;
  }
}
</style>
