<script setup lang="ts">
import { CloseSmall, Pushpin } from '@icon-park/vue-next'
import { computed } from 'vue'

export interface CoreRow {
  id: string
  index: number
  shortLabel: string
  type: 'P-Core' | 'E-Core' | 'Core'
  speed: number | null
  load: number | null
  temperature: number | null
}

const props = defineProps<{
  coreRows: CoreRow[]
  avgSpeedGhz: number | null
  totalLoadPercent: number | null
  packageTemp: number | null
  cpuBrand: string
  hybridCounts: { performance: number; efficiency: number; total: number }
  loading?: boolean
  pinned: boolean
}>()

const emit = defineEmits<{
  (event: 'toggle-pin'): void
  (event: 'switch-standard'): void
  (event: 'switch-game'): void
  (event: 'close-window'): void
}>()

/* 频率档位：决定核心内部图形的形态与色彩 */
type FrequencyTier = 'idle' | 'base' | 'boost' | 'turbo'

function getFrequencyTier(speed: number | null): FrequencyTier {
  if (speed === null || speed <= 0) return 'idle'
  if (speed < 2.4) return 'idle'
  if (speed < 3.6) return 'base'
  if (speed < 4.4) return 'boost'
  return 'turbo'
}

/* 温度档位：决定核心外框色彩与热力光晕 */
type TemperatureTier = 'cool' | 'normal' | 'warm' | 'hot'

function getTemperatureTier(temp: number | null): TemperatureTier {
  if (temp === null) return 'normal'
  if (temp < 52) return 'cool'
  if (temp < 70) return 'normal'
  if (temp < 82) return 'warm'
  return 'hot'
}

/* 负载色阶：决定底部指示条颜色 */
function getLoadColor(load: number | null): string {
  if (load === null) return '#64748b'
  if (load >= 85) return '#f87171' // 危险红
  if (load >= 60) return '#fbbf24' // 警戒黄
  return '#34d399' // 正常绿
}

function getTempTextColor(temp: number | null): string {
  if (temp === null) return 'var(--text-watch, #e2e8f0)'
  if (temp >= 82) return '#ff6f75'
  if (temp >= 70) return '#fbbf24'
  if (temp < 52) return '#38bdf8'
  return '#34d399'
}

const overallStatus = computed(() => {
  const load = props.totalLoadPercent
  const temp = props.packageTemp

  if (load === null && temp === null && !props.coreRows.length) {
    return { level: 'normal', label: props.loading ? '正在同步…' : '核心监控' }
  }

  if ((load !== null && load >= 85) || (temp !== null && temp >= 85)) {
    return { level: 'danger', label: temp !== null && temp >= 85 ? '核心过热' : '高负载运行' }
  }

  if ((load !== null && load >= 60) || (temp !== null && temp >= 72)) {
    return { level: 'warning', label: temp !== null && temp >= 72 ? '温度较高' : '负载较高' }
  }

  return { level: 'normal', label: '核心运行良好' }
})

const peakSpeedGhz = computed(() => {
  const speeds = props.coreRows
    .map((r) => r.speed)
    .filter((s): s is number => typeof s === 'number' && s > 0)
  return speeds.length ? Math.round(Math.max(...speeds) * 100) / 100 : null
})

const columnCount = computed(() => {
  const count = props.coreRows.length
  if (count <= 4) return 2
  if (count <= 16) return 4
  return 6
})

function formatCoreTooltip(row: CoreRow): string {
  const typeName = row.type === 'P-Core' ? '性能核' : row.type === 'E-Core' ? '能效核' : '核心'

  const freqTier = getFrequencyTier(row.speed)
  const freqDescMap: Record<FrequencyTier, string> = {
    idle: '待机节能 · 灰',
    base: '标准主频 · 蓝',
    boost: '睿频加速 · 紫',
    turbo: '极速冲频 · 金',
  }
  const speedText = row.speed !== null
    ? `${row.speed.toFixed(2)} GHz (${freqDescMap[freqTier]})`
    : '--'

  const tempTier = getTemperatureTier(row.temperature)
  const tempDescMap: Record<TemperatureTier, string> = {
    cool: '清凉 · 蓝框',
    normal: '温和 · 绿框',
    warm: '偏热 · 橙框',
    hot: '炽热 · 红框',
  }
  const tempText = row.temperature !== null
    ? `${Math.round(row.temperature)}°C (${tempDescMap[tempTier]})`
    : '--'

  const loadText = row.load !== null ? `${Math.round(row.load)}%` : '--'

  return `${typeName} ${row.index} (${row.shortLabel})\n• 频率：${speedText}\n• 温度：${tempText}\n• 负载：${loadText} (底部动态条)`
}

