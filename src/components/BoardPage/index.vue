<script setup lang="ts">
import { Chip, HardDisk, Memory, Signal } from '@icon-park/vue-next'
import { computed, onUnmounted, ref, watch } from 'vue'
import { activateHardwareStore, deactivateHardwareStore, hardwareStore } from '../../composables/useHardwareData'
import { bytesToGB, formatBytes } from '../../utils'

const props = defineProps<{
  active?: boolean
}>()

type BoardTabKey = 'slots' | 'storage' | 'usb' | 'io'

interface BoardListRow {
  label: string
  primary: string
  secondary?: string
}

const {
  loading,
  boardData,
  biosData,
  memoLayoutData,
  diskLayoutData,
  audioDevices,
  networkInterfaces,
  osInfo,
  cpuData,
} = hardwareStore

const activeTab = ref<BoardTabKey>('slots')
const subscribed = ref(false)

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function joinParts(parts: Array<string | number | null | undefined>, separator = ' ') {
  return parts
    .map((part) => (typeof part === 'number' ? String(part) : cleanText(part)))
    .filter(Boolean)
    .join(separator)
}

function formatDate(value?: string) {
  return cleanText(value) || '--'
}

function normalizeModelToken(token: string) {
  return token.replace(/[-_]/g, '').toUpperCase()
}

function inferChipset() {
  const model = cleanText(boardData.value?.model)
  const match = model.match(/(Z\d{3,4}|B\d{3,4}|H\d{3,4}|X\d{3,4}E?|TRX\d{2,3}|A\d{3}|Q\d{3}|W\d{3})/i)
  if (match) return normalizeModelToken(match[1])
  return cleanText(cpuData.value?.family) || '--'
}

function inferVendorWebsite() {
  const manufacturer = cleanText(boardData.value?.manufacturer).toLowerCase()
  if (manufacturer.includes('asus')) return 'https://www.asus.com/'
  if (manufacturer.includes('msi')) return 'https://www.msi.com/'
  if (manufacturer.includes('gigabyte')) return 'https://www.gigabyte.com/'
  if (manufacturer.includes('asrock')) return 'https://www.asrock.com/'
  return '--'
}

function formatMemorySlot(item?: MemoLayoutData) {
  if (!item || !item.size) return '空'
  return joinParts([
    `${bytesToGB(item.size)} GB`,
    item.type,
    item.clockSpeed ? `${item.clockSpeed} MHz` : '',
  ])
}

function buildMemorySlots() {
  const actualSlots = memoLayoutData.value.length
  const slotCount = boardData.value?.memSlots && boardData.value.memSlots > 0 ? boardData.value.memSlots : actualSlots
  return Array.from({ length: slotCount }, (_, index) => {
    const item = memoLayoutData.value[index]
    const bank = cleanText(item?.bank) || `DIMM_${String.fromCharCode(65 + Math.floor(index / 2))}${(index % 2) + 1}`
    return {
      bank,
      type: cleanText(item?.type) || cleanText(memoLayoutData.value[0]?.type) || '--',
      status: item?.size ? formatMemorySlot(item) : '空',
      installed: Boolean(item?.size),
    }
  })
}

