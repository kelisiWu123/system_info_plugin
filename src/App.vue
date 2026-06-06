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

type PageName = 'computer' | 'watch'

interface SidebarItem {
  id: string
  label: string
  icon: unknown
  page?: PageName
}

const currentHash = ref(window.location.hash)
const selectedSection = ref('overview')

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
      </header>

      <main class="main-content">
        <Computer v-show="selectedSection === 'overview'" :active="selectedSection === 'overview'" />
        <Processor v-show="selectedSection === 'processor'" :active="selectedSection === 'processor'" />
        <GraphicsPage v-show="selectedSection === 'graphics'" :active="selectedSection === 'graphics'" />
        <BoardPage v-show="selectedSection === 'board'" :active="selectedSection === 'board'" />
        <MemoryPage v-show="selectedSection === 'memory'" :active="selectedSection === 'memory'" />
        <StoragePage v-show="selectedSection === 'storage'" :active="selectedSection === 'storage'" />
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
  background: linear-gradient(180deg, rgba(68, 150, 255, 0.88), rgba(40, 108, 255, 0.68));
  color: #f5f8ff;
  font-size: 15px;
  font-weight: 800;
  box-shadow: 0 8px 20px rgba(46, 105, 255, 0.24);
}

.sidebar-brand__text {
  display: flex;
  flex-direction: column;
  gap: 3px;

  strong {
    color: #f4f7fd;
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
  border-radius: 14px;
  color: var(--text-muted);
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease, transform 0.18s ease;
}

.nav-item:hover {
  background: rgba(255, 255, 255, 0.03);
  color: #ebf1fb;
}

.nav-item--secondary {
  min-height: 44px;
}

.nav-item--active {
  background: linear-gradient(180deg, rgba(28, 39, 55, 0.98), rgba(24, 35, 49, 0.98));
  border-color: rgba(67, 133, 255, 0.22);
  color: #f6f9ff;
  box-shadow:
    inset 3px 0 0 #42a3ff,
    0 10px 24px rgba(4, 10, 18, 0.24);
}

.nav-item span {
  font-size: 15px;
  font-weight: 600;
}

.sidebar-version {
  padding: 10px 14px 0;
  color: rgba(167, 179, 198, 0.72);
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
  border: 1px solid rgba(126, 153, 197, 0.24);
  border-radius: 16px;
  background:
    radial-gradient(circle at top left, rgba(53, 119, 255, 0.12), transparent 32%),
    linear-gradient(180deg, rgba(24, 38, 66, 0.78), rgba(15, 24, 41, 0.72));
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
  color: rgba(236, 242, 251, 0.94);
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
    color: #f7f9fd;
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
  min-height: 44px;
  padding: 0 18px;
  border: 1px solid var(--panel-border);
  border-radius: 12px;
  background: rgba(20, 29, 42, 0.86);
  color: #e8edf8;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease;
}

.primary-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 18px;
  border: 1px solid rgba(66, 163, 255, 0.52);
  border-radius: 12px;
  background: linear-gradient(180deg, rgba(18, 84, 161, 0.44), rgba(12, 54, 106, 0.46));
  color: #eaf5ff;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease;
}

.primary-button:hover {
  background: linear-gradient(180deg, rgba(25, 103, 192, 0.5), rgba(14, 63, 122, 0.58));
  border-color: rgba(90, 186, 255, 0.62);
}

.debug-button {
  min-height: 44px;
  padding: 0 16px;
  border: 1px dashed rgba(92, 112, 144, 0.48);
  border-radius: 12px;
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
  color: #edf3ff;
}

.debug-button--success {
  border-color: rgba(89, 201, 118, 0.54);
  color: #b8f3c8;
}

.debug-button--error {
  border-color: rgba(255, 126, 107, 0.56);
  color: #ffb1a5;
}

.export-button:hover {
  background: rgba(28, 39, 55, 0.96);
  border-color: rgba(92, 112, 144, 0.42);
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
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(19, 28, 40, 0.94), rgba(16, 24, 35, 0.96));
  box-shadow: var(--panel-shadow);
}

.placeholder-panel__body {
  max-width: 420px;
  text-align: center;

  h2 {
    margin: 0;
    color: #f5f7fb;
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
