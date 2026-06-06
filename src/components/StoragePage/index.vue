<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { activateHardwareStore, deactivateHardwareStore, hardwareStore } from '../../composables/useHardwareData'
import { clampPercent, formatBytes } from '../../utils'

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
  healthText: string
  healthVariant: 'good' | 'warn' | 'muted'
  healthPercentText: string
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
} = hardwareStore

const subscribed = ref(false)
const selectedDiskId = ref('')

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function safeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
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

  return { text: '未提供', variant: 'muted' as const }
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
  diskLayoutData.value
    .filter((disk) => (disk.size || 0) > 0)
    .map((disk, index) => {
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
        healthText: health.text,
        healthVariant: health.variant,
        healthPercentText: typeof nvmeHealth?.percentage_used === 'number' ? `${Math.max(0, 100 - nvmeHealth.percentage_used)}%` : '--',
        temperature: safeNumber(disk.temperature),
        smartRows,
        features: buildFeatures(disk),
      }
    })
)

const volumeRows = computed<VolumeRow[]>(() =>
  diskData.value
    .filter((volume) => volume.size > 0)
    .map((volume) => ({
      label: cleanText(volume.fs) || cleanText(volume.mount) || cleanText(volume.name) || '--',
      mount: cleanText(volume.mount) || '--',
      type: cleanText(volume.type) || '--',
      size: volume.size || 0,
      used: volume.used || 0,
      available: volume.available || 0,
      use: typeof volume.used === 'number' && volume.size > 0 ? clampPercent((volume.used / volume.size) * 100) : 0,
    }))
)

const interfaceTypes = computed(() => {
  const set = new Set<string>()
  physicalDisks.value.forEach((disk) => {
    if (disk.interfaceType !== '--') set.add(disk.interfaceType)
  })
  return [...set]
})

const totalPhysicalCapacity = computed(() => physicalDisks.value.reduce((sum, disk) => sum + disk.capacity, 0))
const mountedVolumeCapacity = computed(() => volumeRows.value.reduce((sum, volume) => sum + volume.size, 0))
const mountedVolumeUsed = computed(() => volumeRows.value.reduce((sum, volume) => sum + volume.used, 0))
const mountedVolumeAvailable = computed(() => volumeRows.value.reduce((sum, volume) => sum + volume.available, 0))

const selectedDisk = computed(() => physicalDisks.value.find((disk) => disk.id === selectedDiskId.value) || physicalDisks.value[0])

const selectedDiskMountedUsage = computed(() => {
  if (!selectedDisk.value || physicalDisks.value.length !== 1) return null
  return {
    total: mountedVolumeCapacity.value,
    used: mountedVolumeUsed.value,
    available: mountedVolumeAvailable.value,
    percent: mountedVolumeCapacity.value > 0 ? clampPercent((mountedVolumeUsed.value / mountedVolumeCapacity.value) * 100) : 0,
  }
})