const footerLeftText = computed(() => {
  const total = props.coreRows.length
  if (!total) return '未检测到核心'
  const p = props.hybridCounts.performance
  const e = props.hybridCounts.efficiency
  if (p && e && total === p + e) {
    return `${p}P + ${e}E (${total}核)`
  }
  return `${total} 核心`
})

const footerRightText = computed(() => {
  if (peakSpeedGhz.value) {
    return `峰值 ${peakSpeedGhz.value.toFixed(2)} GHz`
  }
  if (props.avgSpeedGhz) {
    return `均频 ${props.avgSpeedGhz.toFixed(2)} GHz`
  }
  return props.packageTemp !== null ? `封装 ${props.packageTemp}°C` : '--'
})
</script>

<template>
  <section class="super-lite-monitor super-lite-cpu-cores">
    <!-- 头部：状态与操作按钮 -->
    <header class="super-lite-header">
      <div class="super-lite-status" aria-live="polite">
        <span :class="['super-lite-dot', `super-lite-dot--${overallStatus.level}`]" />
        <span class="super-lite-status__text">{{ overallStatus.label }}</span>
      </div>

      <div class="super-lite-actions">
        <button
          type="button"
          class="super-lite-mode-switch"
          title="切回标准模式"
          aria-label="切回标准模式"
          @click="emit('switch-standard')"
        >
          标准
        </button>
        <button
          type="button"
          class="super-lite-mode-switch"
          title="切换到游戏模式 (横条浮窗)"
          aria-label="切换到游戏模式"
          @click="emit('switch-game')"
        >
          游戏
        </button>
        <button
          type="button"
          class="super-lite-pin"
          :aria-pressed="pinned"
          :title="pinned ? '取消固定窗口' : '固定窗口'"
          :aria-label="pinned ? '取消固定窗口' : '固定窗口'"
          @click="emit('toggle-pin')"
        >
          <Pushpin theme="outline" size="13" fill="currentColor" :strokeWidth="3" />
        </button>
        <button
          type="button"
          class="super-lite-close"
          title="关闭窗口"
          aria-label="关闭窗口"
          @click="emit('close-window')"
        >
          <CloseSmall theme="outline" size="14" fill="currentColor" :strokeWidth="3" />
        </button>
      </div>
    </header>

    <!-- 顶部大盘摘要行：整颗 CPU 整体负载、封装温度与平均频率（清晰大字，不再遮挡） -->
    <div class="super-lite-summary-row" aria-label="CPU 整体概况">
      <div class="summary-left">
        <strong class="summary-tag">CPU</strong>
        <span class="summary-load">
          {{ totalLoadPercent !== null ? `${totalLoadPercent}%` : '--' }}
        </span>
        <span class="summary-bar" aria-hidden="true">
          <i
            :style="{
              width: `${Math.min(100, Math.max(0, totalLoadPercent || 0))}%`,
              backgroundColor: getLoadColor(totalLoadPercent),
            }"
          />
        </span>
      </div>
      <div class="summary-right">
        <span class="summary-temp" :style="{ color: getTempTextColor(packageTemp) }">
          {{ packageTemp !== null ? `${packageTemp}°C` : '--' }}
        </span>
        <span class="summary-freq">
          {{ avgSpeedGhz !== null ? `${avgSpeedGhz.toFixed(2)}G` : '--' }}
        </span>
      </div>
    </div>

    <!-- 主体：图形化核心芯片矩阵（去除微型挤压文字，使用形态+色彩表达频率与温度） -->
    <main class="super-lite-cores-body">
      <div
        v-if="coreRows.length"
        class="cores-micro-grid"
        :style="{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }"
      >
        <article
          v-for="row in coreRows"
          :key="row.id"
          :class="[
            'micro-chip',
            row.type === 'P-Core' ? 'micro-chip--p' : row.type === 'E-Core' ? 'micro-chip--e' : '',
            `temp-border--${getTemperatureTier(row.temperature)}`,
          ]"
          :title="formatCoreTooltip(row)"
        >
          <!-- 核心微型角标 -->
          <div class="micro-chip__header">
            <span class="micro-chip__tag">{{ row.shortLabel }}</span>
            <span
              v-if="row.temperature !== null"
              class="micro-chip__temp-pill"
              :class="`temp-text--${getTemperatureTier(row.temperature)}`"
            >
              {{ Math.round(row.temperature) }}°
            </span>
          </div>

          <!-- 核心中央几何图元：形状与能量色随频率/负荷动态呈现 -->
          <div class="micro-chip__glyph-wrapper">
            <div
              :class="[
                'micro-glyph',
                `glyph--${getFrequencyTier(row.speed)}`,
              ]"
            />
          </div>

          <!-- 底部微型负载指示条 -->
          <div class="micro-chip__bar" aria-hidden="true">
            <i
              :style="{
                width: `${Math.min(100, Math.max(0, row.load || 0))}%`,
                backgroundColor: getLoadColor(row.load),
              }"
            />
          </div>
        </article>
      </div>

      <div v-else-if="loading" class="super-lite-cores-state">
        <span class="super-lite-spinner"></span>
        <span>同步核心数据…</span>
      </div>

      <div v-else class="super-lite-cores-state">
        <span>未检测到可用核心</span>
      </div>
    </main>

    <!-- 底部：核心拓扑与峰值频率 -->
    <footer class="super-lite-footer">
      <span class="footer-left">{{ footerLeftText }}</span>
      <span class="footer-right">{{ footerRightText }}</span>
    </footer>
  </section>
