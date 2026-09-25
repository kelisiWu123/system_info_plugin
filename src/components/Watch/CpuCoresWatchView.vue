<script setup lang="ts">
import { CloseSmall, Cpu, Info, Pushpin } from '@icon-park/vue-next'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  activateProcessorHardwareStore,
  deactivateProcessorHardwareStore,
  processorHardwareStore,
} from '../../composables/useProcessorHardwareData'
import { getCpuHybridCoreCounts, getProcessorDisplayCoreCount } from '../../utils/processor'

defineProps<{
  active?: boolean
}>()

const pinned = ref(true)

const {
  cpuData,
  cpuCurrentSpeed,
  cpuTemperature,
  cpuLoadData,
  loading,
} = processorHardwareStore

onMounted(() => {
  window.services?.alwaysOnTop?.(pinned.value)
  void activateProcessorHardwareStore()
})

onUnmounted(() => {
  deactivateProcessorHardwareStore()
})

function togglePin() {
  pinned.value = !pinned.value
  window.services?.alwaysOnTop?.(pinned.value)
}

function closeWindow() {
  window.services?.closeWindow?.()
}

const cpuHybridCoreCounts = computed(() => getCpuHybridCoreCounts(cpuData.value))
const displayPhysicalCoreCount = computed(() =>
  getProcessorDisplayCoreCount(cpuData.value, cpuCurrentSpeed.value, cpuLoadData.value)
)

function coreTypeLabel(index: number, total: number, performanceCores?: number, efficiencyCores?: number) {
  if (performanceCores && efficiencyCores && total === performanceCores + efficiencyCores) {
    return index < performanceCores ? 'P-Core' : 'E-Core'
  }
  return 'Core'
}

const allCoreRows = computed(() => {
  const speedCores = cpuCurrentSpeed.value?.cores || []
  const loadCpus = cpuLoadData.value?.cpus || []
  const tempCores = cpuTemperature.value?.cores || []
  const packageTemp = typeof cpuTemperature.value?.value === 'number'
    ? cpuTemperature.value.value
    : typeof cpuTemperature.value?.main === 'number'
      ? cpuTemperature.value.main
      : null

  const knownCoreCount = displayPhysicalCoreCount.value
  const total = Math.max(
    knownCoreCount,
    knownCoreCount ? Math.min(speedCores.length, knownCoreCount) : speedCores.length,
    knownCoreCount ? Math.min(loadCpus.length, knownCoreCount) : loadCpus.length,
    0
  )

  const perf = cpuHybridCoreCounts.value.performance
  const eff = cpuHybridCoreCounts.value.efficiency

  return Array.from({ length: total }, (_, index) => {
    let coreLoad: number | null = null
    // If hyperthreading / SMT: 2 logical cpus per physical core
    if (loadCpus.length === total * 2) {
      const t1 = typeof loadCpus[index * 2]?.load === 'number' ? loadCpus[index * 2].load : null
      const t2 = typeof loadCpus[index * 2 + 1]?.load === 'number' ? loadCpus[index * 2 + 1].load : null
      if (t1 !== null && t2 !== null) {
        coreLoad = Math.round(((t1 + t2) / 2) * 10) / 10
      } else {
        coreLoad = t1 ?? t2
      }
    } else {
      coreLoad = typeof loadCpus[index]?.load === 'number' ? loadCpus[index].load : null
    }

    const type = coreTypeLabel(index, total, perf, eff)
    const shortLabel = type === 'P-Core'
      ? `P${index + 1}`
      : type === 'E-Core'
        ? `E${index + 1 - (perf || 0)}`
        : `C${index + 1}`

    const speedVal = typeof speedCores[index] === 'number' && speedCores[index] > 0
      ? speedCores[index]
      : null

    const tempVal = typeof tempCores[index] === 'number' && tempCores[index] > 0
      ? tempCores[index]
      : packageTemp

    return {
      id: `core-${index}`,
      index: index + 1,
      shortLabel,
      type,
      speed: speedVal,
      load: coreLoad,
      temperature: tempVal,
    }
  })
})