const overviewCards = computed<OverviewCard[]>(() => {
  const healthyCount = physicalDisks.value.filter((disk) => disk.healthVariant === 'good').length
  const healthLabel =
    physicalDisks.value.length === 0
      ? '未识别'
      : healthyCount === physicalDisks.value.length
        ? '良好'
        : healthyCount > 0
          ? '部分关注'
          : '需检查'

  return [
    {
      label: '设备数量',
      value: `${physicalDisks.value.length}`,
      subvalue: `${volumeRows.value.length} 个挂载卷`,
      tone: 'blue',
    },
    {
      label: '总容量',
      value: formatBytes(totalPhysicalCapacity.value),
      subvalue: `挂载卷已用 ${formatBytes(mountedVolumeUsed.value)}`,
      tone: 'purple',
    },
    {
      label: '健康状态',
      value: healthLabel,
      subvalue: physicalDisks.value.length ? `${healthyCount} / ${physicalDisks.value.length} 设备状态良好` : '未识别到物理磁盘',
      tone: 'green',
    },
    {
      label: '接口类型',
      value: `${interfaceTypes.value.length || 0} 种`,
      subvalue: interfaceTypes.value.join(' / ') || '--',
      tone: 'amber',
    },
  ]
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
    `物理总容量：${formatBytes(totalPhysicalCapacity.value)}`,
    `挂载卷已用：${formatBytes(mountedVolumeUsed.value)}`,
    '',
    '[物理磁盘]',
    ...physicalDisks.value.map((disk) =>
      [
        `名称：${disk.name}`,
        `类型：${disk.type}`,
        `接口：${disk.interfaceType}`,
        `容量：${formatBytes(disk.capacity)}`,
        `健康：${disk.healthText}`,
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

defineExpose({
  exportReport,
  copyStorageInfo,
})

async function ensureStoreActive() {
  if (subscribed.value) return
  subscribed.value = true
  await activateHardwareStore()
}

function releaseStore() {
  if (!subscribed.value) return
  deactivateHardwareStore()
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
    <div v-if="loading" class="storage-empty">正在同步存储数据...</div>

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
            :class="['storage-device-row', { 'storage-device-row--active': selectedDisk?.id === disk.id }]"
            @click="selectedDiskId = disk.id"
          >
            <div class="storage-device-row__name">
              <strong>{{ disk.name }}</strong>
              <span>{{ disk.firmware }}</span>
            </div>
            <span>{{ disk.type }}</span>
            <span>{{ disk.interfaceType }}</span>
            <span>{{ formatBytes(disk.capacity) }}</span>
            <span :class="['health-chip', `health-chip--${disk.healthVariant}`]">{{ disk.healthText }}</span>
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
            <div class="storage-focus-card__health">
              <span :class="['health-chip', `health-chip--${selectedDisk.healthVariant}`]">{{ selectedDisk.healthText }}</span>
              <span>{{ selectedDisk.healthPercentText !== '--' ? `剩余健康 ${selectedDisk.healthPercentText}` : '健康百分比未提供' }}</span>
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
              <span>{{ selectedDiskMountedUsage ? '挂载卷已用' : '卷占用' }}</span>
              <strong>{{ selectedDiskMountedUsage ? formatBytes(selectedDiskMountedUsage.used) : '--' }}</strong>
              <small>{{ selectedDiskMountedUsage ? formatPercent(selectedDiskMountedUsage.percent) : '未映射' }}</small>
            </div>
          </div>

          <div class="storage-usage-legend">
            <div>
              <span>物理总容量</span>
              <strong>{{ formatBytes(selectedDisk.capacity) }}</strong>
            </div>
            <div>
              <span>挂载卷总量</span>
              <strong>{{ formatBytes(selectedDiskMountedUsage?.total || 0) }}</strong>
            </div>
            <div>
              <span>挂载卷可用</span>
              <strong>{{ selectedDiskMountedUsage ? formatBytes(selectedDiskMountedUsage.available) : '--' }}</strong>
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
              <span>已用</span>
              <span>可用</span>
            </div>

            <div v-for="volume in volumeRows" :key="volume.mount" class="storage-volume-row">
              <strong>{{ volume.label }}</strong>
              <span>{{ volume.type }}</span>
              <span>{{ formatBytes(volume.size) }}</span>
              <span>{{ formatBytes(volume.used) }} ({{ formatPercent(volume.use) }})</span>
              <span>{{ formatBytes(volume.available) }}</span>
            </div>
          </div>

          <div v-else class="storage-empty storage-empty--inline">未识别到可用挂载卷。</div>
        </section>

        <section class="storage-section">
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
              <span>物理总容量</span>
              <strong>{{ formatBytes(totalPhysicalCapacity) }}</strong>
            </div>
            <div class="storage-detail-item">
              <span>挂载卷总量</span>
              <strong>{{ formatBytes(mountedVolumeCapacity) }}</strong>
            </div>
            <div class="storage-detail-item">
              <span>挂载卷已用</span>
              <strong>{{ formatBytes(storageUsage.used) }}</strong>
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
  padding: 18px 20px;
  border: 1px solid var(--panel-border);
  border-radius: 18px;
  background:
    linear-gradient(180deg, rgba(24, 33, 46, 0.96), rgba(20, 29, 40, 0.96)),
    rgba(20, 29, 40, 0.96);
  box-shadow: var(--panel-shadow);
}

.storage-section__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;

  h2 {
    margin: 0;
    color: #f3f7fe;
    font-size: 16px;
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
  border: 1px solid rgba(72, 91, 119, 0.34);
  border-radius: 16px;
  background: rgba(18, 27, 38, 0.82);
}

.storage-overview-card__label {
  color: var(--text-muted);
  font-size: 14px;
}

.storage-overview-card__value {
  color: #f5f8fe;
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
  color: #6bc2ff;
}

.storage-overview-card--purple .storage-overview-card__value {
  color: #bb74ff;
}

.storage-overview-card--green .storage-overview-card__value {
  color: #84da69;
}

.storage-overview-card--amber .storage-overview-card__value {
  color: #f6c75e;
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
  grid-template-columns: minmax(220px, 1.7fr) 0.8fr 0.8fr 0.9fr 0.8fr 0.6fr;
  width: 100%;
  padding: 14px 16px;
  border: 0;
  border-top: 1px solid rgba(58, 72, 94, 0.26);
  background: transparent;
  color: #dde5f3;
  text-align: left;
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease;
}

.storage-device-row:first-child {
  border-top: 0;
}

.storage-device-row:hover,
.storage-device-row--active {
  background: rgba(29, 42, 59, 0.8);
}

.storage-device-row--active {
  box-shadow: inset 2px 0 0 #4caeff;
}

.storage-device-row__name {
  display: flex;
  flex-direction: column;
  gap: 5px;

  strong {
    color: #f5f8fe;
    font-size: 15px;
    font-weight: 700;
  }

  span {
    color: var(--text-muted);
    font-size: 12px;
  }
}

.health-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 58px;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}

.health-chip--good {
  color: #88dc6e;
  background: rgba(69, 143, 53, 0.2);
}

.health-chip--warn {
  color: #f6c75e;
  background: rgba(159, 110, 31, 0.2);
}

.health-chip--muted {
  color: #b2bfd3;
  background: rgba(95, 108, 128, 0.2);
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
    color: #f4f7fd;
    font-size: 20px;
    font-weight: 700;
  }

  p {
    margin: 8px 0 0;
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
    color: #edf2fb;
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
    color: #f4f7fd;
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
    color: #eef3fb;
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
  color: #e4ebf8;
  font-size: 13px;
  border-top: 1px solid rgba(58, 72, 94, 0.26);
}

.storage-smart-table__header,
.storage-smart-row {
  grid-template-columns: 0.35fr minmax(0, 1.2fr) 0.5fr 0.5fr 0.8fr 0.5fr;
  padding: 12px 14px;
}

.smart-status {
  color: #84da69;
  font-weight: 700;
}

.smart-status--warn {
  color: #f6c75e;
}

.storage-feature-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.storage-feature-chip {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 0 14px;
  border: 1px solid rgba(67, 131, 255, 0.24);
  border-radius: 999px;
  background: rgba(22, 33, 50, 0.84);
  color: #c8defe;
  font-size: 13px;
  font-weight: 600;
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
