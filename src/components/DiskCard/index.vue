<script setup lang="ts">
import { bytesToGB } from '../../utils.ts'
import { HardDisk } from '@icon-park/vue-next'

defineProps({
  data: {
    type: Array as () => DiskData[],
    default: () => [],
  },
})

const formatSize = (bytes: number) => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = bytes
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`
}

const getDiskUsage = (disk: DiskData) => {
  return Math.round((disk.used / disk.size) * 100)
}

const getUsageColor = (percentage: number) => {
  if (percentage < 60) return '#67C23A'
  if (percentage < 80) return '#E6A23C'
  return '#F56C6C'
}
</script>

<template>
  <div class="disk-card">
    <div class="card-header">
      <HardDisk theme="outline" size="20" fill="var(--el-color-primary)" :strokeWidth="3" />
      <span class="title">硬盘信息</span>
    </div>

    <div class="disk-list">
      <template v-if="data && data.length">
        <div v-for="(disk, index) in data" :key="index" class="disk-item">
          <div class="disk-name">
            <span class="label">{{ disk.name }}</span>
            <span class="mount">{{ disk.mount }}</span>
          </div>

          <div class="disk-usage">
            <el-progress :percentage="getDiskUsage(disk)" :color="getUsageColor(getDiskUsage(disk))" :format="(val) => `${formatSize(disk.used)} / ${formatSize(disk.size)} (${val}%)`" />
          </div>

          <div class="disk-info">
            <div class="info-item">
              <span class="label">类型</span>
              <span class="value">{{ disk.type }}</span>
            </div>
            <div class="info-item">
              <span class="label">剩余空间</span>
              <span class="value">{{ formatSize(disk.available) }}</span>
            </div>
          </div>
        </div>
      </template>
      <el-empty v-else description="未检测到硬盘设备" />
    </div>
  </div>
</template>

<style scoped lang="less">
.disk-card {
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

  .disk-list {
    .disk-item {
      &:not(:last-child) {
        margin-bottom: 16px;
        padding-bottom: 16px;
        border-bottom: 1px solid var(--el-border-color-lighter);
      }

      .disk-name {
        display: flex;
        align-items: center;
        margin-bottom: 8px;

        .label {
          font-size: 14px;
          font-weight: 500;
          color: var(--el-text-color-primary);
        }

        .mount {
          margin-left: 8px;
          font-size: 12px;
          color: var(--el-text-color-secondary);
        }
      }

      .disk-usage {
        margin-bottom: 8px;
      }

      .disk-info {
        display: flex;
        justify-content: space-between;

        .info-item {
          .label {
            font-size: 12px;
            color: var(--el-text-color-secondary);
            margin-right: 4px;
          }

          .value {
            font-size: 13px;
            color: var(--el-text-color-primary);
            font-weight: 500;
          }
        }
      }
    }
  }
}
</style>
