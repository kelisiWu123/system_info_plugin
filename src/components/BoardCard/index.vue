<script setup lang="ts">
import { Chip } from '@icon-park/vue-next'
import CardHeader from '../CardHeader/index.vue'

defineProps({
  data: {
    type: Object as () => BoardData | undefined,
    default: undefined,
  },
})
</script>

<template>
  <div class="board-card">
    <CardHeader :icon="Chip" title="主板信息" />

    <div class="info-grid">
      <div class="info-item">
        <div class="label">制造商</div>
        <div class="value">{{ data?.manufacturer }}</div>
      </div>

      <div class="info-item">
        <div class="label">型号</div>
        <div class="value">{{ data?.model }}</div>
      </div>

      <div class="info-item">
        <div class="label">序列号</div>
        <div class="value">{{ data?.serial || '未知' }}</div>
      </div>

      <div class="info-item">
        <div class="label">BIOS版本</div>
        <div class="value">{{ data?.version }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
.board-card {
  .info-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;

    .info-item {
      .label {
        font-size: 12px;
        color: var(--el-text-color-secondary);
        margin-bottom: 4px;
      }

      .value {
        font-size: 14px;
        color: var(--el-text-color-primary);
        font-weight: 500;
        word-break: break-all;
      }
    }
  }
}
</style>
