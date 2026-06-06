<script setup lang="ts">
defineProps<{
  tone?: 'cpu' | 'gpu' | 'memory'
}>()
</script>

<template>
  <section :class="['watch-metric-card', tone ? `watch-metric-card--${tone}` : '']">
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
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr) 112px;
  align-items: stretch;
  gap: 12px;
  min-height: 94px;
  padding: 12px 14px;
  border: 1px solid rgba(102, 124, 161, 0.28);
  border-radius: 18px;
  background:
    linear-gradient(180deg, rgba(22, 34, 53, 0.94), rgba(17, 27, 42, 0.94)),
    rgba(17, 27, 42, 0.94);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.04),
    0 16px 30px rgba(1, 7, 18, 0.28);
}

.watch-metric-card--cpu {
  border-color: rgba(67, 176, 255, 0.34);
}

.watch-metric-card--gpu {
  border-color: rgba(121, 214, 82, 0.34);
}

.watch-metric-card--memory {
  border-color: rgba(157, 113, 255, 0.34);
}

.watch-metric-card__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  align-self: center;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.04);
}

.watch-metric-card__main {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr);
  grid-template-rows: auto auto auto;
  align-items: end;
  column-gap: 12px;
  row-gap: 6px;
  min-width: 0;
}

.watch-metric-card__copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.watch-metric-card__title {
  color: #f5f8ff;
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
}

.watch-metric-card__subtitle {
  color: rgba(190, 202, 222, 0.78);
  font-size: 9px;
  line-height: 1.2;
}

.watch-metric-card__value {
  grid-column: 1;
  color: #ffffff;
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
  gap: 10px;
  min-width: 0;
  padding-left: 12px;
  border-left: 1px solid rgba(96, 115, 146, 0.24);
}
</style>