function makePlaceholderRows(message: string): BoardListRow[] {
  return [{ label: '当前版本', primary: message }]
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

const boardName = computed(() => joinParts([boardData.value?.manufacturer, boardData.value?.model]) || '主板信息读取中')
const chipsetName = computed(() => inferChipset())
const memorySlots = computed(() => buildMemorySlots())
const installedMemoryModules = computed(() => memoLayoutData.value.filter((item) => item.size > 0))
const usedSlotCount = computed(() => installedMemoryModules.value.length)
const reportedMemorySlotCount = computed(() => Math.max(0, boardData.value?.memSlots || 0))
const inferredMemorySlotCount = computed(() => memoLayoutData.value.length)
const memorySlotTotal = computed(() => (reportedMemorySlotCount.value > 0 ? reportedMemorySlotCount.value : inferredMemorySlotCount.value))
const maxMemoryClock = computed(() => Math.max(0, ...memoLayoutData.value.map((item) => item.clockSpeed || 0)))
const primaryGpu = computed(() => hardwareStore.primaryGpu.value)

const heroSpecs = computed(() => [
  { label: '厂商', value: cleanText(boardData.value?.manufacturer) || '--' },
  { label: '芯片组', value: chipsetName.value },
  { label: '插槽', value: cleanText(cpuData.value?.socket) || '--' },
  { label: '发布日期', value: formatDate(biosData.value?.releaseDate) },
  { label: 'PCB 版本', value: cleanText(boardData.value?.version) || '--' },
  { label: 'BIOS 版本', value: cleanText(biosData.value?.version) || '--' },
  { label: '内存上限', value: boardData.value?.memMax ? formatBytes(boardData.value.memMax) : '--' },
  { label: '插槽数量', value: `${memorySlotTotal.value || 0} 个` },
  { label: '固件模式', value: cleanText(biosData.value?.vendor) ? 'UEFI / Legacy 兼容' : '--' },
])

const boardTabs = [
  { id: 'slots' as const, label: '扩展插槽', icon: Chip },
  { id: 'storage' as const, label: '存储接口', icon: HardDisk },
  { id: 'usb' as const, label: 'USB 接口', icon: Memory },
  { id: 'io' as const, label: '网络与音频', icon: Signal },
]

const tabRows = computed<Record<BoardTabKey, BoardListRow[]>>(() => {
  const slotRows: BoardListRow[] = []

  if (primaryGpu.value) {
    slotRows.push({
      label: '主显卡插槽',
      primary: primaryGpu.value.bus || 'PCIe',
      secondary: joinParts([primaryGpu.value.pciBus, primaryGpu.value.model || primaryGpu.value.name], ' / '),
    })
  }

  if (boardData.value?.memSlots) {
    slotRows.push({
      label: 'DIMM 插槽',
      primary: `${usedSlotCount.value} / ${boardData.value.memSlots} 已占用`,
      secondary: cleanText(memoLayoutData.value[0]?.type) || '内存类型待识别',
    })
  }

  if (!slotRows.length) {
    slotRows.push({
      label: '板载扩展',
      primary: '系统 API 未提供板级 PCIe 拓扑',
      secondary: '当前展示可识别的显卡 / 内存插槽信息',
    })
  }

  const storageRows = diskLayoutData.value.length
    ? diskLayoutData.value.map((item, index) => ({
        label: cleanText(item.interfaceType) || `存储接口 ${index + 1}`,
        primary: cleanText(item.name) || cleanText(item.device) || '未知设备',
        secondary: joinParts([item.size ? formatBytes(item.size) : '', item.type, item.firmwareRevision], ' / '),
      }))
    : makePlaceholderRows('当前机器未返回可识别的主板级存储通道')

  const usbRows = makePlaceholderRows('当前数据链未提供主板 USB 端口级枚举，后续可接入 USB 设备服务补齐')

  const ioRows = [
    ...networkInterfaces.value
      .filter((item) => !item.internal || item.default)
      .slice(0, 3)
      .map((item) => ({
        label: '网络控制器',
        primary: cleanText(item.ifaceName) || cleanText(item.iface) || '网络设备',
        secondary: joinParts([item.type, item.speed ? `${item.speed} Mbps` : '', item.operstate], ' / '),
      })),
    ...audioDevices.value.slice(0, 3).map((item) => ({
      label: '音频控制器',
      primary: cleanText(item.name) || '音频设备',
      secondary: joinParts([item.manufacturer, item.driver || item.type], ' / '),
    })),
  ]

  return {
    slots: slotRows,
    storage: storageRows,
    usb: usbRows,
    io: ioRows.length ? ioRows : makePlaceholderRows('未识别到板载网络或音频控制器'),
  }
})

const memorySpecRows = computed(() => [
  { label: '支持类型', value: cleanText(memoLayoutData.value[0]?.type) || '--' },
  { label: '最大容量', value: boardData.value?.memMax ? formatBytes(boardData.value.memMax) : '--' },
  { label: '已用插槽', value: `${usedSlotCount.value} / ${memorySlotTotal.value || 0}` },
  { label: '当前频率', value: maxMemoryClock.value ? `${maxMemoryClock.value} MHz` : '--' },
])

const biosRows = computed(() => [
  { label: 'BIOS 厂商', value: cleanText(biosData.value?.vendor) || '--' },
  { label: 'BIOS 版本', value: cleanText(biosData.value?.version) || '--' },
  { label: 'BIOS 日期', value: formatDate(biosData.value?.releaseDate) },
  { label: '修订版本', value: cleanText(biosData.value?.revision) || '--' },
  { label: '固件语言', value: cleanText(biosData.value?.language) || '--' },
])

const chipsetRows = computed(() => [
  { label: '主板芯片组', value: chipsetName.value },
  { label: 'CPU 插槽', value: cleanText(cpuData.value?.socket) || '--' },
  { label: 'PCB 版本', value: cleanText(boardData.value?.version) || '--' },
  { label: '默认网卡', value: cleanText(networkInterfaces.value.find((item) => item.default)?.ifaceName) || cleanText(networkInterfaces.value[0]?.ifaceName) || '--' },
  { label: '默认音频', value: cleanText(audioDevices.value.find((item) => item.default)?.name) || cleanText(audioDevices.value[0]?.name) || '--' },
])

const featureRows = computed(() => {
  const features = [
    cleanText(biosData.value?.vendor) ? 'UEFI 固件支持' : '',
    boardData.value?.memSlots ? `${boardData.value.memSlots} 个内存插槽` : '',
    boardData.value?.memMax ? `最大内存 ${formatBytes(boardData.value.memMax)}` : '',
    audioDevices.value.length ? '板载音频已识别' : '',
    networkInterfaces.value.some((item) => !item.internal) ? '板载网络已识别' : '',
    biosData.value?.features?.[0] || '',
  ].filter(Boolean)

  return features.length ? features.slice(0, 5) : ['当前机器未返回可展示的主板特性']
})

const manufacturingRows = computed(() => [
  { label: '制造商', value: cleanText(boardData.value?.manufacturer) || '--' },
  { label: '官方网站', value: inferVendorWebsite() },
  { label: '产品序列号', value: cleanText(boardData.value?.serial) || cleanText(biosData.value?.serial) || '--' },
  { label: '资产标签', value: cleanText(boardData.value?.assetTag) || '--' },
  { label: '操作系统', value: joinParts([osInfo.value?.distro || osInfo.value?.platform, osInfo.value?.release, osInfo.value?.arch]) || '--' },
])

const boardReportText = computed(() => {
  const lines = [
    '主板页面报告',
    `导出时间：${new Date().toLocaleString('zh-CN')}`,
    '',
    `主板：${boardName.value}`,
    `芯片组：${chipsetName.value}`,
    `CPU 插槽：${cleanText(cpuData.value?.socket) || '--'}`,
    `BIOS：${joinParts([biosData.value?.vendor, biosData.value?.version, biosData.value?.releaseDate], ' / ') || '--'}`,
    '',
    ...memorySlots.value.map((item) => `${item.bank}：${item.status}`),
    '',
    ...manufacturingRows.value.map((item) => `${item.label}：${item.value}`),
  ]

  return lines.join('\n')
})

function exportReport() {
  const blob = new Blob([boardReportText.value], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `board-report-${new Date().toISOString().slice(0, 10)}.txt`
  anchor.click()
  URL.revokeObjectURL(url)
}

async function copyBoardInfo() {
  try {
    await writeClipboard(boardReportText.value)
    return true
  } catch (error) {
    console.error('复制主板信息失败:', error)
    return false
  }
}

defineExpose({
  exportReport,
  copyBoardInfo,
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
  <div class="board-page">
    <div v-if="loading" class="board-empty">正在同步主板数据...</div>

    <template v-else>
      <section class="board-hero">
        <article class="hero-card">
          <div class="hero-card__head">
            <div class="hero-card__title">
              <h2>{{ boardName }}</h2>
              <p>{{ joinParts([chipsetName, cpuData?.socket, biosData?.version], ' / ') || '等待主板识别' }}</p>
            </div>
          </div>

          <div class="hero-specs">
            <div v-for="item in heroSpecs" :key="item.label" class="hero-spec">
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
            </div>
          </div>
        </article>
      </section>

      <section class="board-middle">
        <article class="board-panel board-panel--wide">
          <div class="board-panel__tabs">
            <button
              v-for="tab in boardTabs"
              :key="tab.id"
              type="button"
              :class="['board-tab', { 'board-tab--active': activeTab === tab.id }]"
              @click="activeTab = tab.id"
            >
              <component :is="tab.icon" theme="outline" size="15" fill="currentColor" :strokeWidth="3" />
              <span>{{ tab.label }}</span>
            </button>
          </div>

          <div class="board-panel__body board-panel__body--split">
            <div class="board-list">
              <div v-for="row in tabRows[activeTab]" :key="`${activeTab}-${row.label}-${row.primary}`" class="board-list__row">
                <span>{{ row.label }}</span>
                <strong>{{ row.primary }}</strong>
                <em v-if="row.secondary">{{ row.secondary }}</em>
              </div>
            </div>

            <div class="board-schematic" :data-active-tab="activeTab">
              <div class="board-schematic__outline">
                <div class="board-schematic__cpu"></div>
                <div class="board-schematic__ram bank-1"></div>
                <div class="board-schematic__ram bank-2"></div>
                <div class="board-schematic__slot slot-1"></div>
                <div class="board-schematic__slot slot-2"></div>
                <div class="board-schematic__slot slot-3"></div>
                <div class="board-schematic__io"></div>
              </div>
            </div>
          </div>
        </article>

        <article class="board-panel">
          <div class="board-panel__title">
            <h3>内存插槽</h3>
            <p>{{ usedSlotCount }} / {{ memorySlotTotal || 0 }} 已安装</p>
          </div>

          <div class="memory-slot-list">
            <div v-for="slot in memorySlots" :key="slot.bank" :class="['memory-slot', { 'memory-slot--filled': slot.installed }]">
              <span>{{ slot.bank }}</span>
              <strong>{{ slot.type }}</strong>
              <em>{{ slot.status }}</em>
            </div>
          </div>

          <div class="board-panel__title board-panel__title--sub">
            <h3>内存规格</h3>
            <p>按当前主板与已安装模组估算</p>
          </div>

          <div class="detail-specs">
            <div v-for="item in memorySpecRows" :key="item.label" class="detail-spec">
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
            </div>
          </div>
        </article>
      </section>

      <section class="board-bottom">
        <article class="board-panel">
          <div class="board-panel__title">
            <h3>BIOS 信息</h3>
            <p>固件版本与兼容信息</p>
          </div>

          <div class="detail-specs">
            <div v-for="item in biosRows" :key="item.label" class="detail-spec">
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
            </div>
          </div>
        </article>

        <article class="board-panel">
          <div class="board-panel__title">
            <h3>芯片组</h3>
            <p>平台控制器与板载控制器识别</p>
          </div>

          <div class="detail-specs">
            <div v-for="item in chipsetRows" :key="item.label" class="detail-spec">
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
            </div>
          </div>
        </article>

        <article class="board-panel">
          <div class="board-panel__title">
            <h3>特色功能</h3>
            <p>基于固件与设备识别结果生成</p>
          </div>

          <div class="feature-list">
            <div v-for="item in featureRows" :key="item" class="feature-item">
              <span class="feature-item__dot"></span>
              <strong>{{ item }}</strong>
            </div>
          </div>
        </article>
      </section>

      <section class="board-manufacturing">
        <div class="board-panel__title">
          <h3>制造信息</h3>
          <p>厂商、序列号与系统环境概览</p>
        </div>

        <div class="manufacturing-grid">
          <div v-for="item in manufacturingRows" :key="item.label" class="manufacturing-row">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped lang="less">
.board-page {
  height: 100%;
  min-height: 0;
  overflow: auto;
}

.board-empty {
  display: grid;
  place-items: center;
  min-height: 320px;
  color: var(--text-muted);
  font-size: 15px;
}

.board-page,
.board-empty {
  padding-right: 2px;
}

.board-hero,
.board-middle,
.board-bottom {
  display: grid;
  gap: 12px;
  margin-bottom: 12px;
}

.board-hero {
  grid-template-columns: 1fr;
}

.board-middle {
  grid-template-columns: 1.35fr 0.7fr;
}

.board-bottom {
  grid-template-columns: 1.05fr 0.8fr 0.9fr;
}

.hero-card,
.board-panel,
.board-manufacturing {
  border: 1px solid rgba(84, 104, 132, 0.2);
  border-radius: 18px;
  background:
    linear-gradient(180deg, rgba(26, 36, 50, 0.96), rgba(19, 28, 41, 0.94)),
    radial-gradient(circle at top right, rgba(74, 126, 255, 0.12), transparent 34%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.03),
    0 18px 34px rgba(5, 10, 18, 0.16);
}

.hero-card {
  padding: 18px 20px 18px;
}

.hero-card__head {
  display: block;
}

.hero-card__title {
  h2 {
    margin: 0;
    color: #f3f7fd;
    font-size: 20px;
    font-weight: 700;
    line-height: 1.25;
  }

  p {
    margin: 8px 0 0;
    color: var(--text-muted);
    font-size: 14px;
  }
}

.hero-specs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0 14px;
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid rgba(86, 101, 126, 0.18);
}

.hero-spec {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 0 10px;

  span {
    color: var(--text-subtle);
    font-size: 13px;
  }

  strong {
    color: #f5f8fd;
    font-size: 15px;
    font-weight: 700;
  }
}

.board-panel,
.board-manufacturing {
  padding: 16px 18px 18px;
}

.board-panel--wide {
  min-width: 0;
}

.board-panel__title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;

  h3 {
    margin: 0;
    color: #f4f7fd;
    font-size: 16px;
    font-weight: 700;
  }

  p {
    margin: 6px 0 0;
    color: var(--text-subtle);
    font-size: 13px;
  }
}

.board-panel__title--sub {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid rgba(86, 101, 126, 0.14);
}

.board-panel__tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
  overflow: auto;
}

.board-tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 0 14px;
  border: 1px solid rgba(84, 104, 132, 0.24);
  border-radius: 12px;
  background: rgba(18, 29, 44, 0.62);
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
}

