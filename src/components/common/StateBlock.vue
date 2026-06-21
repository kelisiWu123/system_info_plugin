<script setup lang="ts">
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
  <section :class="['state-block', `state-block--${variant}`]" role="status" aria-live="polite">
    <div class="state-block__mark" aria-hidden="true">
      <span v-if="variant === 'loading'" class="state-block__spinner"></span>
      <span v-else-if="variant === 'error'">!</span>
      <span v-else-if="variant === 'soon'">+</span>
      <span v-else>i</span>
    </div>

    <div class="state-block__copy">
      <h3>{{ title }}</h3>
      <p v-if="description">{{ description }}</p>
    </div>

    <button
      v-if="actionLabel"
      type="button"
      class="state-block__action"
      @click="$emit('retry')"
    >
      {{ actionLabel }}
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
  background:
    linear-gradient(180deg, rgba(21, 31, 44, 0.98), rgba(17, 25, 35, 0.98)),
    radial-gradient(circle at top left, rgba(66, 128, 240, 0.08), transparent 28%);
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
  background: rgba(255, 255, 255, 0.035);
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
  width: 18px;
  height: 18px;
  border: 2px solid rgba(255, 255, 255, 0.16);
  border-top-color: currentColor;
  border-radius: 50%;
  animation: state-block-spin 0.8s linear infinite;
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

@keyframes state-block-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
