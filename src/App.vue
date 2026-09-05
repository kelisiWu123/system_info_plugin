<script setup lang="ts">
import {
  Chip,
  Computer as ComputerIcon,
  Cpu,
  DownOne,
  GraphicDesign,
  HardDisk,
  Memory,
} from '@icon-park/vue-next'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import ThemeControl from './components/common/ThemeControl.vue'
import { overviewHardwareStore } from './composables/useOverviewHardwareData'
import { useSensorEnhancementController } from './composables/useSensorEnhancementController'
import { resolveDevPageCopyTarget } from './utils/devPageCopy'
import {
  resolveInitialFloatingEntry,
  resolveInitialFloatingMode,
  resolvePageName,
  type PageName,
} from './utils/hashRoute'

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
const exportFeedback = ref<'idle' | 'success' | 'error'>('idle')
const computerRef = ref<CopyablePageHandle | null>(null)
const processorRef = ref<CopyablePageHandle | null>(null)
const graphicsRef = ref<CopyablePageHandle | null>(null)
const boardRef = ref<CopyablePageHandle | null>(null)
const memoryRef = ref<CopyablePageHandle | null>(null)
const storageRef = ref<CopyablePageHandle | null>(null)
const sensorMenuRootRef = ref<HTMLElement | null>(null)
const sensorMenuTriggerRef = ref<HTMLButtonElement | null>(null)
const sensorAuthorizationDialogRef = ref<HTMLElement | null>(null)
const sensorAuthorizationReturnFocus = ref<HTMLElement | null>(null)
let copyFeedbackTimerId: number | undefined
let exportFeedbackTimerId: number | undefined

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
const hasExplicitPageRoute = computed(() => Boolean(currentHash.value.replace(/^#\/?/, '').trim()))
const initialFloatingMode = computed(() => resolveInitialFloatingMode(currentHash.value))
const initialFloatingEntry = computed(() => resolveInitialFloatingEntry(currentHash.value))
const isWatchPage = computed(() => currentPage.value === 'watch')
const isMonitorPage = computed(() => currentPage.value === 'monitor')
const isDeviceSpecsPage = computed(() => currentPage.value === 'deviceSpecs')
const currentDevCopyTarget = computed(() => resolveDevPageCopyTarget(selectedSection.value))

const {
  sensorSettings,
  sensorSettingsLoading,
  sensorActionLoading,
  sensorMenuOpen,
  sensorAuthorizationPromptVisible,
  sensorActionMessage,
  platform: sensorEnhancementPlatform,
  ready: sensorEnhancementReady,
  active: processorSensorControlActive,
  disabled: processorSensorControlDisabled,
  controlLabel: processorSensorControlLabel,
  controlAriaLabel: processorSensorControlAriaLabel,
  primaryActionLabel: processorSensorPrimaryActionLabel,
  status: sensorEnhancementStatus,
  statusLabel: processorSensorControlStatus,
  controlTitle: processorSensorControlTitle,
  description: sensorEnhancementDescription,
  refreshState: refreshGlobalSensorEnhancementState,
  prepare: prepareGlobalSensorEnhancement,
  setEnabled: setProcessorSensorEnhancementEnabled,
  continueAuthorization: continueSensorAuthorization,
  disableFromPrompt: disableSensorFromPrompt,
  retry: retrySensorEnhancement,
  refreshFromMenu: refreshSensorEnhancementFromMenu,
  copyDiagnostics: copySensorDiagnostics,
  toggleMenu: toggleSensorMenu,
  openDetails: openProcessorSensorDetails,
} = useSensorEnhancementController({
  osInfo: overviewHardwareStore.osInfo,
  refreshProcessorState: () => processorRef.value?.refreshSensorEnhancementState?.(),
  openProcessorDetails: async () => {
    selectedSection.value = 'processor'
    await nextTick()
    processorRef.value?.openSensorEnhancementPanel?.()
  },
})

function syncBodyMode() {
  document.body.classList.toggle('watch-window-body', isWatchPage.value)
}

function syncDocumentTitle() {
  document.title = isWatchPage.value
    ? initialFloatingEntry.value === 'hardwareWatchSuperLite'
      ? '超轻量监控浮窗'
      : initialFloatingEntry.value === 'hardwareWatch'
        ? '标准监控浮窗'
        : '监控浮窗预览'
    : isMonitorPage.value
      ? '硬件监控'
      : isDeviceSpecsPage.value
        ? '设备规格'
        : '硬件信息'
}

watch(sensorAuthorizationPromptVisible, async (visible) => {
  if (visible) {
    sensorAuthorizationReturnFocus.value = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    await nextTick()
    sensorAuthorizationDialogRef.value?.focus()
    return
  }

  const returnFocus = sensorAuthorizationReturnFocus.value
  sensorAuthorizationReturnFocus.value = null
  await nextTick()
  if (!sensorAuthorizationPromptVisible.value && returnFocus?.isConnected) {
    returnFocus.focus()
  }
})

function trapSensorAuthorizationFocus(event: KeyboardEvent) {
  const dialog = sensorAuthorizationDialogRef.value
  if (!dialog) return

  const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
  if (!buttons.length) {
    event.preventDefault()
    dialog.focus()
    return
  }

  const firstButton = buttons[0]
  const lastButton = buttons[buttons.length - 1]
  const activeElement = document.activeElement

  if (event.shiftKey && (activeElement === firstButton || activeElement === dialog)) {
    event.preventDefault()
    lastButton.focus()
  } else if (!event.shiftKey && activeElement === lastButton) {
    event.preventDefault()
    firstButton.focus()
  }
}

function dismissSensorAuthorizationPrompt() {
  if (sensorActionLoading.value) return
  sensorAuthorizationPromptVisible.value = false
}

function closeSensorMenuAndRestoreFocus() {
  sensorMenuOpen.value = false
  nextTick(() => sensorMenuTriggerRef.value?.focus())
}

function closeSensorMenuOnOutsidePointer(event: PointerEvent) {
  if (!sensorMenuOpen.value || !(event.target instanceof Node)) return
  if (!sensorMenuRootRef.value?.contains(event.target)) {
    sensorMenuOpen.value = false
  }
}

function selectSection(id: SidebarItem['id']) {
  selectedSection.value = id
  sensorMenuOpen.value = false
  sensorActionMessage.value = ''
  clearCopyFeedback()
  clearExportFeedback()

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

function clearCopyFeedback() {
  copyFeedback.value = 'idle'
  if (copyFeedbackTimerId) {
    window.clearTimeout(copyFeedbackTimerId)
    copyFeedbackTimerId = undefined
  }
}

function resetExportFeedbackLater() {
  if (exportFeedbackTimerId) {
    window.clearTimeout(exportFeedbackTimerId)
  }

  exportFeedbackTimerId = window.setTimeout(() => {
    exportFeedback.value = 'idle'
    exportFeedbackTimerId = undefined
  }, 1800)
}

function clearExportFeedback() {
  exportFeedback.value = 'idle'
  if (exportFeedbackTimerId) {
    window.clearTimeout(exportFeedbackTimerId)
    exportFeedbackTimerId = undefined
  }
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
  clearExportFeedback()

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
  } catch (error) {
    console.error('复制当前页面信息失败:', error)
    copyFeedback.value = 'error'
    resetCopyFeedbackLater()
  } finally {
    copyPending.value = false
  }
}

function exportCurrentSectionReport() {
  if (copyPending.value) return
  clearCopyFeedback()

  try {
    const exportReport = getCurrentCopyHandle()?.exportReport
    if (!exportReport) throw new Error('当前页面不支持报告导出')
    exportReport()
    exportFeedback.value = 'success'
  } catch (error) {
    console.error('导出当前页面报告失败:', error)
    exportFeedback.value = 'error'
  }
  resetExportFeedbackLater()
}

const devCopyButtonClass = computed(() => [
  'debug-button',
  copyFeedback.value === 'success' ? 'debug-button--success' : '',
  copyFeedback.value === 'error' ? 'debug-button--error' : '',
])

const devCopyButtonText = computed(() => {
  if (copyPending.value) return '复制中...'
  if (copyFeedback.value === 'success') return '已复制'
  if (copyFeedback.value === 'error') return '复制失败'
  return currentDevCopyTarget.value?.buttonLabel || '复制当前页信息'
})

const exportButtonClass = computed(() => [
  'export-button',
  exportFeedback.value === 'success' ? 'export-button--success' : '',
  exportFeedback.value === 'error' ? 'export-button--error' : '',
])

const exportButtonText = computed(() => {
  if (exportFeedback.value === 'success') return '已开始导出'
  if (exportFeedback.value === 'error') return '导出失败'
  return '导出报告'
})

const headerActionFeedbackText = computed(() => {
  if (copyPending.value) return '正在复制当前页面信息'
  if (copyFeedback.value === 'success') return '当前页面信息已复制到剪贴板'
  if (copyFeedback.value === 'error') return '当前页面信息复制失败'
  if (exportFeedback.value === 'success') return '报告已开始导出'
  if (exportFeedback.value === 'error') return '报告导出失败'
  return ''
})

const processorSensorControlVisible = computed(() =>
  currentPage.value === 'computer'
  && (selectedSection.value === 'processor' || selectedSection.value === 'graphics')
  && sensorEnhancementPlatform.value !== 'unsupported'
)
const showMainHeaderActions = computed(() =>
  currentPage.value === 'computer' && Boolean(currentDevCopyTarget.value)
)

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
  syncDocumentTitle()
})

watch(
  [currentPage, hasExplicitPageRoute, selectedSection],
  async ([page, hasExplicitRoute, section]) => {
    const needsEnhancedSensors = page === 'monitor'
      || (page === 'computer' && (section === 'processor' || section === 'graphics'))
    if (!hasExplicitRoute || !needsEnhancedSensors) return
    await refreshGlobalSensorEnhancementState()
    if (sensorEnhancementPlatform.value === 'unsupported') return
    await prepareGlobalSensorEnhancement(true)
  },
  { immediate: true }
)

onMounted(() => {
  window.addEventListener('hashchange', syncHash)
  document.addEventListener('pointerdown', closeSensorMenuOnOutsidePointer)
  syncBodyMode()
  syncDocumentTitle()
})

onUnmounted(() => {
  window.removeEventListener('hashchange', syncHash)
  document.removeEventListener('pointerdown', closeSensorMenuOnOutsidePointer)
  document.body.classList.remove('watch-window-body')
  if (copyFeedbackTimerId) {
    window.clearTimeout(copyFeedbackTimerId)
    copyFeedbackTimerId = undefined
  }
  if (exportFeedbackTimerId) {
    window.clearTimeout(exportFeedbackTimerId)
    exportFeedbackTimerId = undefined
  }
})
</script>

<template>
  <div v-if="isWatchPage" class="watch-stage">
    <Watch :active="true" :initial-floating-mode="initialFloatingMode" :initial-floating-entry="initialFloatingEntry" />
  </div>

  <div v-else-if="isMonitorPage" class="monitor-dashboard-stage">
    <div class="window-titlebar standalone-titlebar">
      <div class="window-titlebar__brand standalone-titlebar__brand">
        <span class="window-titlebar__mark" aria-hidden="true">H</span>
        <span class="standalone-titlebar__text">硬件监控</span>
      </div>

      <div class="window-titlebar__drag-spacer" aria-hidden="true" />

      <div class="window-titlebar__actions standalone-titlebar__actions">
        <ThemeControl compact />
        <Bar />
      </div>
    </div>

    <main class="monitor-dashboard-standalone-content">
      <MonitoringDashboard :active="true" />
    </main>
  </div>

  <div v-else-if="isDeviceSpecsPage" class="device-specs-stage">
    <div class="window-titlebar device-specs-titlebar">
      <div class="window-titlebar__brand device-specs-titlebar__brand">
        <span class="window-titlebar__mark" aria-hidden="true">H</span>
        <span class="device-specs-titlebar__text">设备规格</span>
      </div>

      <div class="window-titlebar__drag-spacer" aria-hidden="true" />

      <div class="window-titlebar__actions standalone-titlebar__actions">
        <ThemeControl compact />
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
        <div v-if="processorSensorControlVisible" class="window-titlebar__controls">
          <div ref="sensorMenuRootRef" class="header-sensor-menu">
            <button
              ref="sensorMenuTriggerRef"
              type="button"
              :disabled="processorSensorControlDisabled"
              :aria-label="processorSensorControlAriaLabel"
              :title="processorSensorControlTitle"
              :aria-expanded="sensorMenuOpen"
              aria-controls="sensor-menu-popover"
              :class="[
                'header-sensor-trigger',
                `header-sensor-trigger--${sensorEnhancementStatus}`,
                {
                  'header-sensor-trigger--active': processorSensorControlActive,
                  'header-sensor-trigger--open': sensorMenuOpen,
                },
              ]"
              @click="toggleSensorMenu()"
              @keydown.esc.stop="closeSensorMenuAndRestoreFocus"
            >
              <span>{{ processorSensorControlLabel }}</span>
              <em>{{ processorSensorControlStatus }}</em>
              <DownOne
                class="header-sensor-trigger__chevron"
                theme="outline"
                size="12"
                fill="currentColor"
                :strokeWidth="3"
                aria-hidden="true"
              />
            </button>

            <div
              v-if="sensorMenuOpen"
              id="sensor-menu-popover"
              class="sensor-menu-popover"
              role="group"
              aria-label="硬件传感器控制"
              @keydown.esc.stop="closeSensorMenuAndRestoreFocus"
            >
              <div class="sensor-menu-popover__head">
                <span>{{ processorSensorControlLabel }}</span>
                <strong>{{ processorSensorControlStatus }}</strong>
              </div>
              <p>{{ sensorEnhancementDescription }}</p>
              <p v-if="sensorActionMessage" class="sensor-menu-popover__message" role="status" aria-live="polite">{{ sensorActionMessage }}</p>

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
                  v-if="sensorEnhancementStatus === 'error' || (sensorEnhancementPlatform === 'windows' && sensorSettings.enhancedSensorEnabled)"
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

    <aside class="sidebar">
      <nav class="sidebar-nav">
        <button
          v-for="item in primaryNavItems"
          :key="item.id"
          type="button"
          :class="['nav-item', { 'nav-item--active': selectedSection === item.id }]"
          :aria-current="selectedSection === item.id ? 'page' : undefined"
          @click="selectSection(item.id)"
        >
          <component :is="item.icon" theme="outline" size="18" fill="currentColor" :strokeWidth="3" />
          <span>{{ item.label }}</span>
        </button>
      </nav>

      <div class="sidebar-footer">
        <ThemeControl />
        <div class="sidebar-version">v1.0.0</div>
      </div>
    </aside>

    <section class="main-shell">
      <header class="main-header">
        <div class="main-header__copy">
          <h1>{{ headerMeta.title }}</h1>
          <p>{{ headerMeta.description }}</p>
          <span class="assistive-status" role="status" aria-live="polite" aria-atomic="true">已打开{{ headerMeta.title }}页面</span>
        </div>

        <div v-if="showMainHeaderActions" class="main-header__actions">
          <button
            type="button"
            :disabled="copyPending"
            :aria-busy="copyPending"
            :class="devCopyButtonClass"
            @click="copyCurrentSectionInfo()"
          >
            {{ devCopyButtonText }}
          </button>
          <button
            type="button"
            :disabled="copyPending"
            :class="exportButtonClass"
            @click="exportCurrentSectionReport()"
          >
            {{ exportButtonText }}
          </button>
          <span class="assistive-status" role="status" aria-live="polite" aria-atomic="true">{{ headerActionFeedbackText }}</span>
        </div>
      </header>

      <main class="main-content">
        <KeepAlive>
          <Computer
            v-if="selectedSection === 'overview'"
            ref="computerRef"
            :active="true"
          />
          <Processor
            v-else-if="selectedSection === 'processor'"
            ref="processorRef"
            :active="true"
          />
          <GraphicsPage
            v-else-if="selectedSection === 'graphics'"
            ref="graphicsRef"
            :active="true"
            :sensor-enhancement-enabled="sensorSettings.enhancedSensorEnabled"
            :sensor-enhancement-ready="sensorEnhancementReady"
          />
          <BoardPage
            v-else-if="selectedSection === 'board'"
            ref="boardRef"
            :active="true"
          />
          <MemoryPage
            v-else-if="selectedSection === 'memory'"
            ref="memoryRef"
            :active="true"
          />
          <StoragePage
            v-else
            ref="storageRef"
            :active="true"
          />
        </KeepAlive>
      </main>
    </section>
  </div>

  <div v-if="sensorAuthorizationPromptVisible" class="sensor-auth-overlay">
    <section
      ref="sensorAuthorizationDialogRef"
      class="sensor-auth-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sensor-auth-dialog-title"
      aria-describedby="sensor-auth-dialog-description"
      tabindex="-1"
      @keydown.tab="trapSensorAuthorizationFocus"
      @keydown.esc.stop="dismissSensorAuthorizationPrompt"
    >
      <div class="sensor-auth-dialog__head">
        <span>传感器增强</span>
        <h2 id="sensor-auth-dialog-title">启用传感器增强</h2>
      </div>
      <p id="sensor-auth-dialog-description">
        为了读取更完整的温度、频率和功耗数据，需要一次系统授权。授权后会自动启用增强模式，你也可以随时在传感器设置中关闭。
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
</template>

