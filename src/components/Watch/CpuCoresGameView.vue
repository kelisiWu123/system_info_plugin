<script setup lang="ts">
import { CloseSmall, Pushpin } from '@icon-park/vue-next'
import { ref } from 'vue'
import type { CoreRow } from './CpuCoresSuperLiteView.vue'

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
  (event: 'close-window'): void
}>()

const coresStripRef = ref<HTMLElement | null>(null)

type FrequencyTier = 'idle' | 'base' | 'boost' | 'turbo'

function getFrequencyTier(speed: number | null): FrequencyTier {
  if (speed === null || speed <= 0) return 'idle'
  if (speed < 2.4) return 'idle'
  if (speed < 3.6) return 'base'
  if (speed < 4.4) return 'boost'
  return 'turbo'
}

type TemperatureTier = 'cool' | 'normal' | 'warm' | 'hot'

function getTemperatureTier(temp: number | null): TemperatureTier {
  if (temp === null) return 'normal'
  if (temp < 52) return 'cool'
  if (temp < 70) return 'normal'
  if (temp < 82) return 'warm'
  return 'hot'
}

function getFreqColor(speed: number | null): string {
  if (speed === null || speed <= 0) return '#64748b'
  if (speed < 2.4) return '#38bdf8' // 待机节能：清凉青蓝
  if (speed < 3.6) return '#34d399' // 标准主频：稳健翠绿
  if (speed < 4.4) return '#c084fc' // 睿频加速：霓虹电紫
  return '#fb923c' // 极速冲频：炽热金橙
}

function getLoadColor(load: number | null): string {
  if (load === null) return '#64748b'
  if (load >= 85) return '#f87171'
  if (load >= 60) return '#fbbf24'
  return '#34d399'
}

function getTempTextColor(temp: number | null): string {
  if (temp === null) return 'var(--text-watch, #e2e8f0)'
  if (temp >= 82) return '#ff6f75'
  if (temp >= 70) return '#fbbf24'
  if (temp < 52) return '#38bdf8'
  return '#34d399'
}

function formatCoreTooltip(row: CoreRow): string {
  const typeName = row.type === 'P-Core' ? '性能核' : row.type === 'E-Core' ? '能效核' : '核心'

  const freqTier = getFrequencyTier(row.speed)
  const freqDescMap: Record<FrequencyTier, string> = {
    idle: '待机节能 (< 2.4G)',
    base: '标准基频 (2.4 - 3.6G)',
    boost: '睿频加速 (3.6 - 4.4G)',
    turbo: '极速冲频 (>= 4.4G)',
  }
  const speedText = row.speed !== null
    ? `${row.speed.toFixed(2)} GHz · ${freqDescMap[freqTier]}`
    : '--'

  const tempTier = getTemperatureTier(row.temperature)
  const tempDescMap: Record<TemperatureTier, string> = {
    cool: '清凉',
    normal: '温和',
    warm: '偏热',
    hot: '炽热警报',
  }
  const tempText = row.temperature !== null
    ? `${Math.round(row.temperature)}°C · ${tempDescMap[tempTier]}`
    : '--'

  const loadText = row.load !== null ? `${Math.round(row.load)}%` : '--'

  return `${typeName} ${row.index} (${row.shortLabel})\n• 频率：${speedText}\n• 负载：${loadText}\n• 温度：${tempText}`
}

function handleWheel(e: WheelEvent) {
  if (!coresStripRef.value) return
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
    coresStripRef.value.scrollLeft += e.deltaY
  }
}
</script>