</template>

<style scoped lang="less">
.super-lite-monitor {
  display: flex;
  flex-direction: column;
  width: 200px;
  height: 200px;
  box-sizing: border-box;
  padding: 8px;
  border: 1px solid var(--panel-border);
  border-radius: 8px;
  background: var(--surface-watch);
  color: var(--text-watch);
  backdrop-filter: blur(24px);
  box-shadow:
    inset 0 1px 0 var(--surface-inset-highlight),
    var(--shadow-watch);
  user-select: none;
}

.super-lite-header {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  height: 22px;
  gap: 6px;
  align-items: center;
  flex: 0 0 auto;
  user-select: none;
  -webkit-app-region: drag;
}

.super-lite-status {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
}

.super-lite-status__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-watch);
}

.super-lite-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #64d86b;
  box-shadow: 0 0 8px rgba(100, 216, 107, 0.7);
  flex: 0 0 auto;

  &--warning {
    background: #f2bf4d;
    box-shadow: 0 0 8px rgba(242, 191, 77, 0.7);
  }

  &--danger {
    background: #ff6f75;
    box-shadow: 0 0 8px rgba(255, 111, 117, 0.7);
  }
}

.super-lite-actions {
  display: inline-flex;
  align-items: center;
  justify-self: end;
  gap: 4px;
  -webkit-app-region: no-drag;
}

.super-lite-pin,
.super-lite-mode-switch,
.super-lite-close {
  border: 0;
  color: inherit;
  font: inherit;
  cursor: pointer;
  outline: none;
}

.super-lite-mode-switch {
  height: 18px;
  padding: 0 5px;
  border-radius: 4px;
  background: var(--watch-muted-surface);
  font-size: 9px;
  font-weight: 700;
  color: var(--text-watch-subtle);
  transition: background 0.16s ease, color 0.16s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.12);
    color: var(--text-watch);
  }
}

.super-lite-pin {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 18px;
  border-radius: 4px;
  background: var(--watch-muted-surface);
  color: var(--text-watch-subtle);
  transition: background 0.16s ease, color 0.16s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.12);
    color: var(--text-watch);
  }

  &[aria-pressed='true'] {
    color: #58c7ff;
    background: rgba(88, 199, 255, 0.15);
  }
}

.super-lite-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 18px;
  border-radius: 4px;
  background: var(--watch-muted-surface);
  color: var(--text-watch-subtle);
  transition: background 0.16s ease, color 0.16s ease;

  &:hover {
    background: rgba(255, 111, 125, 0.18);
    color: #ffd8dd;
  }
}

/* 顶部整体大盘摘要行 */
.super-lite-summary-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 20px;
  margin-top: 3px;
  padding: 0 6px;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--panel-border-soft);
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
}