const avgSpeedGhz = computed(() => {
  const speeds = allCoreRows.value.map((r) => r.speed).filter((s): s is number => typeof s === 'number' && s > 0)
  if (!speeds.length) {
    return typeof cpuCurrentSpeed.value?.avg === 'number' && cpuCurrentSpeed.value.avg > 0
      ? cpuCurrentSpeed.value.avg
      : null
  }
  return Math.round((speeds.reduce((a, b) => a + b, 0) / speeds.length) * 100) / 100
})

const totalLoadPercent = computed(() => {
  return typeof cpuLoadData.value?.currentLoad === 'number'
    ? Math.round(cpuLoadData.value.currentLoad)
    : null
})

const packageTempNum = computed(() => {
  return typeof cpuTemperature.value?.value === 'number'
    ? Math.round(cpuTemperature.value.value)
    : typeof cpuTemperature.value?.main === 'number'
      ? Math.round(cpuTemperature.value.main)
      : null
})

const cpuBrandShort = computed(() => {
  const brand = cpuData.value?.brand || ''
  if (!brand) return 'CPU 核心监控'
  const cleaned = brand
    .replace(/\bwith\s+.*Graphics\b/gi, '')
    .replace(/\b(AMD|Intel\(R\)|Intel|Core\(TM\)|Processor)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || brand
})

function getLoadTone(load: number | null): 'normal' | 'warn' | 'danger' {
  if (load === null) return 'normal'
  if (load >= 85) return 'danger'
  if (load >= 60) return 'warn'
  return 'normal'
}

function getTempTone(temp: number | null): 'normal' | 'warn' | 'danger' {
  if (temp === null) return 'normal'
  if (temp >= 85) return 'danger'
  if (temp >= 72) return 'warn'
  return 'normal'
}
</script>

<template>
  <div class="cpu-cores-watch">
    <header class="cpu-cores-watch__header">
      <div class="cpu-cores-watch__brand">
        <div class="cpu-cores-watch__icon">
          <Cpu theme="outline" size="14" fill="currentColor" :strokeWidth="3" />
        </div>
        <div class="cpu-cores-watch__title-group">
          <strong class="cpu-cores-watch__title" :title="cpuData?.brand || 'CPU 核心监控'">
            {{ cpuBrandShort }}
          </strong>
          <span class="cpu-cores-watch__meta">
            {{ allCoreRows.length ? `${allCoreRows.length} 核心` : loading ? '同步中…' : '核心监控' }}
          </span>
        </div>
      </div>

      <div class="cpu-cores-watch__actions">
        <button
          type="button"
          :class="['window-action-btn', { 'window-action-btn--active': pinned }]"
          :title="pinned ? '取消置顶' : '窗口置顶'"
          :aria-label="pinned ? '取消置顶' : '窗口置顶'"
          :aria-pressed="pinned"
          @click="togglePin"
        >
          <Pushpin theme="outline" size="13" fill="currentColor" :strokeWidth="3" />
        </button>
        <button
          type="button"
          class="window-action-btn window-action-btn--close"
          title="关闭窗口"
          aria-label="关闭窗口"
          @click="closeWindow"
        >
          <CloseSmall theme="outline" size="15" fill="currentColor" :strokeWidth="3" />
        </button>
      </div>
    </header>

    <section class="cpu-cores-watch__summary" aria-label="核心整体概况">
      <div class="summary-pill">
        <span class="summary-pill__label">均频</span>
        <strong class="summary-pill__value">
          {{ avgSpeedGhz ? `${avgSpeedGhz.toFixed(2)} GHz` : '--' }}
        </strong>
      </div>
      <div class="summary-pill">
        <span class="summary-pill__label">总负载</span>
        <strong :class="['summary-pill__value', `summary-pill__value--${getLoadTone(totalLoadPercent)}`]">
          {{ totalLoadPercent !== null ? `${totalLoadPercent}%` : '--' }}
        </strong>
      </div>
      <div class="summary-pill">
        <span class="summary-pill__label">封装温度</span>
        <strong :class="['summary-pill__value', `summary-pill__value--${getTempTone(packageTempNum)}`]">
          {{ packageTempNum !== null ? `${packageTempNum}°C` : '--' }}
        </strong>
      </div>
    </section>

    <main class="cpu-cores-watch__grid-container">
      <div v-if="allCoreRows.length" class="core-chips-grid">
        <article
          v-for="row in allCoreRows"
          :key="row.id"
          :class="[
            'core-chip',
            row.type === 'P-Core' ? 'core-chip--p' : row.type === 'E-Core' ? 'core-chip--e' : '',
            `core-chip--status-${getLoadTone(row.load)}`,
          ]"
        >
          <div class="core-chip__top">
            <span class="core-chip__tag">{{ row.shortLabel }}</span>
            <span :class="['core-chip__temp', `temp--${getTempTone(row.temperature)}`]">
              {{ row.temperature !== null ? `${Math.round(row.temperature)}°` : '--' }}
            </span>
          </div>

          <div class="core-chip__freq">
            {{ row.speed !== null ? `${row.speed.toFixed(2)}G` : '--' }}
          </div>

          <div class="core-chip__progress" aria-hidden="true">
            <i
              :class="`progress-bar--${getLoadTone(row.load)}`"
              :style="{ width: `${Math.min(100, Math.max(0, row.load || 0))}%` }"
            />
          </div>

          <div class="core-chip__bottom">
            <span class="core-chip__load-label">负载</span>
            <span :class="['core-chip__load', `load--${getLoadTone(row.load)}`]">
              {{ row.load !== null ? `${Math.round(row.load)}%` : '--' }}
            </span>
          </div>
        </article>
      </div>

      <div v-else-if="loading" class="cpu-cores-watch__state cpu-cores-watch__state--loading" role="status" aria-live="polite">
        <div class="cpu-cores-watch__mark" aria-hidden="true">
          <span class="cpu-cores-watch__spinner"></span>
        </div>
        <div class="cpu-cores-watch__state-copy">
          <strong>正在读取 CPU 核心数据</strong>
          <p>正在同步各核心频率、负载与温度状态…</p>
        </div>
      </div>

      <div v-else class="cpu-cores-watch__state cpu-cores-watch__state--empty" role="status">
        <div class="cpu-cores-watch__mark" aria-hidden="true">
          <Info theme="outline" size="20" fill="currentColor" :strokeWidth="3" />
        </div>
        <div class="cpu-cores-watch__state-copy">
          <strong>暂未获取到核心数据</strong>
          <p>未检测到可用物理核心或传感器读数</p>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped lang="less">
