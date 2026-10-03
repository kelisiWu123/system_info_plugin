<script setup lang="ts">
import { Chip, Cpu, GraphicDesign, HardDisk, Memory } from '@icon-park/vue-next'
import { computed } from 'vue'

const props = defineProps<{
  kind: 'cpu' | 'gpu' | 'memory' | 'board' | 'storage'
  label?: string
}>()
const icons = { cpu: Cpu, gpu: GraphicDesign, memory: Memory, board: Chip, storage: HardDisk }
const labels = { cpu: 'CPU', gpu: 'GPU', memory: 'RAM', board: '主板', storage: '存储' }
const icon = computed(() => icons[props.kind])
</script>

<template>
  <div class="hardware-identity" :class="`hardware-identity--${kind}`" aria-hidden="true">
    <component :is="icon" theme="outline" size="38" :stroke-width="1.5" />
    <span>{{ label || labels[kind] }}</span>
  </div>
</template>

<style scoped>
.hardware-identity {
  display: flex;
  flex: 0 0 88px;
  width: 88px;
  height: 82px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 1px solid var(--panel-border-soft);
  border-radius: var(--icon-radius);
  background: var(--surface-soft-background);
  color: var(--accent-blue);
}
.hardware-identity--gpu { color: var(--accent-green); }
.hardware-identity--memory { color: var(--accent-purple); }
.hardware-identity--board { color: var(--accent-yellow); }
.hardware-identity--storage { color: var(--accent-yellow); }
.hardware-identity > span:last-child {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
}
</style>
