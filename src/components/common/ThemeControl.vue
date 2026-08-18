<script setup lang="ts">
import { computed } from 'vue'
import { appThemeStore, setAppThemePreference } from '../../composables/useAppTheme'

const props = withDefaults(defineProps<{
  compact?: boolean
}>(), {
  compact: false,
})

const options: Array<{ value: AppThemePreference; label: string; title: string }> = [
  { value: 'system', label: '系统', title: '跟随系统明暗模式' },
  { value: 'light', label: '浅色', title: '始终使用浅色模式' },
  { value: 'dark', label: '深色', title: '始终使用深色模式' },
]

const rootClass = computed(() => [
  'theme-control',
  { 'theme-control--compact': props.compact },
])
</script>

<template>
  <div :class="rootClass" aria-label="外观主题">
    <div class="theme-control__label">
      <span>外观</span>
      <small v-if="!compact">{{ appThemeStore.preference.value === 'system' ? '跟随系统' : appThemeStore.preference.value === 'light' ? '浅色模式' : '深色模式' }}</small>
    </div>

    <div class="theme-control__options" role="group" aria-label="选择明暗模式">
      <button
        v-for="option in options"
        :key="option.value"
        type="button"
        :title="option.title"
        :aria-pressed="appThemeStore.preference.value === option.value"
        :class="['theme-control__option', { 'theme-control__option--active': appThemeStore.preference.value === option.value }]"
        @click="setAppThemePreference(option.value)"
      >
        {{ option.label }}
      </button>
    </div>
  </div>
</template>

<style scoped lang="less">
.theme-control {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--panel-border-soft);
  border-radius: 12px;
  background: var(--frame-bg);
  -webkit-app-region: no-drag;
}

.theme-control__label {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 0 2px;
}

.theme-control__label span {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 800;
}

.theme-control__label small {
  color: var(--text-subtle);
  font-size: 10px;
  font-weight: 600;
}

.theme-control__options {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 3px;
  min-width: 0;
  padding: 3px;
  border: 1px solid var(--control-border);
  border-radius: 9px;
  background: var(--control-bg-soft);
}

.theme-control__option {
  min-width: 0;
  height: 26px;
  padding: 0 7px;
  border-radius: 6px;
  color: var(--text-subtle);
  font-size: 10px;
  font-weight: 800;
  cursor: pointer;
  transition: background 0.16s ease, color 0.16s ease, box-shadow 0.16s ease;
}

.theme-control__option:hover {
  color: var(--text-primary);
  background: var(--control-bg);
}

.theme-control__option--active {
  background: var(--control-active-bg);
  color: var(--text-primary);
  box-shadow: var(--control-active-shadow);
}

.theme-control--compact {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding: 0;
  border: 0;
  background: transparent;
}

.theme-control--compact .theme-control__label {
  padding: 0;
}

.theme-control--compact .theme-control__label span {
  color: var(--text-muted);
  font-size: 11px;
}

.theme-control--compact .theme-control__options {
  width: 120px;
  background: var(--frame-bg);
}

.theme-control--compact .theme-control__option {
  height: 24px;
  padding: 0 5px;
  font-size: 9px;
}
</style>