<style scoped lang="less">
.watch-stage {
  height: 100%;
  width: 100%;
}

.device-specs-stage,
.monitor-dashboard-stage {
  display: grid;
  grid-template-rows: 44px minmax(0, 1fr);
  height: 100%;
  width: 100%;
  background: var(--app-background);
}

.device-specs-titlebar,
.standalone-titlebar {
  grid-row: 1;
  grid-column: 1;
  min-height: 44px;
  padding: 0 10px 0 14px;
  border-bottom: 1px solid var(--panel-border);
}

.window-titlebar__brand.device-specs-titlebar__brand,
.window-titlebar__brand.standalone-titlebar__brand {
  flex: 0 0 auto;
  min-width: 112px;
  gap: 10px;
}

.device-specs-titlebar .window-titlebar__mark,
.standalone-titlebar .window-titlebar__mark {
  width: 28px;
  height: 28px;
  border-radius: 10px;
}

.device-specs-titlebar__text,
.standalone-titlebar__text {
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 800;
}

.device-specs-standalone-content,
.monitor-dashboard-standalone-content {
  grid-row: 2;
  min-width: 0;
  min-height: 0;
  padding: 14px 16px 16px;
  overflow: hidden;
}

.monitor-dashboard-standalone-content {
  padding: 16px 20px 20px;
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
  background: var(--sidebar-background);
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
  background: var(--nav-hover-background);
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
    var(--nav-active-shadow);
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
  background: var(--titlebar-background);
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
  gap: 10px;
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

.header-sensor-menu {
  display: inline-flex;
  align-items: center;
  position: relative;
  justify-content: center;
}

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

.header-sensor-trigger:hover,
.sensor-menu-action:hover {
  color: var(--control-fg-strong);
  border-color: var(--control-border-strong);
}

.header-sensor-trigger em {
  color: var(--text-subtle);
  font-style: normal;
  font-size: 12px;
  font-weight: 600;
}

.header-sensor-trigger {
  gap: 8px;
  padding: 0 14px;
  min-width: 146px;
  border-color: rgba(255, 207, 87, 0.28);
  background: linear-gradient(180deg, rgba(159, 110, 31, 0.16), var(--control-bg));
  color: var(--control-fg-strong);

}

.header-sensor-trigger__chevron {
  flex: 0 0 auto;
  display: inline-flex;
  margin-left: 2px;
  color: var(--text-subtle);
  transform: translateY(-1px);
  transition: transform 0.18s ease, color 0.18s ease;
}

.header-sensor-trigger:hover .header-sensor-trigger__chevron,
.header-sensor-trigger--open .header-sensor-trigger__chevron {
  color: var(--control-fg-strong);
}

.header-sensor-trigger--open .header-sensor-trigger__chevron {
  transform: translateY(1px) rotate(180deg);
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
  background: linear-gradient(180deg, rgba(151, 54, 45, 0.14), var(--control-bg));
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
  background: var(--surface-menu-background);
  box-shadow: var(--panel-shadow);
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
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--modal-overlay-background);
  backdrop-filter: blur(10px);
  -webkit-app-region: no-drag;
}

.sensor-auth-dialog {
  width: min(440px, 100%);
  padding: 20px;
  border: 1px solid var(--panel-border);
  border-radius: 14px;
  background: var(--surface-modal-background);
  box-shadow: var(--panel-shadow);

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
  background: var(--control-bg-soft);
  color: var(--text-muted);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease;
}

.debug-button:not(:disabled):hover {
  background: var(--button-hover-bg);
  border-color: rgba(108, 130, 166, 0.58);
  color: var(--text-primary);
}

.debug-button:disabled,
.export-button:disabled {
  cursor: not-allowed;
  opacity: 0.56;
}

.debug-button--success {
  border-color: rgba(89, 201, 118, 0.54);
  color: var(--button-feedback-success);
}

.debug-button--error {
  border-color: rgba(255, 126, 107, 0.56);
  color: var(--button-feedback-error);
}

.export-button:not(:disabled):hover {
  background: var(--button-hover-bg);
  border-color: var(--button-hover-border);
}

.export-button--success {
  border-color: rgba(89, 201, 118, 0.54);
  color: var(--button-feedback-success);
}

.export-button--error {
  border-color: rgba(255, 126, 107, 0.56);
  color: var(--button-feedback-error);
}

.assistive-status {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
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
