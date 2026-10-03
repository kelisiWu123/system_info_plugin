<script setup lang="ts">
const props = defineProps<{
  label: string
  value: string
  unit?: string
  accent: string
  percent: number
  points: string
  footerLeft?: string
  footerRight?: string
  unavailable?: boolean
}>()
function ringStyle() {
  const percent = Math.max(0, Math.min(100, props.percent))
  return { background: `conic-gradient(${props.accent} 0deg ${percent * 3.6}deg, var(--gauge-track) ${percent * 3.6}deg 360deg)` }
}
</script>

<template>
  <article class="hardware-metric" :class="{ 'hardware-metric--unavailable': unavailable }">
    <div class="hardware-metric__label">{{ label }}</div>
    <div v-if="!unavailable" class="hardware-metric__ring" :style="ringStyle()">
      <div class="hardware-metric__ring-inner">
        <strong>{{ value }}</strong>
        <span v-if="unit">{{ unit }}</span>
      </div>
    </div>
    <div v-else class="hardware-metric__plain">
      <strong>{{ value }}</strong>
      <span v-if="unavailable">暂无可用读数</span>
    </div>
    <svg v-if="!unavailable" class="hardware-metric__sparkline" viewBox="0 0 116 34" preserveAspectRatio="none" aria-hidden="true">
      <polyline :points="points" :stroke="accent" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
    <div v-if="!unavailable && (footerLeft || footerRight)" class="hardware-metric__foot">
      <span>{{ footerLeft }}</span>
      <span>{{ footerRight }}</span>
    </div>
  </article>
</template>

<style scoped>
.hardware-metric {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
  min-width: 0;
  padding: 8px 10px 10px;
  border-left: 1px solid var(--panel-border-soft);
}
.hardware-metric:first-child { border-left: 0; }
.hardware-metric__label { color: var(--text-secondary); font-size: 13px; font-weight: 600; text-align: center; }
.hardware-metric__ring { display: grid; place-items: center; width: 106px; height: 106px; margin: 0 auto; border-radius: 50%; }
.hardware-metric__ring-inner { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 84px; height: 84px; border-radius: 50%; background: var(--panel-background-strong); }
.hardware-metric__ring-inner strong { color: var(--text-primary); font-size: 16px; font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; }
.hardware-metric__ring-inner span { color: var(--text-muted); font-size: 12px; }
.hardware-metric__plain { display: flex; flex: 1; min-height: 106px; flex-direction: column; align-items: center; justify-content: center; gap: 8px; text-align: center; }
.hardware-metric__plain strong { color: var(--text-secondary); font-size: 14px; font-weight: 600; }
.hardware-metric__plain span { color: var(--text-subtle); font-size: 12px; }
.hardware-metric--unavailable .hardware-metric__plain strong { color: var(--text-muted); }
.hardware-metric__sparkline { width: 100%; height: 34px; }
.hardware-metric__foot { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 4px 8px; color: var(--text-muted); font-size: 12px; }
.hardware-metric__foot span { white-space: nowrap; }
</style>