.board-tab--active {
  border-color: rgba(67, 133, 255, 0.34);
  background: rgba(28, 52, 84, 0.68);
  color: #f5f9ff;
  box-shadow: inset 0 -2px 0 #3fa7ff;
}

.board-panel__body--split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 238px;
  gap: 16px;
  min-height: 290px;
}

.board-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.board-list__row {
  display: grid;
  grid-template-columns: 118px minmax(0, 1fr);
  gap: 10px 14px;
  padding: 12px 0;
  border-bottom: 1px solid rgba(86, 101, 126, 0.08);

  span {
    color: var(--text-subtle);
    font-size: 13px;
  }

  strong {
    color: var(--text-secondary);
    font-size: 14px;
    font-weight: 700;
  }

  em {
    grid-column: 2;
    color: var(--text-muted);
    font-style: normal;
    font-size: 12px;
  }
}

.board-schematic {
  display: grid;
  place-items: center;
  border-left: 1px solid rgba(86, 101, 126, 0.12);
}

.board-schematic__outline {
  position: relative;
  width: 188px;
  height: 270px;
  border-radius: 18px;
  border: 1px solid rgba(124, 144, 173, 0.22);
  background:
    linear-gradient(180deg, rgba(17, 24, 35, 0.94), rgba(13, 20, 30, 0.96)),
    radial-gradient(circle at top right, rgba(88, 146, 255, 0.12), transparent 30%);
}

