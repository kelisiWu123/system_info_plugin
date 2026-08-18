<script setup lang="ts">
defineProps<{
  accent?: string
  border?: string
  sideWidth?: string
  tone?: 'cpu' | 'gpu' | 'memory'
}>()
</script>

<template>
  <section
    :class="['watch-metric-card', tone ? `watch-metric-card--${tone}` : '']"
    :style="{
      '--watch-card-accent': accent,
      '--watch-card-border': border,
      '--watch-card-strong': accent,
      '--watch-card-side-width': sideWidth,
    }"
  >
    <div class="watch-metric-card__icon">
      <slot name="icon" />
    </div>

    <div class="watch-metric-card__main">
      <div class="watch-metric-card__copy">
        <strong class="watch-metric-card__title">
          <slot name="title" />
        </strong>
        <span class="watch-metric-card__subtitle">
          <slot name="subtitle" />
        </span>
      </div>

      <div class="watch-metric-card__value">
        <slot name="value" />
      </div>

      <div class="watch-metric-card__chart">
        <slot name="chart" />
      </div>

      <div class="watch-metric-card__bar">
        <slot name="bar" />
      </div>
    </div>

    <aside class="watch-metric-card__side">
      <slot name="side" />
    </aside>
  </section>
</template>

<style scoped lang="less">
.watch-metric-card {
  --watch-card-accent: #35b6ff;
  --watch-card-border: rgba(102, 124, 161, 0.28);
  --watch-card-icon-bg: var(--watch-muted-surface);
  --watch-card-side-width: 82px;
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) var(--watch-card-side-width);
  align-items: stretch;
  gap: 8px;
  min-height: 82px;
  padding: 7px 10px;
  border: 1px solid var(--watch-card-border);
  border-radius: 8px;
  background: var(--watch-card-background);
  box-shadow:
    inset 0 1px 0 var(--surface-inset-highlight),
    var(--shadow-watch);
}

.watch-metric-card--cpu {
  --watch-card-accent: #a775ff;
  --watch-card-border: rgba(167, 117, 255, 0.34);
}

.watch-metric-card--gpu {
  --watch-card-accent: #79e7ff;
  --watch-card-border: rgba(121, 231, 255, 0.40);
}

.watch-metric-card--memory {
  --watch-card-accent: #79d84f;
  --watch-card-border: rgba(121, 216, 79, 0.34);
}

.watch-metric-card__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  align-self: center;
  border-radius: 8px;
  background: var(--watch-card-icon-background);
  box-shadow: inset 0 1px 0 var(--surface-inset-highlight);
}

.watch-metric-card__main {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  grid-template-rows: auto auto auto;
  align-items: end;
  column-gap: 8px;
  row-gap: 3px;
  min-width: 0;
}

.watch-metric-card__copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.watch-metric-card__title {
  color: var(--text-watch);
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
}

.watch-metric-card__subtitle {
  color: var(--text-watch-muted);
  font-size: 10px;
  line-height: 1.2;
}

.watch-metric-card__value {
  grid-column: 1;
  color: var(--text-watch);
  font-size: 20px;
  font-weight: 700;
  line-height: 1;
}

.watch-metric-card__chart {
  grid-column: 2;
  grid-row: 1 / span 2;
  min-width: 0;
  align-self: stretch;
}

.watch-metric-card__bar {
  grid-column: 1 / span 2;
  min-width: 0;
}

.watch-metric-card__side {
  display: grid;
  align-content: center;
  gap: 7px;
  min-width: 0;
  padding-left: 10px;
  border-left: 1px solid var(--panel-border-soft);
}
</style>