.cpu-cores-watch {
  display: flex;
  flex-direction: column;
  height: 100%;
  box-sizing: border-box;
  gap: 8px;
  padding: 10px 12px 10px;
  border: 1px solid var(--panel-border);
  border-radius: 10px;
  background: var(--watch-shell-background);
  box-shadow:
    inset 0 1px 0 var(--surface-inset-highlight),
    var(--shadow-watch);
  backdrop-filter: blur(28px);
  user-select: none;
}

.cpu-cores-watch__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 7px;
  border-bottom: 1px solid var(--panel-border-soft);
  -webkit-app-region: drag;
}

.cpu-cores-watch__brand {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.cpu-cores-watch__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: var(--surface-icon-background);
  color: var(--accent-cyan);
}

.cpu-cores-watch__title-group {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.cpu-cores-watch__title {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cpu-cores-watch__meta {
  color: var(--text-subtle);
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
}

.cpu-cores-watch__actions {
  display: flex;
  align-items: center;
  gap: 4px;
  -webkit-app-region: no-drag;
}

.window-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 5px;
  background: var(--watch-muted-surface);
  color: var(--text-subtle);
  cursor: pointer;
  transition: background 0.16s ease, color 0.16s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-primary);
  }

  &--active {
    background: rgba(107, 194, 255, 0.18);
    color: var(--accent-cyan);
  }

  &--close:hover {
    background: rgba(255, 111, 125, 0.22);
    color: #ffd8dd;
  }
}

