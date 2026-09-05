<script setup lang="ts">
import {
  Cpu,
  DashboardOne,
  HardDisk,
  Memory,
  NetworkTree,
  Speed,
  Thermometer,
} from '@icon-park/vue-next'
import { computed, onMounted, ref } from 'vue'
import { getSensorEnhancementPlatform, type SensorEnhancementPlatform } from '../../utils/platform'

withDefaults(defineProps<{
  active?: boolean
}>(), {
  active: true,
})

type MetricKey = keyof MacMenubarMetricSettingsData

interface MetricDefinition {
  key: MetricKey
  label: string
  description: string
  icon: unknown
}

const metricDefinitions: MetricDefinition[] = [
  { key: 'cpuTemperature', label: 'CPU 温度', description: '在菜单栏显示处理器温度', icon: Thermometer },
  { key: 'cpuLoad', label: 'CPU 负载', description: '在菜单栏显示处理器实时负载', icon: Cpu },
  { key: 'cpuFrequency', label: 'CPU 频率', description: '在菜单栏显示当前处理器频率', icon: Speed },
  { key: 'fanSpeed', label: '风扇转速', description: '在菜单栏显示 CPU 风扇转速', icon: DashboardOne },
  { key: 'memoryUsage', label: '内存使用率', description: '在菜单栏显示已使用内存百分比', icon: Memory },
  { key: 'diskIo', label: '磁盘 IO', description: '在菜单栏同时显示磁盘读取和写入速度', icon: HardDisk },
  { key: 'networkIo', label: '网络 IO', description: '在菜单栏同时显示网络下行和上行速度', icon: NetworkTree },
]

const defaultSettings: MacMenubarSettingsData = {
  enabled: false,
  showTemp: true,
  showLoad: true,
  showIcon: true,
  metrics: {
    cpuTemperature: true,
    cpuLoad: true,
    cpuFrequency: false,
    fanSpeed: false,
    memoryUsage: false,
    diskIo: false,
    networkIo: false,
  },
}

const settings = ref<MacMenubarSettingsData>(defaultSettings)
const loading = ref(true)
const saving = ref(false)
const loadError = ref('')
const saveError = ref('')
const platform = ref<SensorEnhancementPlatform>('unsupported')

const isMacOS = computed(() => platform.value === 'macos')
const enabledMetricCount = computed(() => metricDefinitions.filter((item) => settings.value.metrics[item.key]).length)
const selectedMetricLabels = computed(() => metricDefinitions
  .filter((item) => settings.value.metrics[item.key])
  .map((item) => item.label))

function normalizeSettings(value?: Partial<MacMenubarSettingsData> | null): MacMenubarSettingsData {
  const sourceMetrics = value?.metrics || {}
  const metrics = {
    ...defaultSettings.metrics,
    ...sourceMetrics,
  }

  return {
    ...defaultSettings,
    ...value,
    showTemp: metrics.cpuTemperature,
    showLoad: metrics.cpuLoad,
    metrics,
  }
}

async function loadSettings() {
  loading.value = true
  loadError.value = ''
  try {
    const [osInfo, storedSettings] = await Promise.all([
      window.services.getOsInfo(),
      window.services.getMacMenubarSettings(),
    ])
    platform.value = getSensorEnhancementPlatform(osInfo)
    settings.value = normalizeSettings(storedSettings)
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '读取菜单栏设置失败'
  } finally {
    loading.value = false
  }
}

async function applySettings(patch: MacMenubarSettingsPatch) {
  if (saving.value) return

  saving.value = true
  saveError.value = ''
  try {
    const next = await window.services.updateMacMenubarSettings(patch)
    settings.value = normalizeSettings(next)
    if (settings.value.enabled && isMacOS.value && enabledMetricCount.value > 0) {
      void window.services.refreshMacMenubarTelemetry()
    }
  } catch (error) {
    saveError.value = error instanceof Error ? error.message : '保存菜单栏设置失败'
  } finally {
    saving.value = false
  }
}

function toggleEnabled() {
  void applySettings({ enabled: !settings.value.enabled })
}

function toggleIcon() {
  void applySettings({ showIcon: !settings.value.showIcon })
}

