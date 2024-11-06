<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { Cpu } from '@icon-park/vue-next'
import CardHeader from '../CardHeader/index.vue'

defineProps({
  data: {
    type: Object as () => CpuData | undefined,
    default: undefined,
  },
  title: {
    type: String,
    default: '',
  },
})

const cpu_fullLoad = ref<number>(0)

const getCpuFullLoad = async () => {
  cpu_fullLoad.value = await window.services.getCpuFullLoad()
}

const getCpuLoadColor = (percentage: number) => {
  if (percentage < 60) return '#67C23A'
  if (percentage < 80) return '#E6A23C'
  return '#F56C6C'
}

const format = (percentage: number) => `${percentage}%`

let cpuTimerId: NodeJS.Timeout
onMounted(() => {
  cpuTimerId = setInterval(() => {
    getCpuFullLoad()
  }, 1000)
})
onUnmounted(() => {
  clearInterval(cpuTimerId)
})
</script>

<template>
  <div class="cpu-card">
    <CardHeader :icon="Cpu" title="处理器信息" />

    <div class="info-grid">
      <div class="info-item">
        <div class="label">处理器</div>
        <div class="value">{{ data?.manufacturer }} {{ data?.brand }}</div>
      </div>

      <div class="info-item">
        <div class="label">核心数</div>
        <div class="value">{{ data?.physicalCores }} 物理核心 / {{ data?.cores }} 逻辑核心</div>
      </div>

      <div class="info-item">
        <div class="label">CPU使用率</div>
        <div class="value">
          <el-progress :percentage="cpu_fullLoad" :color="getCpuLoadColor(cpu_fullLoad)" :format="format" />
        </div>
      </div>

      <div class="info-item">
        <div class="label">基准频率</div>
        <div class="value">{{ data?.speed?.toFixed(2) }} GHz</div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
.cpu-card {
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

        :deep(.el-progress) {
          margin-top: 4px;
        }
      }
    }
  }
}
</style>
