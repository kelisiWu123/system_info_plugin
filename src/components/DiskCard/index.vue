<script setup lang="ts">
import { HardDisk } from '@icon-park/vue-next'
import CardHeader from '../CardHeader/index.vue'

defineProps({
  data: {
    type: Array as () => DiskLayoutData[],
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

const getDiskTitle = (disk: DiskLayoutData) => {
  return disk.name || disk.vendor || disk.device || '未知硬盘'
}

const getDiskMeta = (disk: DiskLayoutData) => {
  return [disk.vendor, disk.device].filter(Boolean).join(' / ')
}

const formatTemperature = (value: number | null) => {
  return typeof value === 'number' && value > 0 ? `${value.toFixed(1)} °C` : '未暴露'
}
</script>

<template>
  <div class="disk-card">
    <CardHeader :icon="HardDisk" title="硬盘信息" />

    <div class="disk-list">
      <template v-if="data && data.length">
        <div v-for="(disk, index) in data" :key="index" class="disk-item">
          <div class="disk-name">
            <span class="label">{{ getDiskTitle(disk) }}</span>
            <span v-if="getDiskMeta(disk)" class="mount">{{ getDiskMeta(disk) }}</span>
          </div>

          <div class="disk-info">
            <div class="info-item">
              <span class="label">容量</span>
              <span class="value">{{ formatSize(disk.size) }}</span>
            </div>
            <div class="info-item">
              <span class="label">接口</span>
              <span class="value">{{ disk.interfaceType || '未知' }}</span>
            </div>
            <div class="info-item">
              <span class="label">类型</span>
              <span class="value">{{ disk.type || '未知' }}</span>
            </div>
            <div class="info-item">
              <span class="label">温度</span>
              <span class="value">{{ formatTemperature(disk.temperature) }}</span>
            </div>
            <div class="info-item">
              <span class="label">序列号</span>
              <span class="value">{{ disk.serialNum || '未暴露' }}</span>
            </div>
          </div>
        </div>
      </template>
      <el-empty v-else description="未检测到物理硬盘" />
    </div>
  </div>
</template>

<style scoped lang="less">
.disk-card {
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

      .disk-info {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 16px;

        .info-item {
          min-width: 120px;

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