function toggleMetric(key: MetricKey) {
  const metrics: Partial<MacMenubarMetricSettingsData> = {
    [key]: !settings.value.metrics[key],
  }
  void applySettings({ metrics })
}

onMounted(async () => {
  await loadSettings()
  if (settings.value.enabled && isMacOS.value && enabledMetricCount.value > 0) {
    void window.services.refreshMacMenubarTelemetry()
  }
})
</script>

<template>
  <section class="menubar-settings" aria-labelledby="menubar-settings-title">
    <header class="menubar-settings__intro">
      <div class="menubar-settings__intro-icon" aria-hidden="true">
        <Cpu theme="outline" size="24" fill="currentColor" :strokeWidth="3" />
      </div>
      <div>
        <p class="menubar-settings__eyebrow">HWInfoX · macOS</p>
        <h1 id="menubar-settings-title">菜单栏显示设置</h1>
        <p>每个指标都会独立出现在 macOS 顶部菜单栏，可按需组合。</p>
      </div>
    </header>

    <div v-if="loading" class="menubar-settings__state" role="status" aria-live="polite">
      <span class="menubar-settings__spinner" aria-hidden="true" />
      正在读取菜单栏设置…
    </div>

    <div v-else-if="loadError" class="menubar-settings__state menubar-settings__state--error" role="alert">
      <strong>设置读取失败</strong>
      <span>{{ loadError }}</span>
      <button type="button" class="menubar-settings__retry" @click="loadSettings">重试</button>
    </div>

    <div v-else-if="!isMacOS" class="menubar-settings__state" role="status">
      <strong>当前平台不支持 macOS 菜单栏 helper</strong>
      <span>这组设置只会在 macOS 上启动菜单栏监控。</span>
    </div>

    <template v-else>
      <section class="menubar-settings__panel menubar-settings__master-panel">
        <div class="menubar-settings__panel-copy">
          <span class="menubar-settings__panel-label">菜单栏监控</span>
          <strong>{{ settings.enabled ? '已启用' : '已关闭' }}</strong>
          <p>启用后，选中的指标会立即创建为独立菜单栏项目。</p>
        </div>
        <button
          type="button"
          class="menubar-settings__switch"
          role="switch"
          :aria-checked="settings.enabled"
          :disabled="saving"
          @click="toggleEnabled"
        >
          <span class="menubar-settings__switch-track"><span /></span>
          <span>{{ settings.enabled ? '开启' : '关闭' }}</span>
        </button>
      </section>

      <section class="menubar-settings__panel">
        <div class="menubar-settings__section-heading">
          <div>
            <span class="menubar-settings__panel-label">显示选项</span>
            <p>图标使用 macOS 原生 SF Symbol，自动适配深浅色模式。</p>
          </div>
        </div>
        <button
          type="button"
          class="menubar-settings__option-row"
          role="switch"
          :aria-checked="settings.showIcon"
          :disabled="saving"
          @click="toggleIcon"
        >
          <span>
            <strong>显示指标图标</strong>
            <small>关闭后保留数值文字，只隐藏每个项目左侧图标</small>
          </span>
          <span :class="['menubar-settings__switch', { 'menubar-settings__switch--active': settings.showIcon }]">
            <span class="menubar-settings__switch-track"><span /></span>
            <em>{{ settings.showIcon ? '开启' : '关闭' }}</em>
          </span>
        </button>
      </section>

      <section class="menubar-settings__panel">
        <div class="menubar-settings__section-heading">
          <div>
            <span class="menubar-settings__panel-label">独立指标</span>
            <strong>{{ enabledMetricCount }} / {{ metricDefinitions.length }} 项已选择</strong>
            <p>每一项都会生成一个独立的菜单栏 status item。</p>
          </div>
        </div>

        <div class="menubar-settings__metric-list">
          <button
            v-for="item in metricDefinitions"
            :key="item.key"
            type="button"
            class="menubar-settings__metric-row"
            :aria-pressed="settings.metrics[item.key]"
            :disabled="saving"
            @click="toggleMetric(item.key)"
          >
            <span class="menubar-settings__metric-icon" aria-hidden="true">
              <component :is="item.icon" theme="outline" size="20" fill="currentColor" :strokeWidth="3" />
            </span>
            <span class="menubar-settings__metric-copy">
              <strong>{{ item.label }}</strong>
              <small>{{ item.description }}</small>
            </span>
            <span :class="['menubar-settings__check', { 'menubar-settings__check--active': settings.metrics[item.key] }]" aria-hidden="true">
              <span />
            </span>
          </button>
        </div>
      </section>

      <section class="menubar-settings__preview" aria-live="polite">
        <div class="menubar-settings__preview-heading">
          <span>当前菜单栏预览</span>
          <small>{{ settings.enabled ? '实时生效' : '启用总开关后生效' }}</small>
        </div>
        <div v-if="selectedMetricLabels.length" class="menubar-settings__preview-items">
          <span v-for="label in selectedMetricLabels" :key="label">{{ label }}</span>
        </div>
        <p v-else>尚未选择指标。开启总开关前，请至少选择一项。</p>
      </section>

      <p v-if="saveError" class="menubar-settings__error" role="alert">{{ saveError }}</p>
    </template>
  </section>
