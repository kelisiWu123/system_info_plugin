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

const formatGpuValue = (value: number | null | undefined, unit = '') => {
  if (value === null || value === undefined) return '未暴露'
  return `${Number(value).toFixed(value % 1 === 0 ? 0 : 1)}${unit}`
}

const gpuMemoryUsage = (gpu: GpuData) => {
  const total = gpu.memoryTotal || gpu.vram || 0
  const used = gpu.memoryUsed || 0

  if (!total || !used) return 0
  return Math.min(100, Math.round((used / total) * 100))
}

const gpuLoadColor = (percentage: number) => {
  if (percentage < 55) return '#8fff65'
  if (percentage < 80) return '#ffb020'
  return '#ff3f3f'
}

const gpuName = (gpu: GpuData) => gpu.name || gpu.model || '未知显卡'
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
            <div class="gpu-topline">
              <div class="gpu-title">
                <span class="gpu-index">GPU {{ index + 1 }}</span>
                <span class="gpu-name">{{ gpuName(gpu) }}</span>
              </div>
              <div class="gpu-temp">{{ formatGpuValue(gpu.temperatureGpu, ' ℃') }}</div>
            </div>

            <div class="gpu-bars">
              <div class="gpu-bar">
                <div class="bar-label">
                  <span>GPU Load</span>
                  <span>{{ formatGpuValue(gpu.utilizationGpu, '%') }}</span>
                </div>
                <el-progress :percentage="gpu.utilizationGpu || 0" :color="gpuLoadColor(gpu.utilizationGpu || 0)" :show-text="false" />
              </div>
              <div class="gpu-bar">
                <div class="bar-label">
                  <span>Memory</span>
                  <span>{{ formatGpuMemory(gpu.memoryUsed || 0) }} / {{ formatGpuMemory(gpu.memoryTotal || gpu.vram) }}</span>
                </div>
                <el-progress :percentage="gpuMemoryUsage(gpu)" :color="gpuLoadColor(gpuMemoryUsage(gpu))" :show-text="false" />
              </div>
            </div>

            <div class="gpu-metrics">
              <div class="metric">
                <span class="metric-label">显存类型</span>
                <span class="metric-value">{{ gpu.vramDynamic ? '动态共享' : '独立显存' }}</span>
              </div>
              <div class="metric">
                <span class="metric-label">功耗</span>
                <span class="metric-value">{{ formatGpuValue(gpu.powerDraw, ' W') }}</span>
              </div>
              <div class="metric">
                <span class="metric-label">核心频率</span>
                <span class="metric-value">{{ formatGpuValue(gpu.clockCore, ' MHz') }}</span>
              </div>
              <div class="metric">
                <span class="metric-label">显存频率</span>
                <span class="metric-value">{{ formatGpuValue(gpu.clockMemory, ' MHz') }}</span>
              </div>
              <div class="metric">
                <span class="metric-label">总线</span>
                <span class="metric-value">{{ gpu.bus || gpu.pciBus || '未知' }}</span>
              </div>
              <div class="metric">
                <span class="metric-label">驱动</span>
                <span class="metric-value">{{ gpu.driverVersion || '未知' }}</span>
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
        border: 1px solid rgba(255, 255, 255, 0.07);
        border-radius: 6px;
        background:
          linear-gradient(180deg, rgba(255, 45, 45, 0.11), rgba(255, 255, 255, 0.018)),
          rgba(255, 255, 255, 0.035);

        &:not(:last-child) {
          margin-bottom: 12px;
        }

        .gpu-topline {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 12px;
        }

        .gpu-title {
          min-width: 0;
        }

        .gpu-index {
          display: block;
          margin-bottom: 3px;
          color: #ff5a5a;
          font-family: 'SF Mono', Consolas, 'Cascadia Mono', monospace;
          font-size: 11px;
          font-weight: 850;
          text-transform: uppercase;
        }

        .gpu-name {
          display: block;
          overflow: hidden;
          color: var(--el-text-color-primary);
          font-size: 14px;
          font-weight: 800;
          line-height: 1.25;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .gpu-temp {
          flex: 0 0 auto;
          min-width: 58px;
          padding: 5px 8px;
          border: 1px solid rgba(255, 45, 45, 0.35);
          border-radius: 4px;
          background: rgba(255, 45, 45, 0.14);
          color: #ffffff;
          font-family: 'SF Mono', Consolas, 'Cascadia Mono', monospace;
          font-size: 14px;
          font-weight: 850;
          text-align: center;
        }

        .gpu-bars {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin-bottom: 12px;
        }

        .bar-label {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 5px;
          color: var(--el-text-color-secondary);
          font-size: 11px;
          font-weight: 750;
        }

        .gpu-metrics {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
        }

        .metric {
          min-width: 0;
          padding: 8px;
          border: 1px solid rgba(255, 255, 255, 0.055);
          border-radius: 4px;
          background: rgba(0, 0, 0, 0.18);
        }

        .metric-label {
          display: block;
          margin-bottom: 3px;
          color: var(--el-text-color-secondary);
          font-size: 11px;
          font-weight: 700;
        }

        .metric-value {
          display: block;
          overflow: hidden;
          color: var(--el-text-color-primary);
          font-family: 'SF Mono', Consolas, 'Cascadia Mono', monospace;
          font-size: 12px;
          font-weight: 800;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        @media (max-width: 520px) {
          .gpu-bars,
          .gpu-metrics {
            grid-template-columns: 1fr;
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
