<script setup lang="ts">
import { onBeforeUnmount, onMounted, computed } from 'vue'
import { Memory, GraphicDesign } from '@icon-park/vue-next'

const props = defineProps({
  data: {
    type: Object as () => MemoData,
    default: {
      active: 0,
      total: 0,
      available: 0,
    } satisfies MemoData,
  },
  memoLayoutData: {
    type: Array as () => MemoLayoutData[],
    default: () => [],
    required: true,
  },
  gpuData: {
    type: Array as () => GpuData[],
    default: () => [],
  },
  title: {
    type: String,
    default: '',
  },
  loading: {
    type: Boolean,
    default: false,
  },
  queryMemo: {
    type: Function,
  },
})
let timerId: NodeJS.Timeout
onMounted(() => {
  timerId = setInterval(() => {
    props.queryMemo?.()
  }, 2000)
})
onBeforeUnmount(() => {
  clearInterval(timerId)
})

const usagePercentage = computed(() => {
  return Math.round((props.data.active / props.data.total) * 100)
})

const progressColor = computed(() => {
  const percentage = usagePercentage.value
  if (percentage < 60) return '#67C23A'
  if (percentage < 80) return '#E6A23C'
  return '#F56C6C'
})

function formatMemory(bytes: number) {
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB'
}

const formatGpuMemory = (bytes: number) => {
  if (!bytes) return '0 GB'
  return (bytes / 1024).toFixed(1) + ' GB'
}
</script>
<template>
  <div class="memo-card">
    <div class="section memory-section">
      <div class="section-header">
        <Memory theme="outline" size="20" fill="var(--el-color-primary)" :strokeWidth="3" />
        <span class="title">内存信息</span>
      </div>

      <div class="memory-usage">
        <el-progress type="dashboard" :percentage="usagePercentage" :color="progressColor" :width="80">
          <template #default="{ percentage }">
            <div class="progress-label">
              <span class="value">{{ percentage }}%</span>
              <span class="label">使用率</span>
            </div>
          </template>
        </el-progress>

        <div class="memory-stats">
          <div class="stat-item">
            <span class="label">总内存</span>
            <span class="value">{{ formatMemory(props.data.total) }}</span>
          </div>
          <div class="stat-item">
            <span class="label">已使用</span>
            <span class="value">{{ formatMemory(props.data.active) }}</span>
          </div>
          <div class="stat-item">
            <span class="label">可用</span>
            <span class="value">{{ formatMemory(props.data.available) }}</span>
          </div>
        </div>
      </div>

      <div class="memory-details" v-if="props.memoLayoutData?.length">
        <el-collapse>
          <el-collapse-item title="内存详细信息">
            <div class="detail-item" v-for="(item, index) in props.memoLayoutData" :key="index">
              <div class="label">插槽 {{ index + 1 }}</div>
              <div class="value">{{ item.manufacturer }} {{ formatMemory(item.size) }} {{ item.type }} {{ item.clockSpeed }}MHz</div>
            </div>
          </el-collapse-item>
        </el-collapse>
      </div>
    </div>

    <div class="section gpu-section">
      <div class="section-header">
        <GraphicDesign theme="outline" size="20" fill="var(--el-color-primary)" :strokeWidth="3" />
        <span class="title">显卡信息</span>
      </div>

      <div class="gpu-list">
        <template v-if="gpuData && gpuData.length">
          <div v-for="(gpu, index) in gpuData" :key="index" class="gpu-item">
            <div class="gpu-info">
              <div class="gpu-name">{{ gpu.model }}</div>
              <div class="gpu-details">
                <span class="detail-item">{{ gpu.bus }}</span>
                <span class="divider">|</span>
                <span class="detail-item">{{ formatGpuMemory(gpu.vram) }} 显存</span>
              </div>
            </div>
          </div>
        </template>
        <el-empty v-else description="未检测到显卡设备" />
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
.memo-card {
  .section {
    margin-bottom: 20px;

    &:last-child {
      margin-bottom: 0;
    }

    .section-header {
      display: flex;
      align-items: center;
      margin-bottom: 16px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--el-border-color-lighter);

      .title {
        font-size: 16px;
        font-weight: 500;
        margin-left: 8px;
      }
    }
  }

  .memory-usage {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;

    .progress-label {
      display: flex;
      flex-direction: column;
      align-items: center;

      .value {
        font-size: 20px;
        font-weight: 500;
        line-height: 1;
      }

      .label {
        font-size: 12px;
        color: var(--el-text-color-secondary);
        margin-top: 4px;
      }
    }

    .memory-stats {
      flex: 1;
      margin-left: 24px;

      .stat-item {
        display: flex;
        justify-content: space-between;
        margin-bottom: 8px;

        .label {
          color: var(--el-text-color-secondary);
          font-size: 13px;
        }

        .value {
          font-weight: 500;
          font-size: 13px;
        }
      }
    }
  }

  .gpu-section {
    .gpu-list {
      .gpu-item {
        padding: 12px;
        background: var(--el-bg-color-page);
        border-radius: 8px;

        &:not(:last-child) {
          margin-bottom: 12px;
        }

        .gpu-info {
          .gpu-name {
            font-size: 14px;
            font-weight: 500;
            color: var(--el-text-color-primary);
            margin-bottom: 4px;
          }

          .gpu-details {
            font-size: 12px;
            color: var(--el-text-color-secondary);

            .detail-item {
              display: inline-block;
            }

            .divider {
              margin: 0 8px;
              color: var(--el-border-color);
            }
          }
        }
      }
    }
  }

  .memory-details {
    margin-top: 16px;

    :deep(.el-collapse-item__header) {
      font-size: 13px;
      color: var(--el-text-color-secondary);
    }

    .detail-item {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
      font-size: 13px;

      .label {
        color: var(--el-text-color-secondary);
      }

      .value {
        font-weight: 500;
      }
    }
  }
}
</style>