.summary-left {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.summary-tag {
  color: var(--text-watch-muted, #94a3b8);
  font-size: 8.5px;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.summary-load {
  font-size: 10px;
  font-weight: 800;
  color: var(--text-watch, #f8fafc);
}

.summary-bar {
  display: inline-block;
  width: 26px;
  height: 3px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.1);
  overflow: hidden;

  i {
    display: block;
    height: 100%;
    border-radius: 2px;
    transition: width 0.3s ease, background-color 0.3s ease;
  }
}

.summary-right {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 9px;
  font-weight: 650;
}

.summary-temp {
  font-weight: 700;
  transition: color 0.3s ease;
}

.summary-freq {
  color: var(--text-watch-muted, #94a3b8);
  font-size: 8.5px;
}

/* 核心主体矩阵 */
.super-lite-cores-body {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  margin-top: 4px;
  margin-bottom: 3px;
  overflow: hidden;
}

.cores-micro-grid {
  display: grid;
  gap: 3px;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
}

/* 微型核心芯片单元（完全无遮挡文本块，以形态+色彩呈现） */
.micro-chip {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 2px 3px 3px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-sizing: border-box;
  overflow: hidden;
  transition: border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
  cursor: pointer;

  &:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.25);
  }

  /* P/E 核专属标识 */
  &--p {
    border-left: 2px solid #38bdf8 !important;
  }

  &--e {
    border-left: 2px solid #a78bfa !important;
  }
}

/* 温度边框色系（代表芯片当前温度） */
.temp-border--cool {
  border-color: rgba(56, 189, 248, 0.3);
}

.temp-border--normal {
  border-color: rgba(52, 211, 153, 0.35);
}

.temp-border--warm {
  border-color: rgba(245, 158, 11, 0.55);
  background: rgba(245, 158, 11, 0.05);
}

.temp-border--hot {
  border-color: rgba(239, 68, 68, 0.7);
  background: rgba(239, 68, 68, 0.1);
  box-shadow: 0 0 6px rgba(239, 68, 68, 0.3);
}

.micro-chip__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  line-height: 1;
  min-width: 0;
}

.micro-chip__tag {
  font-size: 7.5px;
  font-weight: 800;
  color: rgba(255, 255, 255, 0.4);
  letter-spacing: -0.02em;
}

.micro-chip--p .micro-chip__tag {
  color: #38bdf8;
}

.micro-chip--e .micro-chip__tag {
  color: #c4b5fd;
}

.micro-chip__temp-pill {
  font-size: 7.5px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  opacity: 0.85;
}

.temp-text--cool {
  color: #38bdf8;
}

.temp-text--normal {
  color: #34d399;
}

.temp-text--warm {
  color: #fbbf24;
}

.temp-text--hot {
  color: #f87171;
  font-weight: 800;
}

/* 核心能量几何图元（根据频率呈现不同形态与色彩） */
.micro-chip__glyph-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1 1 auto;
  min-height: 0;
  padding: 1px 0;
}

.micro-glyph {
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

/* 1. 待机/节能低频（小巧胶囊，静谧冷灰） */
.glyph--idle {
  width: 14px;
  height: 4px;
  border-radius: 999px;
  background: #475569;
  opacity: 0.65;
}

/* 2. 基础标频（充盈圆角条，科技青蓝） */
.glyph--base {
  width: 20px;
  height: 6px;
  border-radius: 3px;
  background: #38bdf8;
  box-shadow: 0 0 4px rgba(56, 189, 248, 0.45);
}

/* 3. 睿频加速（饱满晶体条，电光紫罗兰） */
.glyph--boost {
  width: 25px;
  height: 7px;
  border-radius: 3px;
  background: linear-gradient(90deg, #818cf8, #a855f7);
  box-shadow: 0 0 6px rgba(168, 85, 247, 0.55);
}

/* 4. 极速/极限冲频（耀眼棱光晶核，炽金辉光） */
.glyph--turbo {
  width: 28px;
  height: 8px;
  border-radius: 3px;
  background: linear-gradient(90deg, #f59e0b, #fbbf24);
  box-shadow: 0 0 8px rgba(251, 191, 36, 0.75);
}

/* 底部微型负载进度条 */
.micro-chip__bar {
  position: relative;
  width: 100%;
  height: 1.5px;
  border-radius: 1px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
  margin-top: 1px;

  i {
    display: block;
    height: 100%;
    border-radius: 1px;
    transition: width 0.3s ease, background-color 0.3s ease;
  }
}

.super-lite-cores-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1 1 auto;
  gap: 6px;
  color: var(--text-watch-muted);
  font-size: 10px;
}

.super-lite-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.15);
  border-top-color: var(--accent-cyan, #58c7ff);
  animation: super-lite-spin 0.8s linear infinite;
}

@keyframes super-lite-spin {
  to {
    transform: rotate(360deg);
  }
}

/* 底部拓扑与峰值规格栏 */
.super-lite-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 16px;
  gap: 6px;
  flex: 0 0 auto;
  color: var(--text-watch-muted, #94a3b8);
  font-size: 8.5px;
  font-variant-numeric: tabular-nums;
  user-select: none;
}

.footer-left {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgba(255, 255, 255, 0.55);
}

.footer-right {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
  color: rgba(255, 255, 255, 0.7);
  font-weight: 600;
}
</style>
