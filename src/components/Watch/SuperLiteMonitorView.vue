<script setup lang="ts">
import type { SuperLiteStatus } from '../../utils/superLiteMonitor'

type DetailPage = 'overview' | 'cpu' | 'gpu' | 'memory'

interface MetricRow {
  key: 'cpu' | 'gpu' | 'memory'
  label: string
  usageLabel: string
  primaryExtra: string
  secondaryExtra: string
  trend: number[]
  tone: 'cpu' | 'gpu' | 'memory'
  status: 'normal' | 'warning' | 'danger'
}

defineProps<{
  page: DetailPage
  status: SuperLiteStatus
  metrics: MetricRow[]
  footerLeft: string
  footerRight: string
  pinned: boolean
}>()

const emit = defineEmits<{
  (event: 'set-page', page: DetailPage): void
  (event: 'toggle-pin'): void
  (event: 'switch-standard'): void
}>()

function barCount(values: number[]) {
  return values.slice(-5).map((value) => Math.max(1, Math.min(5, Math.ceil((value || 0) / 20))))
}

function progressWidth(label: string) {
  return /^\d+%$/.test(label) ? label : '0%'
}

function getDetailMetrics(metrics: MetricRow[], page: DetailPage) {
  if (page === 'overview') return []
  return metrics.filter((item) => item.key === page)
}
</script>

<template>
  <section class="super-lite-monitor" :data-super-lite-page="page">
    <header class="super-lite-header">
      <button type="button" class="super-lite-status" @click="emit('set-page', 'overview')">
        <span :class="['super-lite-dot', `super-lite-dot--${status.level}`]" />
        <span>{{ status.label }}</span>
      </button>

      <nav class="super-lite-switcher" aria-label="超级轻量模式页面">
        <button type="button" @click="emit('set-page', 'overview')">概览</button>
        <button type="button" @click="emit('set-page', 'cpu')">CPU</button>
        <button type="button" @click="emit('set-page', 'gpu')">GPU</button>
      </nav>

      <button
        type="button"
        class="super-lite-pin"
        :aria-pressed="pinned"
        title="固定窗口"
        @click="emit('toggle-pin')"
      >
        钉
      </button>
    </header>

    <main v-if="page === 'overview'" class="super-lite-body">
      <button
        v-for="metric in metrics"
        :key="metric.key"
        type="button"
        :class="['super-lite-row', `super-lite-row--${metric.tone}`, `super-lite-row--${metric.status}`]"
        @click="emit('set-page', metric.key === 'memory' ? 'memory' : metric.key)"
      >
        <span class="super-lite-row__top">
          <strong>{{ metric.label }}</strong>
          <em>{{ metric.usageLabel }}</em>
          <span class="super-lite-bars" aria-hidden="true">
            <i
              v-for="(height, index) in barCount(metric.trend)"
              :key="index"
              :style="{ height: `${height * 3}px` }"
            />
          </span>
          <span>{{ metric.primaryExtra }}</span>
        </span>
        <span class="super-lite-row__bottom">
          <small>{{ metric.secondaryExtra }}</small>
          <span class="super-lite-progress">
            <i :style="{ width: progressWidth(metric.usageLabel) }" />
          </span>
        </span>
      </button>
    </main>

    <main v-else class="super-lite-detail">
      <button type="button" class="super-lite-back" @click="emit('set-page', 'overview')">
        <span>‹</span>
        <strong>{{ page.toUpperCase() }}详情</strong>
      </button>
      <dl>
        <template v-for="metric in getDetailMetrics(metrics, page)" :key="metric.key">
          <dt>使用率</dt>
          <dd>{{ metric.usageLabel }}</dd>
          <dt>主要指标</dt>
          <dd>{{ metric.primaryExtra }}</dd>
          <dt>辅助指标</dt>
          <dd>{{ metric.secondaryExtra }}</dd>
        </template>
      </dl>
    </main>

    <footer class="super-lite-footer">
      <span>{{ footerLeft }}</span>
      <button type="button" title="切回标准模式" @click="emit('switch-standard')">标准</button>
      <span>{{ footerRight }}</span>
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
  border: 1px solid rgba(210, 223, 248, 0.22);
  border-radius: 8px;
  background: rgba(10, 18, 30, 0.56);
  color: rgba(244, 248, 255, 0.94);
  backdrop-filter: blur(24px);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.14),
    0 14px 32px rgba(1, 8, 18, 0.22);
}

