<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{
  icon: Component
  title: string
}>()
</script>

<template>
  <div class="card-header">
    <component :is="icon" theme="outline" size="20" fill="var(--el-color-primary)" :strokeWidth="3" class="header-icon" />
    <span class="title">{{ title }}</span>
  </div>
</template>

<style scoped lang="less">
.card-header {
  display: flex;
  align-items: center;
  margin-bottom: 16px;

  .header-icon {
    margin-right: 8px;
  }

  .title {
    font-size: 16px;
    font-weight: 500;
    color: var(--el-text-color-primary);
  }
}
</style>