</template>

<style scoped lang="less">
.menubar-settings {
  width: min(100%, 760px);
  margin: 0 auto;
  color: var(--text-primary);
}

.menubar-settings__intro {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 18px;
}

.menubar-settings__intro-icon {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 52px;
  height: 52px;
  border: 1px solid var(--control-border-strong);
  border-radius: 16px;
  background: var(--control-active-bg);
  color: var(--accent-blue);
  box-shadow: var(--brand-shadow);
}

.menubar-settings__eyebrow,
.menubar-settings__intro h1,
.menubar-settings__intro p {
  margin: 0;
}

.menubar-settings__eyebrow {
  color: var(--accent-blue);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.menubar-settings__intro h1 {
  margin-top: 4px;
  font-size: 24px;
  letter-spacing: -0.03em;
}

.menubar-settings__intro p:last-child {
  margin-top: 5px;
  color: var(--text-muted);
  font-size: 13px;
}

.menubar-settings__panel,
.menubar-settings__preview,
.menubar-settings__state {
  border: 1px solid var(--panel-border);
  border-radius: var(--surface-radius);
  background: var(--surface-card-background);
  box-shadow: var(--panel-shadow);
}

.menubar-settings__panel {
  padding: 18px;
}

.menubar-settings__panel + .menubar-settings__panel,
.menubar-settings__preview {
  margin-top: 12px;
}

.menubar-settings__master-panel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-color: var(--control-border-strong);
  background: var(--control-active-bg);
}

.menubar-settings__panel-copy,
.menubar-settings__section-heading {
  min-width: 0;
}

.menubar-settings__panel-label {
  display: block;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.menubar-settings__panel-copy strong,
.menubar-settings__section-heading strong {
  display: block;
  margin-top: 5px;
  font-size: 16px;
}

.menubar-settings__panel-copy p,
.menubar-settings__section-heading p {
  margin: 5px 0 0;
  color: var(--text-subtle);
  font-size: 12px;
  line-height: 1.5;
}

.menubar-settings__switch,
.menubar-settings__check {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 8px;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 800;
}

.menubar-settings__switch-track {
  display: inline-flex;
  align-items: center;
  width: 42px;
  height: 24px;
  padding: 3px;
  border-radius: 999px;
  background: var(--control-bg-soft);
  box-shadow: inset 0 0 0 1px var(--control-border);
  transition: background 0.16s ease, box-shadow 0.16s ease;
}

.menubar-settings__switch-track span {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--text-subtle);
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.18);
  transition: transform 0.16s ease, background 0.16s ease;
}

.menubar-settings__switch[aria-checked='true'] .menubar-settings__switch-track,
.menubar-settings__switch--active .menubar-settings__switch-track {
  background: var(--control-active-bg);
  box-shadow: inset 0 0 0 1px var(--control-border-strong);
}

.menubar-settings__switch[aria-checked='true'] .menubar-settings__switch-track span,
.menubar-settings__switch--active .menubar-settings__switch-track span {
  transform: translateX(18px);
  background: var(--accent-blue);
}

