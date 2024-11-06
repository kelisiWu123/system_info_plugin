<script setup lang="ts">
import { GraphicDesign } from '@icon-park/vue-next'

defineProps({
  data: {
    type: Array as () => GpuData[],
    default: () => [],
  },
})

const formatMemory = (bytes: number) => {
  if (!bytes) return '0 GB'
  return (bytes / 1024).toFixed(1) + ' GB'
}
</script>

<template>
  <div class="gpu-card">
    <div class="card-header">
      <GraphicDesign theme="outline" size="20" fill="var(--el-color-primary)" :strokeWidth="3" class="header-icon" />
      <span class="title">显卡信息</span>
    </div>

    <div class="gpu-list">
      <template v-if="data && data.length">
        <div v-for="(gpu, index) in data" :key="index" class="gpu-item">
          <div class="gpu-name">
            <span class="label">显卡 {{ index + 1 }}</span>
            <span class="value">{{ gpu.model }}</span>
          </div>

          <div class="info-grid">
            <div class="info-item">
              <div class="label">显存大小</div>
              <div class="value">{{ formatMemory(gpu.vram) }}</div>
            </div>

            <div class="info-item">
              <div class="label">总线接口</div>
              <div class="value">{{ gpu.bus }}</div>
            </div>
          </div>
        </div>
      </template>
      <el-empty v-else description="未检测到显卡设备" />
    </div>
  </div>
</template>

<style scoped lang="less">
.gpu-card {
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

  .gpu-list {
    .gpu-item {
      &:not(:last-child) {
        margin-bottom: 16px;
        padding-bottom: 16px;
        border-bottom: 1px solid var(--el-border-color-lighter);
      }

      .gpu-name {
        margin-bottom: 12px;

        .label {
          font-size: 13px;
          color: var(--el-text-color-secondary);
          margin-right: 8px;
        }

        .value {
          font-size: 14px;
          font-weight: 500;
          color: var(--el-text-color-primary);
        }
      }

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
          }
        }
      }
    }
  }
}
</style>
