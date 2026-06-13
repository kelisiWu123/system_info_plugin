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

type PageName = 'computer' | 'watch'

interface SidebarItem {
  id: string
  label: string
  icon: unknown
  page?: PageName
}

interface CopyablePageHandle {
  copyOverviewInfo?: () => Promise<boolean>
  copyProcessorInfo?: () => Promise<boolean>
  copyGraphicsInfo?: () => Promise<boolean>
  copyBoardInfo?: () => Promise<boolean>
  copyMemoryInfo?: () => Promise<boolean>
  copyStorageInfo?: () => Promise<boolean>
}

const currentHash = ref(window.location.hash)
const selectedSection = ref('overview')
const isDev = import.meta.env.DEV
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

const secondaryNavItems: SidebarItem[] = []

function syncHash() {
  currentHash.value = window.location.hash
}

function resolvePage(hash: string): PageName {
  const page = hash.replace(/^#\/?/, '')
  return page === 'watch' ? 'watch' : 'computer'
}

const currentPage = computed<PageName>(() => resolvePage(currentHash.value))
const isWatchPage = computed(() => currentPage.value === 'watch')
const currentDevCopyTarget = computed(() => resolveDevPageCopyTarget(selectedSection.value))
const isOverviewSection = computed(() => currentPage.value === 'computer' && selectedSection.value === 'overview')
const overviewRefreshSettings = overviewHardwareStore.monitoringRefreshSettings
const overviewBackgroundThrottled = overviewHardwareStore.backgroundThrottled
const refreshSettingsPending = ref(false)

const refreshProfiles = [
  { id: 'eco', label: '省电' },
  { id: 'balanced', label: '平衡' },
  { id: 'realtime', label: '实时' },
] as const

function syncBodyMode() {
  document.body.classList.toggle('watch-window-body', isWatchPage.value)
}

function selectSection(id: string) {
  selectedSection.value = id

  if (id === 'watch') {
    window.location.hash = 'watch'
    return
  }

  if (currentPage.value !== 'computer') {
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

  const navLabel = primaryNavItems.find((item) => item.id === selectedSection.value)?.label || secondaryNavItems.find((item) => item.id === selectedSection.value)?.label

  if (selectedSection.value !== 'overview') {
    return {
      title: navLabel || '模块开发中',
      description: '该页面正在开发中，后续会按相同设计语言继续补齐。',
    }
  }

  return {
    title: '系统概览',
    description: '快速了解你的电脑硬件配置',
  }
})

watch(currentPage, (page) => {
  if (page === 'computer' && selectedSection.value === 'watch') {
    selectedSection.value = 'overview'
  }
  syncBodyMode()
})

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
    <Watch :active="true" />
  </div>

  <div v-else class="desktop-shell">
    <aside class="sidebar">
      <div class="sidebar-brand">
        <div class="sidebar-brand__mark">H</div>
        <div class="sidebar-brand__text">
          <strong>HWInfoX</strong>
          <span>Hardware Overview</span>
        </div>
      </div>

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
        <button
          v-for="item in secondaryNavItems"
          :key="item.id"
          type="button"
          :class="['nav-item', 'nav-item--secondary', { 'nav-item--active': selectedSection === item.id || (item.id === 'watch' && currentPage === 'watch') }]"
          @click="selectSection(item.id)"
        >
          <component :is="item.icon" theme="outline" size="18" fill="currentColor" :strokeWidth="3" />
          <span>{{ item.label }}</span>
        </button>
        <div class="sidebar-version">v1.0.0</div>
      </div>
    </aside>

    <section class="main-shell">
      <div class="window-titlebar">
        <div class="window-titlebar__brand">
          <span class="window-titlebar__mark" aria-hidden="true" />
          <span>HWInfoX</span>
        </div>

        <div class="window-titlebar__actions">
          <Bar />
        </div>
      </div>

      <header class="main-header">
        <div class="main-header__copy">
          <h1>{{ headerMeta.title }}</h1>
          <p>{{ headerMeta.description }}</p>
        </div>

        <div v-if="isOverviewSection || (isDev && currentPage === 'computer' && currentDevCopyTarget)" class="main-header__actions">
          <div v-if="isOverviewSection" class="header-refresh-group">
            <div class="header-refresh-chips">
              <button
                v-for="profile in refreshProfiles"
                :key="profile.id"
                type="button"
                :disabled="refreshSettingsPending"
                :class="['header-chip', { 'header-chip--active': overviewRefreshSettings.profile === profile.id }]"
                @click="applyOverviewRefreshProfile(profile.id)"
              >
                {{ profile.label }}
              </button>
            </div>

            <button
              type="button"
              :disabled="refreshSettingsPending"
              :class="['header-toggle', { 'header-toggle--active': overviewRefreshSettings.backgroundThrottleEnabled }]"
              @click="toggleOverviewBackgroundThrottle()"
            >
              后台降频
              <em>{{ overviewBackgroundThrottled ? '生效中' : overviewRefreshSettings.backgroundThrottleEnabled ? '已开启' : '已关闭' }}</em>
            </button>
          </div>

          <button
            v-if="isDev && currentPage === 'computer' && currentDevCopyTarget"
            type="button"
            :disabled="copyPending"
            :class="devCopyButtonClass"
            @click="copyCurrentSectionInfo()"
          >
            {{ devCopyButtonText }}
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
        <section v-if="selectedSection !== 'overview' && selectedSection !== 'processor' && selectedSection !== 'graphics' && selectedSection !== 'board' && selectedSection !== 'memory' && selectedSection !== 'storage'" class="placeholder-panel">
          <div class="placeholder-panel__body">
            <h2>{{ headerMeta.title }}</h2>
            <p>{{ headerMeta.description }}</p>
          </div>
        </section>
      </main>
    </section>
  </div>
</template>

<style scoped lang="less">
.watch-stage {
  height: 100%;
  width: 100%;
}

.desktop-shell {
  display: grid;
  grid-template-columns: 176px minmax(0, 1fr);
  height: 100%;
  width: 100%;
  background: var(--app-background);
}

.sidebar {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 22px 14px 18px;
  border-right: 1px solid var(--panel-border);
  background: linear-gradient(180deg, rgba(18, 25, 36, 0.98), rgba(13, 20, 30, 0.98));
}

.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 10px 14px;
}

