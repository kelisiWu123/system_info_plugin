<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { activateHardwareStore, deactivateHardwareStore, hardwareStore, refreshHardwareData } from '../../composables/useHardwareData'
import { clampPercent, formatBytes, getDisplayStorageVolumes, getPhysicalDiskLayout, getPhysicalDiskTotalBytes, hasDiskHealthTelemetry } from '../../utils'
import StateBlock from '../common/StateBlock.vue'

const props = defineProps<{
  active?: boolean
}>()

interface OverviewCard {
  label: string
  value: string
  subvalue: string
  tone: 'blue' | 'purple' | 'green' | 'amber'
}

interface PhysicalDiskRow {
  id: string
  name: string
  type: string
  interfaceType: string
  capacity: number
  firmware: string
  serial: string
  protocol: string
  devicePath: string
  hasHealthData: boolean
  healthText?: string
  healthVariant?: 'good' | 'warn' | 'muted'
  healthPercentText?: string
  temperature: number | null
  smartRows: Array<{
    id: number
    name: string
    value: number
    worst: number
    thresh: number
    raw: string
    status: string
  }>
  features: string[]
}

interface VolumeRow {
  label: string
  subtitle: string
  mount: string
  type: string
  size: number
  used: number
  available: number
  use: number
}

const {
  loading,
  lastSyncedAt,
  diskLayoutData,
  diskData,
  storageUsage,
  osInfo,
  fetchState,
} = hardwareStore

const subscribed = ref(false)
const selectedDiskId = ref('')
const isDarwin = computed(() => cleanText(osInfo.value?.platform).toLowerCase() === 'darwin')

const pageStateBlock = computed(() => {
  if (fetchState.diskData.status === 'error' || fetchState.diskLayout.status === 'error') {
    return {
      variant: 'error' as const,
      title: '存储数据读取失败',
      description: fetchState.diskLayout.note || fetchState.diskData.note || '读取物理磁盘或挂载卷信息时发生异常，可以重试该模块。',
      actionLabel: '重试该模块',
    }
  }

  if (fetchState.diskData.status === 'missing' && fetchState.diskLayout.status === 'missing' && !diskData.value.length && !diskLayoutData.value.length) {
    return {
      variant: 'empty' as const,
      title: '未识别到存储设备',
      description: '当前系统数据源没有返回物理磁盘或挂载卷信息。',
      actionLabel: '重试该模块',
    }
  }

  return null
})

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function safeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function getMountBasename(value: string) {
  const normalized = value.replace(/[\\/]+$/, '')
  if (!normalized || normalized === '/' || /^[A-Za-z]:$/.test(normalized)) return normalized || value
  const segments = normalized.split(/[\\/]/).filter(Boolean)
  return segments.at(-1) || normalized
}

function getVolumeDisplayName(volume: { name?: unknown; mount?: unknown; fs?: unknown }) {
  const name = cleanText(volume.name)
  if (name) return name

  const mount = cleanText(volume.mount)
  if (mount === '/System/Volumes/Data') return '系统数据'
  if (mount) return getMountBasename(mount)

  return cleanText(volume.fs) || '--'
}

function getVolumeSubtitle(volume: { mount?: unknown; fs?: unknown }, displayName: string) {
  const mount = cleanText(volume.mount)
  if (mount && mount !== displayName) return mount

  const fs = cleanText(volume.fs)
  if (fs && fs !== displayName && fs !== mount) return fs

  return ''
}