.board-schematic__cpu,
.board-schematic__ram,
.board-schematic__slot,
.board-schematic__io {
  position: absolute;
  border: 1px solid rgba(186, 201, 223, 0.18);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  transition: box-shadow 0.18s ease, border-color 0.18s ease, background 0.18s ease;
}

.board-schematic__cpu { top: 34px; left: 78px; width: 48px; height: 48px; }
.board-schematic__ram { top: 24px; right: 22px; width: 12px; height: 82px; }
.board-schematic__ram.bank-2 { right: 38px; }
.board-schematic__slot { left: 28px; width: 86px; height: 12px; }
.board-schematic__slot.slot-1 { top: 150px; }
.board-schematic__slot.slot-2 { top: 182px; }
.board-schematic__slot.slot-3 { top: 214px; }
.board-schematic__io { top: 26px; left: 18px; width: 18px; height: 118px; }

.board-schematic[data-active-tab='slots'] .board-schematic__slot,
.board-schematic[data-active-tab='storage'] .board-schematic__slot.slot-2,
.board-schematic[data-active-tab='usb'] .board-schematic__io,
.board-schematic[data-active-tab='io'] .board-schematic__cpu {
  border-color: rgba(69, 154, 255, 0.48);
  background: rgba(53, 132, 255, 0.14);
  box-shadow: 0 0 0 1px rgba(52, 130, 255, 0.16);
}

