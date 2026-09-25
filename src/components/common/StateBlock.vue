<script setup lang="ts">
import { Attention, Info, Plus } from '@icon-park/vue-next'

withDefaults(defineProps<{
  variant: 'loading' | 'empty' | 'error' | 'soon'
  title: string
  description?: string
  actionLabel?: string
}>(), {
  description: '',
  actionLabel: '',
})

defineEmits<{
  retry: []
}>()
</script>

<template>
  <section
    :class="['state-block', `state-block--${variant}`]"
    :role="variant === 'error' ? 'alert' : 'status'"
    :aria-live="variant === 'error' ? 'assertive' : 'polite'"
    :aria-busy="variant === 'loading'"
  >
    <div class="state-block__mark" aria-hidden="true">
      <span v-if="variant === 'loading'" class="state-block__spinner"></span>
      <Attention v-else-if="variant === 'error'" theme="outline" size="18" fill="currentColor" :strokeWidth="3" />
      <Plus v-else-if="variant === 'soon'" theme="outline" size="18" fill="currentColor" :strokeWidth="3" />
      <Info v-else theme="outline" size="18" fill="currentColor" :strokeWidth="3" />
    </div>

    <div class="state-block__copy">
      <h3>{{ title }}</h3>
      <p v-if="description">{{ description }}</p>
    </div>

    <button
      v-if="actionLabel"
      type="button"
      class="state-block__action"
      :disabled="variant === 'loading'"
      @click="$emit('retry')"
    >
      {{ variant === 'loading' ? '读取中…' : actionLabel }}
    </button>
  </section>
</template>

<style scoped lang="less">
.state-block {
  display: grid;
  place-items: center;
  align-content: center;
  gap: 12px;
  min-height: 280px;
  padding: 28px;
  border: 1px solid var(--panel-border);
  border-radius: var(--surface-radius);
  background: var(--surface-card-background);
  box-shadow: var(--panel-shadow);
  text-align: center;
}

.state-block__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border: 1px solid var(--panel-border-soft);
  border-radius: 50%;
  background: var(--surface-soft-background);
  color: var(--accent-cyan);
  font-size: 18px;
  font-weight: 800;
}

.state-block--error .state-block__mark {
  color: var(--accent-danger);
}

.state-block--soon .state-block__mark {
  color: var(--accent-yellow);
}

.state-block__spinner {
  display: inline-block;
  box-sizing: border-box;
  width: 22px;
  height: 22px;
  border: 2px solid color-mix(in srgb, currentColor 18%, transparent);
  border: 2.5px solid rgba(107, 194, 255, 0.22);
  border-top-color: var(--accent-cyan, #6bc2ff);
  border-radius: 50%;
  -webkit-animation: state-block-spin 0.8s linear infinite;
  animation: state-block-spin 0.8s linear infinite;
  transform-origin: center center;
  will-change: transform;
}

.state-block__copy {
  h3 {
    margin: 0;
    color: var(--text-primary);
    font-size: 17px;
    font-weight: 800;
  }

  p {
    max-width: 460px;
    margin: 8px 0 0;
    color: var(--text-muted);
    font-size: 13px;
    line-height: 1.6;
  }
}

.state-block__action {
  min-height: var(--control-height);
  padding: 0 14px;
  border: 1px solid var(--button-primary-border);
  border-radius: var(--control-radius);
  background: var(--button-primary-bg);
  color: var(--button-primary-fg);
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
}

.state-block__action:disabled {
  cursor: wait;
  opacity: 0.62;
}

@-webkit-keyframes state-block-spin {
  0% {
    -webkit-transform: rotate(0deg);
    transform: rotate(0deg);
  }
  100% {
    -webkit-transform: rotate(360deg);
    transform: rotate(360deg);
  }
}

@keyframes state-block-spin {
  0% {
    -webkit-transform: rotate(0deg);
    transform: rotate(0deg);
  }
  100% {
    -webkit-transform: rotate(360deg);
    transform: rotate(360deg);
  }
}
</style>
