<script setup lang="ts">
import { Cpu, Disk, DownloadOne, UploadOne } from '@icon-park/vue-next'
import { onMounted, onUnmounted, ref, toRefs, computed, reactive, watch } from 'vue'
import { bytesToMB } from '../../utils.ts'

const memoData = reactive<MemoData>({
  active: 0,
  available: 0,
  total: 0,
})
const netData = ref<NetworkStateData>({
  tx_sec: 0,
  rx_sec: 0,
})
const drawer = ref(false)
const cpu_fullLoad = ref<number>(0)
const cpuShow = ref(true)
const memoShow = ref(true)
const netShow = ref(true)

const getCpuFullLoad = async () => {
  cpu_fullLoad.value = await window.services.getCpuFullLoad()
}

async function getMemo() {
  const memo = await window.services.getMemInfo()
  memoData.active = memo.active
  memoData.total = memo.total
  memoData.available = memo.available
}

async function getNetwork() {
  const net = await window.services.getNetworkInfo()
  netData.value = net
}

let timerId: { [key: string]: NodeJS.Timeout | undefined } = {
  cpu: undefined,
  memo: undefined,
  net: undefined,
}

onMounted(() => {
  timerId.cpu = setInterval(() => {
    getCpuFullLoad()
  }, 2000)
  timerId.net = setInterval(() => {
    getNetwork()
  }, 2000)
  timerId.memo = setInterval(() => {
    getMemo()
  }, 2000)
})

onUnmounted(() => {
  for (let key in timerId) {
    clearInterval(timerId[key])
  }
})

const colors = [
  { color: '#67C23A', percentage: 60 },
  { color: '#E6A23C', percentage: 80 },
  { color: '#F56C6C', percentage: 100 },
]

const { active, total } = toRefs(memoData)
const usedMemoPercent = computed(() => {
  if (active.value > 0) {
    return (active.value / total.value) * 100
  } else {
    return 0
  }
})

function openSetting() {
  drawer.value = true
}

watch(cpuShow, () => {
  if (cpuShow.value) {
    timerId.cpu = setInterval(() => {
      getCpuFullLoad()
    }, 2000)
  } else {
    clearInterval(timerId.cpu)
  }
})

watch(memoShow, () => {
  if (memoShow.value) {
    timerId.memo = setInterval(() => {
      getMemo()
    }, 2000)
  } else {
    clearInterval(timerId.memo)
  }
})

watch(netShow, () => {
  if (netShow.value) {
    timerId.net = setInterval(() => {
      getNetwork()
    }, 2000)
  } else {
    clearInterval(timerId.net)
  }
})
</script>

<template>
  <div class="container">
    <Bar />
    <div class="content">
      <template v-if="cpuShow">
        <WatchRow>
          <template #icon>
            <el-tooltip placement="right" content="cpu使用率">
              <Cpu theme="outline" size="16" fill="var(--el-color-primary)" :strokeWidth="3" />
            </el-tooltip>
          </template>
          <template #content>
            <el-progress :percentage="Number(cpu_fullLoad.toFixed(0))" :color="colors" :stroke-width="18" :text-inside="true" />
          </template>
        </WatchRow>
      </template>

      <template v-if="memoShow">
        <WatchRow>
          <template #icon>
            <el-tooltip placement="right" content="内存使用率">
              <Disk theme="outline" size="16" fill="var(--el-color-primary)" :strokeWidth="3" />
            </el-tooltip>
          </template>
          <template #content>
            <el-progress :percentage="Number(usedMemoPercent.toFixed(0))" :color="colors" :stroke-width="18" :text-inside="true" />
          </template>
        </WatchRow>
      </template>

      <template v-if="netShow">
        <WatchRow>
          <template #icon>
            <el-tooltip placement="right" content="下载速率">
              <DownloadOne theme="outline" size="16" fill="var(--el-color-primary)" :strokeWidth="3" />
            </el-tooltip>
          </template>
          <template #content>
            <div class="network-speed">{{ bytesToMB(netData?.rx_sec).toFixed(2) }} MB/s</div>
          </template>
        </WatchRow>

        <WatchRow>
          <template #icon>
            <el-tooltip placement="right" content="上传速率">
              <UploadOne theme="outline" size="16" fill="var(--el-color-primary)" :strokeWidth="3" />
            </el-tooltip>
          </template>
          <template #content>
            <div class="network-speed">{{ bytesToMB(netData?.tx_sec).toFixed(2) }} MB/s</div>
          </template>
        </WatchRow>
      </template>
    </div>

    <div class="settings-button" @click="openSetting">
      <span class="iconfont icon-setting" />
    </div>

    <el-drawer v-model="drawer" :with-header="false" size="200px" class="settings-drawer">
      <div class="settings-content">
        <div class="setting-item">
          <el-switch size="small" v-model="cpuShow" active-text="CPU" />
        </div>
        <div class="setting-item">
          <el-switch size="small" v-model="memoShow" active-text="运存" />
        </div>
        <div class="setting-item">
          <el-switch size="small" v-model="netShow" active-text="网络" />
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<style lang="less" scoped>
.container {
  height: 100%;
  width: 100%;
  background-color: var(--el-bg-color);
  display: flex;
  flex-direction: column;
  position: relative;

  .content {
    flex: 1;
    padding: 12px;
    padding-bottom: 40px;
    overflow: auto;

    :deep(.el-progress) {
      margin: 4px 0;
    }
  }

  .network-speed {
    font-size: 14px;
    font-weight: 500;
    color: var(--el-color-primary);
    text-align: right;
    padding: 8px 0;
  }

  .settings-button {
    position: fixed;
    bottom: 12px;
    right: 12px;
    width: 24px;
    height: 24px;
    border-radius: 6px;
    background: var(--el-color-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    opacity: 0.8;
    z-index: 10;

    &:hover {
      opacity: 1;
      transform: rotate(30deg);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    .icon-setting {
      color: white;
      font-size: 14px;
    }
  }

  .settings-drawer {
    :deep(.el-drawer__body) {
      padding: 0;
    }

    .settings-content {
      padding: 16px;

      .setting-item {
        margin-bottom: 16px;
      }
    }
  }
}
</style>