.super-lite-header,
.super-lite-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 0 0 auto;
}

.super-lite-header {
  height: 24px;
  gap: 6px;
  -webkit-app-region: drag;
}

.super-lite-status,
.super-lite-pin,
.super-lite-switcher button,
.super-lite-footer button,
.super-lite-back,
.super-lite-row {
  border: 0;
  color: inherit;
  font: inherit;
  cursor: pointer;
  -webkit-app-region: no-drag;
}

.super-lite-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 52px;
  padding: 0;
  background: transparent;
  font-size: 11px;
  font-weight: 700;
}

.super-lite-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #64d86b;
  box-shadow: 0 0 10px rgba(100, 216, 107, 0.74);
}

.super-lite-dot--warning {
  background: #f2bf4d;
  box-shadow: 0 0 10px rgba(242, 191, 77, 0.72);
}

.super-lite-dot--danger {
  background: #ff6f75;
  box-shadow: 0 0 10px rgba(255, 111, 117, 0.72);
}

.super-lite-switcher {
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.16s ease;
}

.super-lite-header:hover .super-lite-switcher {
  opacity: 1;
  pointer-events: auto;
}

.super-lite-switcher button,
.super-lite-footer button {
  height: 18px;
  padding: 0 5px;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.07);
  font-size: 9px;
}

.super-lite-pin {
  width: 24px;
  height: 20px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.07);
  font-size: 10px;
  font-weight: 700;
}

.super-lite-pin[aria-pressed='true'] {
  color: #58c7ff;
}

.super-lite-body {
  display: grid;
  flex: 1 1 auto;
  min-height: 0;
  gap: 5px;
  padding: 4px 0 5px;
}

.super-lite-row {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 0;
  gap: 3px;
  padding: 5px 6px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.045);
  text-align: left;
}

.super-lite-row--warning {
  background: rgba(242, 191, 77, 0.11);
}

.super-lite-row--danger {
  background: rgba(255, 111, 117, 0.13);
}

.super-lite-row__top,
.super-lite-row__bottom {
  display: grid;
  align-items: center;
  gap: 6px;
}

.super-lite-row__top {
  grid-template-columns: 28px 32px 1fr 34px;
  font-size: 10px;
}

.super-lite-row__top strong,
.super-lite-row__top em {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.super-lite-row__top em {
  color: #f7fbff;
  font-style: normal;
  font-weight: 800;
}

.super-lite-row__bottom {
  grid-template-columns: 50px 1fr;
}

.super-lite-row__bottom small {
  overflow: hidden;
  color: rgba(212, 224, 242, 0.74);
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.super-lite-bars {
  display: inline-flex;
  align-items: end;
  justify-content: center;
  gap: 2px;
  height: 16px;
}

.super-lite-bars i {
  width: 3px;
  min-height: 3px;
  border-radius: 3px;
  background: rgba(124, 203, 255, 0.74);
}

.super-lite-row--memory .super-lite-bars i {
  background: rgba(133, 221, 118, 0.78);
}

.super-lite-progress {
  display: block;
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(74, 91, 120, 0.48);
}

.super-lite-progress i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: rgba(84, 180, 255, 0.88);
}

.super-lite-row--memory .super-lite-progress i {
  background: rgba(133, 221, 118, 0.88);
}

.super-lite-detail {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  flex-direction: column;
  gap: 8px;
  padding-top: 6px;
}

.super-lite-back {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0;
  background: transparent;
  font-size: 12px;
}

.super-lite-detail dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 7px 10px;
  margin: 0;
  padding: 8px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.045);
  font-size: 10px;
}

.super-lite-detail dt {
  color: rgba(207, 220, 240, 0.68);
}

.super-lite-detail dd {
  margin: 0;
  overflow: hidden;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.super-lite-footer {
  height: 20px;
  gap: 5px;
  color: rgba(208, 219, 238, 0.78);
  font-size: 9px;
}

.super-lite-footer span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