.menubar-settings__switch em {
  min-width: 28px;
  color: var(--text-subtle);
  font-style: normal;
  text-align: right;
}

.menubar-settings__section-heading {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.menubar-settings__option-row,
.menubar-settings__metric-row {
  display: flex;
  align-items: center;
  width: 100%;
  border: 1px solid var(--panel-border-soft);
  border-radius: 12px;
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.16s ease, border-color 0.16s ease, transform 0.16s ease;
}

.menubar-settings__option-row {
  justify-content: space-between;
  gap: 12px;
  min-height: 58px;
  padding: 10px 12px;
  background: var(--surface-soft-background);
}

.menubar-settings__option-row:hover,
.menubar-settings__metric-row:hover {
  border-color: var(--control-border-strong);
  background: var(--surface-hover-background);
}

.menubar-settings__option-row:disabled,
.menubar-settings__metric-row:disabled,
.menubar-settings__switch:disabled {
  cursor: wait;
  opacity: 0.62;
}

.menubar-settings__option-row strong,
.menubar-settings__option-row small {
  display: block;
}

.menubar-settings__option-row strong {
  font-size: 13px;
}

.menubar-settings__option-row small {
  margin-top: 3px;
  color: var(--text-subtle);
  font-size: 11px;
}

.menubar-settings__metric-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.menubar-settings__metric-row {
  gap: 10px;
  min-height: 68px;
  padding: 10px;
  background: var(--surface-softer-background);
}

.menubar-settings__metric-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: var(--surface-icon-background);
  color: var(--accent-cyan);
}

.menubar-settings__metric-copy {
  min-width: 0;
  flex: 1;
}

.menubar-settings__metric-copy strong,
.menubar-settings__metric-copy small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.menubar-settings__metric-copy strong {
  font-size: 13px;
}

.menubar-settings__metric-copy small {
  margin-top: 3px;
  color: var(--text-subtle);
  font-size: 11px;
}

.menubar-settings__check {
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 1px solid var(--control-border);
  border-radius: 7px;
  background: var(--control-bg-soft);
}

.menubar-settings__check span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: transparent;
  transition: background 0.16s ease, transform 0.16s ease;
}

.menubar-settings__check--active {
  border-color: var(--control-border-strong);
  background: var(--control-active-bg);
}

.menubar-settings__check--active span {
  background: var(--accent-blue);
  transform: scale(1.1);
}

.menubar-settings__preview {
  padding: 14px 16px;
  background: var(--surface-detail-background);
}

.menubar-settings__preview-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 800;
}

.menubar-settings__preview-heading small {
  color: var(--text-subtle);
  font-size: 10px;
  font-weight: 700;
}

.menubar-settings__preview-items {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.menubar-settings__preview-items span {
  padding: 5px 9px;
  border: 1px solid var(--control-border);
  border-radius: 999px;
  background: var(--control-bg-soft);
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
}

.menubar-settings__preview p,
.menubar-settings__error {
  margin: 10px 0 0;
  color: var(--text-subtle);
  font-size: 12px;
}

.menubar-settings__error {
  color: var(--accent-danger);
}

.menubar-settings__state {
  display: grid;
  justify-items: center;
  gap: 8px;
  min-height: 200px;
  padding: 32px;
  color: var(--text-muted);
  font-size: 13px;
  text-align: center;
}

.menubar-settings__state strong {
  color: var(--text-primary);
  font-size: 15px;
}

.menubar-settings__state--error {
  color: var(--accent-danger);
}

.menubar-settings__retry {
  min-height: var(--control-height);
  padding: 0 14px;
  border: 1px solid var(--button-primary-border);
  border-radius: var(--control-radius);
  background: var(--button-primary-bg);
  color: var(--button-primary-fg);
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.menubar-settings__spinner {
  width: 24px;
  height: 24px;
  border: 2px solid color-mix(in srgb, var(--accent-blue) 20%, transparent);
  border-top-color: var(--accent-blue);
  border-radius: 50%;
  animation: menubar-settings-spin 0.8s linear infinite;
}

@keyframes menubar-settings-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 680px) {
  .menubar-settings__metric-list {
    grid-template-columns: 1fr;
  }

  .menubar-settings__master-panel {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