.sidebar-brand__mark {
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

.sidebar-brand__text {
  display: flex;
  flex-direction: column;
  gap: 3px;

  strong {
    color: var(--brand-fg);
    font-size: 18px;
    font-weight: 700;
  }

  span {
    color: var(--text-muted);
    font-size: 11px;
    letter-spacing: 0.04em;
  }
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
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: 12px 30px 24px;
}

.window-titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 42px;
  margin-bottom: 14px;
  padding: 6px 12px 8px 14px;
  border: 1px solid var(--frame-border);
  border-radius: var(--surface-radius);
  background:
    radial-gradient(circle at top left, rgba(53, 119, 255, 0.12), transparent 32%),
    linear-gradient(180deg, rgba(21, 31, 44, 0.88), rgba(17, 25, 35, 0.82));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.04),
    0 12px 24px rgba(3, 8, 15, 0.12);
  backdrop-filter: blur(20px);
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
  gap: 9px;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.window-titlebar__mark {
  display: inline-flex;
  width: 20px;
  height: 20px;
  border-radius: 8px;
  background: linear-gradient(180deg, rgba(95, 149, 255, 0.92), rgba(56, 103, 255, 0.76));
  box-shadow: 0 10px 20px rgba(48, 92, 255, 0.24);
}

.window-titlebar__actions {
  display: flex;
  align-items: center;
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

.header-chip,
.header-toggle {
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
.header-toggle:hover {
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

.header-toggle em {
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

.placeholder-panel {
  display: grid;
  place-items: center;
  height: 100%;
  min-height: 0;
  border: 1px solid var(--panel-border);
  border-radius: var(--surface-radius);
  background: linear-gradient(180deg, rgba(19, 28, 40, 0.94), rgba(16, 24, 35, 0.96));
  box-shadow: var(--panel-shadow);
}

.placeholder-panel__body {
  max-width: 420px;
  text-align: center;

  h2 {
    margin: 0;
    color: var(--text-primary);
    font-size: 22px;
  }

  p {
    margin: 10px 0 0;
    color: var(--text-muted);
    font-size: 14px;
    line-height: 1.6;
  }
}

@media (max-width: 1120px) {
  .desktop-shell {
    grid-template-columns: 148px minmax(0, 1fr);
  }

  .main-shell {
    padding: 10px 22px 20px;
  }

  .nav-item span {
    font-size: 14px;
  }
}

@media (max-width: 760px) {
  .main-shell {
    padding: 10px 18px 18px;
  }

  .window-titlebar {
    min-height: 40px;
    margin-bottom: 12px;
    padding: 6px 10px 7px 12px;
    border-radius: 14px;
  }

  .main-header__copy {
    padding-left: 14px;
  }
}
</style>