<template>
  <section class="game-hud-monitor" aria-label="CPU核心游戏模式监控">
    <!-- 最左侧专属拖动手柄 (纯无标题栏设计，通过把手拖动) -->
    <div
      class="game-drag-handle"
      title="拖动手柄 · 按住移动浮窗"
      aria-label="拖动手柄"
    >
      <div class="drag-grip" aria-hidden="true">
        <span class="grip-dot" />
        <span class="grip-dot" />
        <span class="grip-dot" />
      </div>
    </div>

    <!-- 左侧整机概览 (温/载/频三联药丸标签，精致高效) -->
    <aside
      class="game-hud-master"
      :title="`CPU型号: ${cpuBrand}\n封装温度: ${packageTemp ?? '--'}°C\n总占用率: ${totalLoadPercent ?? '--'}%\n全核均频: ${avgSpeedGhz ?? '--'} GHz`"
    >
      <div class="master-telemetry">
        <div class="telemetry-chip telemetry-chip--temp" title="CPU封装温度">
          <span class="chip-metric-tag">温</span>
          <strong :style="{ color: getTempTextColor(packageTemp) }" class="telemetry-val">
            {{ packageTemp !== null ? `${packageTemp}°` : '--' }}
          </strong>
        </div>
        <div class="telemetry-chip telemetry-chip--load" title="CPU总占用率">
          <span class="chip-metric-tag">载</span>
          <strong :style="{ color: getLoadColor(totalLoadPercent) }" class="telemetry-val">
            {{ totalLoadPercent !== null ? `${totalLoadPercent}%` : '--' }}
          </strong>
        </div>
        <div class="telemetry-chip telemetry-chip--freq" title="全核均频">
          <span class="chip-metric-tag">频</span>
          <strong class="telemetry-val freq-val">
            {{ avgSpeedGhz !== null ? `${avgSpeedGhz.toFixed(1)}G` : '--' }}
          </strong>
        </div>
      </div>
    </aside>

    <!-- 纵向分割线 -->
    <div class="hud-divider" aria-hidden="true" />

    <!-- 中间核心横向条带 (纯图形与颜色，自适应填满横向宽度，无任何文字) -->
    <main
      ref="coresStripRef"
      class="game-cores-strip"
      @wheel.passive="handleWheel"
    >
      <div v-if="coreRows.length" class="strip-container">
        <article
          v-for="row in coreRows"
          :key="row.id"
          :class="[
            'game-core-chip',
            row.type === 'P-Core' ? 'chip--p' : row.type === 'E-Core' ? 'chip--e' : 'chip--std',
            `temp-border--${getTemperatureTier(row.temperature)}`,
            `freq-tier--${getFrequencyTier(row.speed)}`,
          ]"
          :title="formatCoreTooltip(row)"
        >
          <!-- 顶部横向频率指示条 (颜色表示频段加速等级) -->
          <div
            class="freq-pip-indicator"
            :style="{ backgroundColor: getFreqColor(row.speed) }"
          />

          <!-- 负载动态横向填充槽 (宽度表示占用率，精密刻度背景，无文字) -->
          <div class="chip-meter-track" aria-hidden="true">
            <div
              class="chip-meter-fill"
              :style="{
                width: `${Math.min(100, Math.max(0, row.load || 0))}%`,
                backgroundColor: getLoadColor(row.load),
              }"
            />
            <!-- 50% 中间刻度标线 -->
            <div class="chip-meter-notch" />
          </div>

          <!-- 底部架构微标 (P核亮蓝 / E核靓紫) -->
          <div class="chip-arch-mark" />
        </article>
      </div>

      <div v-else-if="loading" class="strip-state">
        <span class="strip-spinner" />
      </div>

      <div v-else class="strip-state">
        <span>--</span>
      </div>
    </main>

    <!-- 纵向分割线 -->
    <div class="hud-divider" aria-hidden="true" />

    <!-- 右侧操作区：不再提供切到别的模式的按钮，仅保留固定和关闭 -->
    <aside class="master-actions">
      <button
        type="button"
        :class="['hud-action-btn', 'hud-action-btn--icon', { 'is-active': pinned }]"
        :title="pinned ? '取消固定' : '固定窗口'"
        :aria-label="pinned ? '取消固定' : '固定窗口'"
        @click="emit('toggle-pin')"
      >
        <Pushpin theme="outline" size="10" fill="currentColor" :strokeWidth="3" />
      </button>
      <button
        type="button"
        class="hud-action-btn hud-action-btn--icon hud-action-btn--close"
        title="关闭窗口"
        aria-label="关闭窗口"
        @click="emit('close-window')"
      >
        <CloseSmall theme="outline" size="12" fill="currentColor" :strokeWidth="3" />
      </button>
    </aside>
  </section>
</template>

<style scoped lang="less">
.game-hud-monitor {
  display: flex;
  flex-direction: row;
  align-items: center;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  padding: 0 4px;
  gap: 5px;
  border-radius: 6px;
  background: var(--watch-shell-background, rgba(15, 23, 42, 0.94));
  border: 1px solid var(--panel-border, rgba(255, 255, 255, 0.14));
  box-shadow:
    inset 0 1px 0 var(--surface-inset-highlight, rgba(255, 255, 255, 0.08)),
    0 4px 16px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(28px);
  user-select: none;
  overflow: hidden;
  -webkit-app-region: drag;
}

/* 最左侧专用拖动手柄 */
.game-drag-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 11px;
  min-width: 11px;
  height: 18px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  cursor: grab;
  -webkit-app-region: drag;
  transition: all 0.15s ease;
  user-select: none;
  flex-shrink: 0;

  &:hover {
    background: rgba(56, 189, 248, 0.2);
    border-color: rgba(56, 189, 248, 0.4);

    .grip-dot {
      background: #38bdf8;
      box-shadow: 0 0 3px #38bdf8;
    }
  }

  &:active {
    cursor: grabbing;
    background: rgba(56, 189, 248, 0.3);
  }
}

.drag-grip {
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.grip-dot {
  width: 2px;
  height: 2px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.4);
  transition: all 0.15s ease;
}