.memory-slot-list,
.detail-specs,
.feature-list {
  display: grid;
  gap: 8px;
}

.memory-slot {
  display: grid;
  grid-template-columns: 92px 72px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid rgba(86, 101, 126, 0.08);

  span {
    color: var(--text-subtle);
    font-size: 13px;
  }

  strong {
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 700;
  }

  em {
    color: var(--text-muted);
    font-style: normal;
    font-size: 13px;
  }
}

.memory-slot--filled em {
  color: #eef3fb;
}

.detail-spec {
  display: grid;
  grid-template-columns: 108px minmax(0, 1fr);
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid rgba(86, 101, 126, 0.08);

  span {
    color: var(--text-subtle);
    font-size: 13px;
  }

  strong {
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 600;
  }
}

.feature-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;

  strong {
    color: var(--text-secondary);
    font-size: 14px;
    font-weight: 600;
  }
}

.feature-item__dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: #8fd86a;
  box-shadow: 0 0 0 3px rgba(90, 155, 57, 0.18);
}

.manufacturing-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px 18px;
}

.manufacturing-row {
  display: grid;
  gap: 6px;

  span {
    color: var(--text-subtle);
    font-size: 13px;
  }

  strong {
    color: var(--text-secondary);
    font-size: 14px;
    font-weight: 600;
    word-break: break-word;
  }
}

@media (max-width: 1320px) {
  .board-hero,
  .board-middle,
  .board-bottom {
    grid-template-columns: 1fr;
  }

  .manufacturing-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 980px) {
  .hero-card__head,
  .board-panel__body--split,
  .hero-specs,
  .board-status__grid,
  .manufacturing-grid {
    grid-template-columns: 1fr;
  }

  .board-list__row,
  .memory-slot,
  .detail-spec {
    grid-template-columns: 1fr;
  }

  .board-list__row em {
    grid-column: auto;
  }

  .board-schematic {
    border-left: 0;
    border-top: 1px solid rgba(86, 101, 126, 0.12);
    padding-top: 16px;
  }
}
</style>