function formatSyncTime(value?: number) {
  if (!value) return '--:--:--'
  return new Date(value).toLocaleString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function formatPercent(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value)}%` : '--'
}

function formatTemperature(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? `${Math.round(value)}°C` : '--'
}

function formatHealthText(disk: DiskLayoutData) {
  const smartPassed = disk.smartData?.smart_status?.passed
  if (smartPassed === true) return { text: '良好', variant: 'good' as const }
  if (smartPassed === false) return { text: '注意', variant: 'warn' as const }

  const smartStatus = cleanText(disk.smartStatus).toLowerCase()
  if (smartStatus === 'ok' || smartStatus === 'passed') return { text: '良好', variant: 'good' as const }
  if (smartStatus) return { text: cleanText(disk.smartStatus), variant: 'warn' as const }

  return undefined
}

function normalizeSmartStatus(row: { when_failed?: string; raw?: { value?: number | string } }) {
  const failedText = cleanText(row.when_failed)
  if (failedText && failedText !== '-' && failedText.toLowerCase() !== 'never') return '关注'
  const rawValue = row.raw?.value
  const numericRaw = typeof rawValue === 'number' ? rawValue : Number(rawValue)
  if (Number.isFinite(numericRaw) && numericRaw > 0 && cleanText(failedText).toLowerCase() === 'in_the_past') return '关注'
  return '正常'
}

function buildFeatures(disk: DiskLayoutData) {
  const featureSet = new Set<string>()
  const interfaceType = cleanText(disk.interfaceType)
  const protocol = cleanText(disk.smartData?.device?.protocol)
  const type = cleanText(disk.type)

  if (disk.smartData?.smart_status) featureSet.add('S.M.A.R.T.')
  if (disk.smartData?.trim?.supported) featureSet.add('TRIM')
  if (interfaceType) featureSet.add(interfaceType)
  if (protocol) featureSet.add(protocol)
  if (type) featureSet.add(type)
  if (disk.smartData?.nvme_smart_health_information_log) featureSet.add('NVMe Health')
  if (disk.smartData?.ata_smart_error_log?.summary?.count !== undefined) featureSet.add('SMART Error Log')

  return [...featureSet]
}

async function writeClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  document.body.removeChild(textarea)

  if (!copied) throw new Error('execCommand copy failed')
}

const physicalDisks = computed<PhysicalDiskRow[]>(() =>
  getPhysicalDiskLayout(diskLayoutData.value).map((disk, index) => {
      const hasHealthData = hasDiskHealthTelemetry(disk)
      const health = formatHealthText(disk)
      const nvmeHealth = disk.smartData?.nvme_smart_health_information_log
      const smartRows = (disk.smartData?.ata_smart_attributes?.table || []).slice(0, 8).map((row) => ({
        id: row.id,
        name: row.name,
        value: row.value,
        worst: row.worst,
        thresh: row.thresh,
        raw: row.raw?.string || String(row.raw?.value ?? '--'),
        status: normalizeSmartStatus(row),
      }))

      return {
        id: cleanText(disk.device) || `disk-${index}`,
        name: cleanText(disk.name) || cleanText(disk.device) || `存储设备 ${index + 1}`,
        type: cleanText(disk.type) || '未知类型',
        interfaceType: cleanText(disk.interfaceType) || '--',
        capacity: disk.size || 0,
        firmware: cleanText(disk.firmwareRevision) || '--',
        serial: cleanText(disk.serialNum) || '--',
        protocol: cleanText(disk.smartData?.device?.protocol) || cleanText(disk.interfaceType) || '--',
        devicePath: cleanText(disk.device) || '--',
        hasHealthData,
        healthText: health?.text,
        healthVariant: health?.variant,
        healthPercentText: hasHealthData && typeof nvmeHealth?.percentage_used === 'number' ? `${Math.max(0, 100 - nvmeHealth.percentage_used)}%` : undefined,
        temperature: safeNumber(disk.temperature),
        smartRows,
        features: buildFeatures(disk),
      }
    })
)

const volumeRows = computed<VolumeRow[]>(() =>
  getDisplayStorageVolumes(diskData.value, cleanText(osInfo.value?.platform).toLowerCase())
    .map((volume) => {
      const label = getVolumeDisplayName(volume)
      return {
        label,
        subtitle: getVolumeSubtitle(volume, label),
        mount: cleanText(volume.mount) || '--',
        type: cleanText(volume.type) || '--',
        size: volume.size || 0,
        used: volume.used || 0,
        available: volume.available || 0,
        use: typeof volume.used === 'number' && volume.size > 0 ? clampPercent((volume.used / volume.size) * 100) : 0,
      }
    })
)

const interfaceTypes = computed(() => {
  const set = new Set<string>()
  physicalDisks.value.forEach((disk) => {
    if (disk.interfaceType !== '--') set.add(disk.interfaceType)
  })
  return [...set]
})

const totalPhysicalCapacity = computed(() => getPhysicalDiskTotalBytes(diskLayoutData.value))
const displayCapacityTotal = computed(() => totalPhysicalCapacity.value > 0 ? totalPhysicalCapacity.value : storageUsage.value.total)
const mountedVolumeUsed = computed(() => volumeRows.value.reduce((sum, volume) => sum + volume.used, 0))
const mountedVolumeAvailable = computed(() => volumeRows.value.reduce((sum, volume) => sum + volume.available, 0))
const disksWithHealthData = computed(() => physicalDisks.value.filter((disk) => disk.hasHealthData))
const hasDiskHealthSupport = computed(() => disksWithHealthData.value.length > 0)

const selectedDisk = computed(() => physicalDisks.value.find((disk) => disk.id === selectedDiskId.value) || physicalDisks.value[0])

const selectedDiskMountedUsage = computed(() => {
  if (isDarwin.value || !selectedDisk.value || physicalDisks.value.length !== 1) return null
  const total = selectedDisk.value.capacity
  const used = total > 0 ? Math.min(mountedVolumeUsed.value, total) : mountedVolumeUsed.value
  const available = total > 0 ? Math.max(total - used, 0) : mountedVolumeAvailable.value
  return {
    total,
    used,
    available,
    percent: total > 0 ? clampPercent((used / total) * 100) : 0,
  }
})

const overviewCards = computed<OverviewCard[]>(() => {
  const healthyCount = disksWithHealthData.value.filter((disk) => disk.healthVariant === 'good').length
  const healthLabel =
    disksWithHealthData.value.length === 0
      ? '未识别'
      : healthyCount === disksWithHealthData.value.length
        ? '良好'
        : healthyCount > 0
          ? '部分关注'
          : '需检查'

  const cards: OverviewCard[] = [
    {
      label: '设备数量',
      value: `${physicalDisks.value.length}`,
      subvalue: `${volumeRows.value.length} 个挂载卷`,
      tone: 'blue',
    },
    {
      label: '总容量',
      value: formatBytes(displayCapacityTotal.value),
      subvalue: `挂载卷已用 ${formatBytes(storageUsage.value.used)}`,
      tone: 'purple',
    },
    {
      label: '接口类型',
      value: `${interfaceTypes.value.length || 0} 种`,
      subvalue: interfaceTypes.value.join(' / ') || '--',
      tone: 'amber',
    },
  ]

  if (hasDiskHealthSupport.value) {
    cards.splice(2, 0, {
      label: '健康状态',
      value: healthLabel,
      subvalue: `${healthyCount} / ${disksWithHealthData.value.length} 设备状态良好`,
      tone: 'green',
    })
  }

  return cards
})

const selectedDiskRingStyle = computed(() => {
  const percent = selectedDiskMountedUsage.value?.percent || 0
  return {
    background: `conic-gradient(var(--accent-blue) ${percent}%, rgba(54, 70, 93, 0.9) ${percent}% 100%)`,
  }
})

const selectedDiskDetails = computed(() => {
  if (!selectedDisk.value) return []

  return [
    { label: '固件', value: selectedDisk.value.firmware },
    { label: '接口', value: selectedDisk.value.interfaceType },
    { label: '协议', value: selectedDisk.value.protocol },
    { label: '设备路径', value: selectedDisk.value.devicePath },
    { label: '序列号', value: selectedDisk.value.serial },
    { label: '容量', value: formatBytes(selectedDisk.value.capacity) },
  ]
})

const storageReportText = computed(() => {
  const lines = [
    '存储页面报告',
    `导出时间：${new Date().toLocaleString('zh-CN')}`,
    '',
    `物理磁盘：${physicalDisks.value.length}`,
    `挂载卷：${volumeRows.value.length}`,
    `总容量：${formatBytes(displayCapacityTotal.value)}`,
    `挂载卷已用：${formatBytes(storageUsage.value.used)}`,
    '',
    '[物理磁盘]',
    ...physicalDisks.value.map((disk) =>
      [
        `名称：${disk.name}`,
        `类型：${disk.type}`,
        `接口：${disk.interfaceType}`,
        `容量：${formatBytes(disk.capacity)}`,
        ...(disk.hasHealthData && disk.healthText ? [`健康：${disk.healthText}`] : []),
        `温度：${formatTemperature(disk.temperature)}`,
      ].join(' / ')
    ),
    '',
    '[挂载卷]',
    ...volumeRows.value.map((volume) => `${volume.label}：${formatBytes(volume.used)} / ${formatBytes(volume.size)} (${formatPercent(volume.use)})`),
  ]

  if (selectedDisk.value) {
    lines.push('', '[当前选中磁盘]')
    selectedDiskDetails.value.forEach((item) => lines.push(`${item.label}：${item.value}`))
  }

  return lines.join('\n')
})

function exportReport() {
  const blob = new Blob([storageReportText.value], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `storage-report-${new Date().toISOString().slice(0, 10)}.txt`
  anchor.click()
  URL.revokeObjectURL(url)
}

async function copyStorageInfo() {
  try {
    await writeClipboard(storageReportText.value)
    return true
  } catch (error) {
    console.error('复制存储信息失败:', error)
    return false
  }
}

async function retryStoragePage() {
  await refreshHardwareData('storage')
}

defineExpose({
  exportReport,
  copyStorageInfo,
})

async function ensureStoreActive() {
  if (subscribed.value) return
  subscribed.value = true
  await activateHardwareStore('storage')
}

function releaseStore() {
  if (!subscribed.value) return
  deactivateHardwareStore('storage')
  subscribed.value = false
}

watch(
  physicalDisks,
  (list) => {
    if (!list.length) {
      selectedDiskId.value = ''
      return
    }

    if (!list.some((disk) => disk.id === selectedDiskId.value)) {
      selectedDiskId.value = list[0].id
    }
  },
  { immediate: true }
)

watch(
  () => props.active,
  async (active) => {
    if (active === false) {
      releaseStore()
      return
    }

    await ensureStoreActive()
  },
  { immediate: true }
)

onUnmounted(() => {
  releaseStore()
})
</script>

<template>
  <div class="storage-page">
    <StateBlock
      v-if="loading"
      variant="loading"
      title="正在同步存储数据"
      description="正在读取物理磁盘、挂载卷、容量和健康状态信息。"
      action-label="重试该模块"
      @retry="retryStoragePage"
    />

    <StateBlock
      v-else-if="pageStateBlock"
      :variant="pageStateBlock.variant"
      :title="pageStateBlock.title"
      :description="pageStateBlock.description"
      :action-label="pageStateBlock.actionLabel"
      @retry="retryStoragePage"
    />

    <template v-else>
      <section class="storage-section">
        <div class="storage-section__header">
          <h2>存储概览</h2>
          <span>最近同步：{{ formatSyncTime(lastSyncedAt) }}</span>
        </div>

        <div class="storage-overview-grid">
          <article v-for="card in overviewCards" :key="card.label" class="storage-overview-card" :class="`storage-overview-card--${card.tone}`">
            <span class="storage-overview-card__label">{{ card.label }}</span>
            <strong class="storage-overview-card__value">{{ card.value }}</strong>
            <span class="storage-overview-card__subvalue">{{ card.subvalue }}</span>
          </article>
        </div>
      </section>

      <section class="storage-section">
        <div class="storage-section__header">
          <h2>存储设备列表</h2>
          <span>物理磁盘口径，不与卷占用做强匹配</span>
        </div>

        <div v-if="physicalDisks.length" class="storage-device-table">
          <button
            v-for="disk in physicalDisks"
            :key="disk.id"
            type="button"
            :class="[
              'storage-device-row',
              {
                'storage-device-row--active': selectedDisk?.id === disk.id,
                'storage-device-row--with-health': hasDiskHealthSupport,
                'storage-device-row--compact': !hasDiskHealthSupport,
              },
            ]"
            @click="selectedDiskId = disk.id"
          >
            <div class="storage-device-row__name">
              <strong>{{ disk.name }}</strong>
              <span>{{ disk.firmware }}</span>
            </div>
            <span>{{ disk.type }}</span>
            <span>{{ disk.interfaceType }}</span>
            <span>{{ formatBytes(disk.capacity) }}</span>
            <span v-if="hasDiskHealthSupport" class="storage-device-row__health">
              <span v-if="disk.hasHealthData && disk.healthText && disk.healthVariant" :class="['health-chip', `health-chip--${disk.healthVariant}`]">{{ disk.healthText }}</span>
            </span>
            <span>{{ formatTemperature(disk.temperature) }}</span>
          </button>
        </div>

        <div v-else class="storage-empty storage-empty--inline">未识别到物理存储设备。</div>
      </section>

      <section v-if="selectedDisk" class="storage-section storage-focus-card">
        <div class="storage-focus-card__main">
          <div class="storage-focus-card__title">
            <div>
              <h2>{{ selectedDisk.name }}</h2>
              <p>{{ selectedDisk.type }} / {{ selectedDisk.interfaceType }} / {{ selectedDisk.protocol }}</p>
            </div>
            <div v-if="selectedDisk.hasHealthData && selectedDisk.healthText && selectedDisk.healthVariant" class="storage-focus-card__health">
              <span :class="['health-chip', `health-chip--${selectedDisk.healthVariant}`]">{{ selectedDisk.healthText }}</span>
              <span v-if="selectedDisk.healthPercentText">{{ `剩余健康 ${selectedDisk.healthPercentText}` }}</span>
            </div>
          </div>

          <div class="storage-focus-card__details">
            <div v-for="item in selectedDiskDetails" :key="item.label" class="storage-detail-item">
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
            </div>
            <div class="storage-detail-item">
              <span>温度</span>
              <strong>{{ formatTemperature(selectedDisk.temperature) }}</strong>
            </div>
            <div class="storage-detail-item">
              <span>卷映射</span>
              <strong>{{ physicalDisks.length === 1 ? '当前为单物理盘，卷口径可直接参考' : '多物理盘下不做卷到磁盘的强绑定' }}</strong>
            </div>
          </div>
        </div>

        <div class="storage-usage-panel">
          <div class="storage-usage-ring" :style="selectedDiskRingStyle">
            <div class="storage-usage-ring__inner">
              <span>{{ isDarwin ? '卷聚合' : selectedDiskMountedUsage ? '挂载卷已用' : '卷占用' }}</span>
              <strong>{{ isDarwin ? '暂不显示' : selectedDiskMountedUsage ? formatBytes(selectedDiskMountedUsage.used) : '--' }}</strong>
              <small>{{ isDarwin ? 'macOS' : selectedDiskMountedUsage ? formatPercent(selectedDiskMountedUsage.percent) : '未映射' }}</small>
            </div>
          </div>

          <div class="storage-usage-legend">
            <div>
              <span>物理总容量</span>
              <strong>{{ formatBytes(selectedDisk.capacity) }}</strong>
            </div>
            <div>
              <span>{{ isDarwin ? '挂载卷数量' : '卷已用空间' }}</span>
              <strong>{{ isDarwin ? `${volumeRows.length} 个` : selectedDiskMountedUsage ? formatBytes(selectedDiskMountedUsage.used) : '--' }}</strong>
            </div>
            <div>
              <span>{{ isDarwin ? '当前状态' : '估算剩余空间' }}</span>
              <strong>{{ isDarwin ? 'macOS 暂不显示已用存储' : selectedDiskMountedUsage ? formatBytes(selectedDiskMountedUsage.available) : '--' }}</strong>
            </div>
          </div>
        </div>
      </section>

      <div class="storage-lower-grid">
        <section class="storage-section">
          <div class="storage-section__header">
            <h2>挂载卷信息</h2>
            <span>系统卷口径</span>
          </div>

          <div v-if="volumeRows.length" class="storage-volume-table">
            <div class="storage-volume-table__header">
              <span>卷</span>
              <span>文件系统</span>
              <span>容量</span>
              <span>{{ isDarwin ? '状态' : '已用' }}</span>
              <span>可用</span>
            </div>

            <div v-for="volume in volumeRows" :key="volume.mount" class="storage-volume-row">
              <div class="storage-volume-row__name" :title="volume.subtitle || volume.label">
                <strong>{{ volume.label }}</strong>
                <span v-if="volume.subtitle">{{ volume.subtitle }}</span>
              </div>
              <span>{{ volume.type }}</span>
              <span>{{ formatBytes(volume.size) }}</span>
              <span>{{ isDarwin ? '已挂载' : `${formatBytes(volume.used)} (${formatPercent(volume.use)})` }}</span>
              <span>{{ formatBytes(volume.available) }}</span>
            </div>
          </div>

          <div v-else class="storage-empty storage-empty--inline">未识别到可用挂载卷。</div>
        </section>

        <section v-if="hasDiskHealthSupport" class="storage-section">
          <div class="storage-section__header">
            <h2>SMART 摘要</h2>
            <span>仅展示当前数据源实际提供的属性</span>
          </div>

          <div v-if="selectedDisk?.smartRows.length" class="storage-smart-table">
            <div class="storage-smart-table__header">
              <span>ID</span>
              <span>属性名称</span>
              <span>当前值</span>
              <span>阈值</span>
              <span>原始值</span>
              <span>状态</span>
            </div>

            <div v-for="row in selectedDisk.smartRows" :key="`${selectedDisk.id}-${row.id}-${row.name}`" class="storage-smart-row">
              <span>{{ row.id.toString().padStart(2, '0') }}</span>
              <span>{{ row.name }}</span>
              <span>{{ row.value }}</span>
              <span>{{ row.thresh }}</span>
              <span>{{ row.raw }}</span>
              <span :class="['smart-status', { 'smart-status--warn': row.status !== '正常' }]">{{ row.status }}</span>
            </div>
          </div>

          <div v-else class="storage-empty storage-empty--inline">当前磁盘未返回 SMART 属性表。</div>
        </section>
      </div>

      <div class="storage-bottom-grid">
        <section class="storage-section">
          <div class="storage-section__header">
            <h2>控制器与卷汇总</h2>
            <span>按当前系统返回聚合</span>
          </div>

          <div class="storage-summary-grid">
            <div class="storage-detail-item">
              <span>接口类型</span>
              <strong>{{ interfaceTypes.join(' / ') || '--' }}</strong>
            </div>
            <div class="storage-detail-item">
              <span>总容量</span>
              <strong>{{ formatBytes(displayCapacityTotal) }}</strong>
            </div>
            <div class="storage-detail-item">
              <span>已识别卷已用</span>
              <strong>{{ formatBytes(storageUsage.used) }}</strong>
            </div>
            <div class="storage-detail-item">
              <span>估算剩余空间</span>
              <strong>{{ formatBytes(Math.max(displayCapacityTotal - storageUsage.used, 0)) }}</strong>
            </div>
          </div>
        </section>

        <section class="storage-section">
          <div class="storage-section__header">
            <h2>功能支持</h2>
            <span>基于当前选中磁盘</span>
          </div>

          <div v-if="selectedDisk?.features.length" class="storage-feature-list">
            <span v-for="feature in selectedDisk.features" :key="feature" class="storage-feature-chip">{{ feature }}</span>
          </div>

          <div v-else class="storage-empty storage-empty--inline">当前磁盘未返回可识别功能标签。</div>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped lang="less">
.storage-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-height: 0;
  padding-bottom: 4px;
}

.storage-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: var(--surface-padding);
  border: 1px solid var(--panel-border);
  border-radius: var(--surface-radius);
  background:
    linear-gradient(180deg, rgba(21, 31, 44, 0.98), rgba(17, 25, 35, 0.98)),
    radial-gradient(circle at top left, rgba(66, 128, 240, 0.08), transparent 28%);
  box-shadow: var(--panel-shadow);
}

.storage-section__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--surface-heading-gap);

  h2 {
    margin: 0;
    color: var(--text-primary);
    font-size: var(--surface-title-size);
    font-weight: 700;
  }

  span {
    color: var(--text-muted);
    font-size: 13px;
  }
}

.storage-overview-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.storage-overview-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 110px;
  padding: 18px;
  border: 1px solid var(--panel-border-soft);
  border-radius: 14px;
  background:
    linear-gradient(180deg, rgba(21, 31, 44, 0.94), rgba(17, 25, 35, 0.94)),
    rgba(18, 27, 38, 0.82);
}

.storage-overview-card__label {
  color: var(--text-muted);
  font-size: 14px;
}

.storage-overview-card__value {
  color: var(--text-primary);
  font-size: 30px;
  font-weight: 700;
  line-height: 1;
}

.storage-overview-card__subvalue {
  color: var(--text-subtle);
  font-size: 13px;
  line-height: 1.4;
}

.storage-overview-card--blue .storage-overview-card__value {
  color: var(--accent-cyan);
}

.storage-overview-card--purple .storage-overview-card__value {
  color: var(--accent-purple);
}

.storage-overview-card--green .storage-overview-card__value {
  color: var(--accent-green);
}

.storage-overview-card--amber .storage-overview-card__value {
  color: var(--accent-yellow);
}

.storage-device-table,
.storage-volume-table,
.storage-smart-table {
  display: flex;
  flex-direction: column;
  gap: 0;
  border: 1px solid rgba(65, 80, 102, 0.32);
  border-radius: 14px;
  overflow: hidden;
  background: rgba(15, 23, 34, 0.84);
}

.storage-device-row,
.storage-volume-table__header,
.storage-volume-row,
.storage-smart-table__header,
.storage-smart-row {
  display: grid;
  align-items: center;
  gap: 16px;
}

.storage-device-row {
  width: 100%;
  padding: 14px 16px;
  border: 0;
  border-top: 1px solid rgba(58, 72, 94, 0.26);
  background: transparent;
  color: var(--text-secondary);
  text-align: left;
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease;
}

.storage-device-row--with-health {
  grid-template-columns: minmax(220px, 1.7fr) 0.8fr 0.8fr 0.9fr 0.8fr 0.6fr;
}

.storage-device-row--compact {
  grid-template-columns: minmax(220px, 1.9fr) 0.9fr 0.9fr 1fr 0.7fr;
}

.storage-device-row:first-child {
  border-top: 0;
}

.storage-device-row:hover,
.storage-device-row--active {
  background: rgba(29, 42, 59, 0.8);
}

.storage-device-row--active {
  box-shadow: inset 2px 0 0 var(--accent-blue);
}

.storage-device-row__name {
  display: flex;
  flex-direction: column;
  gap: 5px;

  strong {
    color: var(--text-primary);
    font-size: 15px;
    font-weight: 700;
  }

  span {
    color: var(--text-muted);
    font-size: 12px;
  }
}

.storage-device-row__health {
  display: flex;
  justify-content: center;
}

.health-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 58px;
  min-height: var(--pill-height);
  padding: 0 10px;
  border-radius: var(--pill-radius);
  font-size: 12px;
  font-weight: 700;
}

.health-chip--good {
  color: var(--state-good-fg);
  background: var(--state-good-bg);
}

.health-chip--warn {
  color: var(--state-warn-fg);
  background: var(--state-warn-bg);
}

.health-chip--muted {
  color: var(--state-neutral-fg);
  background: var(--state-neutral-bg);
}

.storage-focus-card {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) 280px;
  gap: 20px;
}

.storage-focus-card__main {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.storage-focus-card__title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid rgba(64, 79, 101, 0.3);

  h2 {
    margin: 0;
    color: var(--text-primary);
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.03em;
    line-height: 1.2;
    overflow-wrap: anywhere;
  }

  p {
    margin: 0;
    color: var(--text-subtle);
    font-size: 14px;
  }
}

.storage-focus-card__health {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;

  span:last-child {
    color: var(--text-muted);
    font-size: 13px;
    text-align: right;
  }
}

.storage-focus-card__details,
.storage-summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 18px;
}

.storage-detail-item {
  display: flex;
  flex-direction: column;
  gap: 6px;

  span {
    color: var(--text-muted);
    font-size: 13px;
  }

  strong {
    color: var(--text-primary);
    font-size: 15px;
    font-weight: 600;
    line-height: 1.45;
  }
}

.storage-usage-panel {
  display: flex;
  flex-direction: column;
  gap: 18px;
  align-items: center;
  justify-content: center;
  padding: 8px 0;
}

.storage-usage-ring {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 174px;
  height: 174px;
  padding: 12px;
  border-radius: 50%;
}

.storage-usage-ring__inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: rgba(13, 20, 29, 0.96);

  span,
  small {
    color: var(--text-muted);
    font-size: 13px;
  }

  strong {
    color: var(--text-primary);
    font-size: 24px;
    font-weight: 700;
  }
}

.storage-usage-legend {
  display: grid;
  gap: 12px;
  width: 100%;

  div {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding-bottom: 10px;
    border-bottom: 1px solid rgba(59, 74, 96, 0.28);
  }

  span {
    color: var(--text-muted);
    font-size: 13px;
  }

  strong {
    color: var(--text-primary);
    font-size: 14px;
    font-weight: 600;
  }
}

.storage-lower-grid,
.storage-bottom-grid {
  display: grid;
  gap: 18px;
}

.storage-lower-grid {
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
}

.storage-bottom-grid {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}

.storage-volume-table__header,
.storage-volume-row {
  grid-template-columns: minmax(0, 0.8fr) 0.7fr 0.8fr 1fr 0.9fr;
  padding: 12px 14px;
}

.storage-volume-table__header,
.storage-smart-table__header {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
  background: rgba(26, 35, 47, 0.92);
}

.storage-volume-row,
.storage-smart-row {
  color: var(--text-secondary);
  font-size: 13px;
  border-top: 1px solid rgba(58, 72, 94, 0.26);
}

.storage-volume-row > *,
.storage-volume-table__header > * {
  min-width: 0;
}

.storage-volume-row__name {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;

  strong,
  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: var(--text-primary);
    font-weight: 700;
  }

  span {
    color: var(--text-muted);
    font-size: 12px;
  }
}

.storage-smart-table__header,
.storage-smart-row {
  grid-template-columns: 0.35fr minmax(0, 1.2fr) 0.5fr 0.5fr 0.8fr 0.5fr;
  padding: 12px 14px;
}

.smart-status {
  color: var(--state-good-fg);
  font-weight: 700;
}

.smart-status--warn {
  color: var(--state-warn-fg);
}

.storage-feature-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.storage-feature-chip {
  display: inline-flex;
  align-items: center;
  min-height: var(--pill-height);
  padding: 0 14px;
  border: 1px solid var(--control-active-border);
  border-radius: var(--pill-radius);
  background: var(--state-info-bg);
  color: var(--state-info-fg);
  font-size: 13px;
  font-weight: 700;
}

.storage-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 180px;
  border: 1px dashed rgba(79, 97, 126, 0.42);
  border-radius: 18px;
  color: var(--text-muted);
  font-size: 14px;
  background: rgba(18, 26, 38, 0.76);
}

.storage-empty--inline {
  min-height: 120px;
}

@media (max-width: 1180px) {
  .storage-overview-grid,
  .storage-bottom-grid,
  .storage-lower-grid,
  .storage-focus-card {
    grid-template-columns: 1fr;
  }

  .storage-device-row,
  .storage-volume-table__header,
  .storage-volume-row,
  .storage-smart-table__header,
  .storage-smart-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .storage-focus-card__title {
    flex-direction: column;
  }

  .storage-focus-card__health {
    align-items: flex-start;
  }
}
</style>