.cpu-cores-watch__summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  padding: 4px 6px;
  border-radius: 6px;
  background: var(--surface-soft-background);
  -webkit-app-region: drag;
}

.summary-pill {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
}

.summary-pill__label {
  color: var(--text-subtle);
  font-size: 9px;
  font-weight: 600;
}

.summary-pill__value {
  color: var(--text-primary);
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;

  &--warn {
    color: var(--accent-yellow);
  }

  &--danger {
    color: var(--accent-danger);
  }
}

.cpu-cores-watch__grid-container {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 2px;

  &::-webkit-scrollbar {
    width: 4px;
  }

  &::-webkit-scrollbar-thumb {
    border-radius: 4px;
    background: rgba(110, 128, 160, 0.28);
  }
}

.core-chips-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
  width: 100%;
  box-sizing: border-box;
  margin: auto 0;
}

.core-chip {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-height: 58px;
  box-sizing: border-box;
  padding: 6px 7px;
  border: 1px solid var(--panel-border-soft);
  border-radius: 7px;
  background: var(--card-background);
  transition: border-color 0.18s ease, background 0.18s ease;

  &--p {
    border-color: rgba(69, 181, 255, 0.24);
  }

  &--e {
    border-color: rgba(139, 220, 101, 0.24);
  }

  &--status-warn {
    border-color: rgba(255, 207, 87, 0.38);
    background: rgba(255, 207, 87, 0.04);
  }

  &--status-danger {
    border-color: rgba(255, 126, 107, 0.42);
    background: rgba(255, 126, 107, 0.06);
  }
}

.core-chip__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  line-height: 1;
}

.core-chip__tag {
  color: var(--accent-cyan);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: -0.02em;

  .core-chip--e & {
    color: var(--accent-green);
  }
}

.core-chip__temp {
  font-size: 10px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text-subtle);

  &.temp--normal {
    color: var(--text-muted);
  }

  &.temp--warn {
    color: var(--accent-yellow);
  }

  &.temp--danger {
    color: var(--accent-danger);
  }
}

.core-chip__freq {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
  letter-spacing: -0.02em;
}

.core-chip__progress {
  height: 3px;
  margin-top: 1px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;

  i {
    display: block;
    height: 100%;
    border-radius: 2px;
    background: var(--accent-cyan);
    transition: width 0.24s ease;

    &.progress-bar--warn {
      background: var(--accent-yellow);
    }

    &.progress-bar--danger {
      background: var(--accent-danger);
    }
  }
}

.core-chip__bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 9px;
  line-height: 1;
}

.core-chip__load-label {
  color: var(--text-subtle);
}

.core-chip__load {
  color: var(--text-muted);
  font-weight: 700;
  font-variant-numeric: tabular-nums;

  &.load--warn {
    color: var(--accent-yellow);
  }

  &.load--danger {
    color: var(--accent-danger);
  }
}

.cpu-cores-watch__state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  width: 100%;
  height: 100%;
  min-height: 200px;
  margin: auto 0;
  text-align: center;
  user-select: none;
}

.cpu-cores-watch__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border: 1px solid var(--panel-border-soft);
  border-radius: 50%;
  background: var(--surface-soft-background);
  color: var(--accent-cyan);
}

.cpu-cores-watch__spinner {
  display: inline-block;
  box-sizing: border-box;
  width: 22px;
  height: 22px;
  border: 2.5px solid rgba(107, 194, 255, 0.22);
  border-top-color: var(--accent-cyan, #6bc2ff);
  border-radius: 50%;
  animation: cpu-cores-spin 0.8s linear infinite;
  transform-origin: center center;
  will-change: transform;
}

.cpu-cores-watch__state-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;

  strong {
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 700;
  }

  p {
    margin: 0;
    color: var(--text-subtle);
    font-size: 11px;
    line-height: 1.4;
  }
}

@keyframes cpu-cores-spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}
</style>