/* 左侧总览区 */
.game-hud-master {
  display: flex;
  align-items: center;
  height: 100%;
  box-sizing: border-box;
  flex-shrink: 0;
}

.master-telemetry {
  display: flex;
  align-items: center;
  gap: 4px;
  line-height: 1;
}

.telemetry-chip {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 1px 4px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  height: 18px;
  box-sizing: border-box;
}

.chip-metric-tag {
  font-size: 8.5px;
  font-weight: 600;
  color: var(--text-watch-muted, #94a3b8);
  line-height: 1;
}

.telemetry-val {
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;

  &.freq-val {
    color: #facc15;
  }
}

/* 纵向分割线 */
.hud-divider {
  width: 1px;
  height: 14px;
  background: var(--panel-border-soft, rgba(255, 255, 255, 0.12));
  flex-shrink: 0;
}

/* 中间核心横向条带 (纯图形与颜色，自适应填满横向宽度，无任何文字) */
.game-cores-strip {
  flex: 1;
  height: 100%;
  display: flex;
  align-items: center;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  -webkit-app-region: no-drag;

  &::-webkit-scrollbar {
    display: none;
  }
}

.strip-container {
  display: flex;
  align-items: center;
  gap: 3px;
  width: 100%;
  height: 100%;
}

/* 核心小卡片 (自适应弹性填充宽度，纯图形微型槽位，无文字) */
.game-core-chip {
  flex: 1 1 0;
  min-width: 14px;
  max-width: 48px;
  height: 18px;
  box-sizing: border-box;
  padding: 1.5px 2px;
  border-radius: 2.5px;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.08);
  transition: all 0.15s ease;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  cursor: default;

  /* 性能核：更高辨识度 */
  &.chip--p {
    border-color: rgba(56, 189, 248, 0.28);
    background: linear-gradient(180deg, rgba(56, 189, 248, 0.06) 0%, rgba(255, 255, 255, 0.02) 100%);
  }

  /* 能效核：紫色雅致调 */
  &.chip--e {
    border-color: rgba(192, 132, 252, 0.22);
    background: linear-gradient(180deg, rgba(192, 132, 252, 0.06) 0%, rgba(255, 255, 255, 0.02) 100%);
  }

  &.chip--std {
    border-color: rgba(74, 222, 128, 0.2);
  }

  &:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.3);
    transform: translateY(-0.5px);
  }

  &.temp-border--warm {
    border-color: rgba(251, 191, 36, 0.6);
  }

  &.temp-border--hot {
    border-color: #f87171;
    box-shadow: 0 0 5px rgba(248, 113, 113, 0.5);
  }
}

/* 顶部微型频率指示标 (横向通栏) */
.freq-pip-indicator {
  width: 100%;
  height: 2px;
  border-radius: 1px 1px 0 0;
  flex-shrink: 0;
  transition: background-color 0.25s ease;
}

/* 负载动态横向填充槽 (带50%刻度标线，无文字) */
.chip-meter-track {
  width: 100%;
  height: 6px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 1.5px;
  overflow: hidden;
  position: relative;
  display: flex;
  align-items: center;
}

.chip-meter-fill {
  height: 100%;
  border-radius: 1.5px;
  transition: width 0.25s ease, background-color 0.25s ease;
}

.chip-meter-notch {
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 1px;
  background: rgba(255, 255, 255, 0.2);
  pointer-events: none;
}

/* 底部架构类型标识微条 */
.chip-arch-mark {
  width: 100%;
  height: 1.5px;
  border-radius: 0 0 1px 1px;
  flex-shrink: 0;
}

.chip--p .chip-arch-mark {
  background: rgba(56, 189, 248, 0.55);
}

.chip--e .chip-arch-mark {
  background: rgba(192, 132, 252, 0.45);
}

.chip--std .chip-arch-mark {
  background: rgba(74, 222, 128, 0.35);
}

/* 状态提示 */
.strip-state {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--text-watch-muted, #94a3b8);
  font-size: 10px;
  padding: 0 4px;
}

.strip-spinner {
  width: 8px;
  height: 8px;
  border: 1.5px solid rgba(255, 255, 255, 0.15);
  border-top-color: #38bdf8;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

/* 右侧操作区 */
.master-actions {
  display: flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
  -webkit-app-region: no-drag;
}

.hud-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-watch-secondary, #94a3b8);
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.16);
    color: #ffffff;
    border-color: rgba(255, 255, 255, 0.22);
  }

  &.is-active {
    background: rgba(56, 189, 248, 0.2);
    border-color: rgba(56, 189, 248, 0.45);
    color: #38bdf8;
  }

  &--close:hover {
    background: rgba(248, 113, 113, 0.24);
    border-color: rgba(248, 113, 113, 0.45);
    color: #f87171;
  }
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
