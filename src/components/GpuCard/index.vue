<script setup lang="ts">
import { GraphicDesign } from '@icon-park/vue-next'

defineProps({
  data: {
    type: Array as () => GpuData[],
    default: () => [],
  },
})

const formatMemory = (bytes: number) => {
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB'
}

const getMemoryUsage = (gpu: GpuData) => {
  return Math.round((gpu.memoryUsed / gpu.memoryTotal) * 100)
}

const getUsageColor = (percentage: number) => {
  if (percentage < 60) return '#67C23A'
  if (percentage < 80) return '#E6A23C'
  return '#F56C6C'
}

const format = (percentage: number) => `${percentage}%`
</script>

<template>
  <div class="gpu-card">
    <div class="card-header">
      <GraphicDesign theme="outline" size="20" fill="var(--el-color-primary)" :strokeWidth="3" />
      <span class="title">显卡信息</span>
    </div>

    <div class="gpu-list">
      <template v-if="data && data.length">
        <div v-for="(gpu, index) in data" :key="index" class="gpu-item">
          <div class="gpu-name">
            <span class="label">显卡 {{ index + 1 }}</span>
            <span class="value">{{ gpu.name }}</span>
          </div>

          <div class="info-grid">
            <div class="info-item">
              <div class="label">显存</div>
              <div class="value">{{ formatMemory(gpu.memoryTotal) }}</div>
            </div>

            <div class="info-item">
              <div class="label">显存使用率</div>
              <div class="value">
                <el-progress :percentage="getMemoryUsage(gpu)" :color="getUsageColor(getMemoryUsage(gpu))" :format="format" />
              </div>
            </div>

            <div class="info-item">
              <div class="label">核心频率</div>
              <div class="value">{{ gpu.clockCore }} MHz</div>
            </div>

            <div class="info-item">
              <div class="label">显存频率</div>
              <div class="value">{{ gpu.clockMemory }} MHz</div>
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

    .el-icon {
      font-size: 20px;
      color: var(--el-color-primary);
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

          :deep(.el-progress) {
            margin-top: 4px;
          }
        }
      }
    }
  }
}
</style>
