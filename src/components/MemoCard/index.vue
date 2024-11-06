<script setup lang="ts">
import { bytesToGB } from '../../utils.ts'
import { onBeforeUnmount, onMounted, computed } from 'vue'
import { MemoryOne } from '@icon-park/vue-next'

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
    type: Object as () => MemoLayoutData[] | undefined,
    default: undefined,
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
</script>
<template>
  <div class="memo-card">
    <div class="card-header">
      <el-icon><MemoryOne /></el-icon>
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

    <div class="memory-details" v-if="props.memoLayoutData.length">
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
</template>

<style scoped lang="less">
.memo-card {
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

  .memory-details {
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
