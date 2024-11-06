<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

const cpuData = ref<CpuData>()
const memoData = ref<MemoData>({
  active: 0,
  available: 0,
  total: 0,
})
const gpuData = ref<GpuData[]>()
const boardData = ref<BoardData>()
const loading = ref<boolean>(false)

let memoLayoutData = ref<MemoLayoutData[]>([])
let diskData = ref<DiskData[]>([])
let winId = ref<string>()
let watchMemoTimerId: NodeJS.Timeout

onMounted(() => {
  watchMemoTimerId = setInterval(() => {
    queryMemo()
  }, 2000)
  winId.value = window.services.getWinId()
})
onUnmounted(() => {
  clearInterval(watchMemoTimerId)
})
async function queryMemo() {
  memoData.value = await window.services.getMemInfo()
}

async function init() {
  loading.value = true
  try {
    const [cpuRes, memoRes, memoLayoutRes, gpuRes, diskRes, boardRes] = await Promise.allSettled([
      window.services.getCpuInfo(),
      window.services.getMemInfo(),
      window.services.getMemoryLayout(),
      window.services.getGpuInfo(),
      window.services.getDiskData(),
      window.services.getBoardData(),
    ])
    loading.value = false
    if (cpuRes.status === 'fulfilled') {
      cpuData.value = cpuRes.value
    }
    if (memoRes.status === 'fulfilled') {
      memoData.value = memoRes.value
    }
    if (memoLayoutRes.status === 'fulfilled') {
      memoLayoutData.value = memoLayoutRes.value
      // console.log(memoLayoutData);
    }
    if (gpuRes.status === 'fulfilled') {
      gpuData.value = gpuRes.value
      console.log(gpuData)
    }
    if (diskRes.status === 'fulfilled') {
      diskData.value = diskRes.value
    }
    if (boardRes.status === 'fulfilled') {
      boardData.value = boardRes.value
    }
  } catch {
    loading.value = false
  }
}
onMounted(() => {
  init()
})
</script>

<template>
  <div class="container">
    <Bar />
    <div class="content">
      <el-scrollbar>
        <div class="main-container">
          <el-skeleton :loading="loading" animated>
            <template #default>
              <!-- CPU信息卡片 -->
              <el-card class="info-card mb-2" shadow="hover">
                <CpuCard :data="cpuData" />
              </el-card>

              <!-- 内存信息卡片 -->
              <el-card class="info-card mb-2" shadow="hover">
                <MemoCard :data="memoData" :memoLayoutData="memoLayoutData" :loading="loading" :queryMemo="queryMemo" />
              </el-card>

              <!-- 主板信息卡片 -->
              <el-card class="info-card mb-2" shadow="hover">
                <BoardCard :data="boardData" />
              </el-card>

              <!-- GPU信息卡片 -->
              <el-card class="info-card mb-2" shadow="hover">
                <GpuCard :data="gpuData" />
              </el-card>

              <!-- 硬盘信息卡片 -->
              <el-card class="info-card" shadow="hover">
                <DiskCard :data="diskData" />
              </el-card>
            </template>
          </el-skeleton>

          <!-- 加载状态 -->
          <div v-if="loading" class="loading-container">
            <el-empty description="正在加载中">
              <template #image>
                <el-icon class="loading-icon"><Loading /></el-icon>
              </template>
            </el-empty>
          </div>
        </div>
      </el-scrollbar>
    </div>
  </div>
</template>

<style scoped lang="less">
.container {
  height: 100vh;
  width: 100%;
  background-color: var(--el-bg-color);
  display: flex;
  flex-direction: column;

  .content {
    flex: 1;
    overflow: hidden;

    .main-container {
      padding: 10px;
      max-width: 450px;
      margin: 0 auto;
    }

    .info-card {
      border-radius: 8px;
      transition: all 0.2s ease;

      :deep(.el-card__body) {
        padding: 10px;
      }

      &:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      }
    }

    .mb-2 {
      margin-bottom: 10px;
    }

    .loading-container {
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;

      .loading-icon {
        font-size: 24px;
        color: var(--el-color-primary);
        animation: rotating 2s linear infinite;
      }
    }
  }
}

@keyframes rotating {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
