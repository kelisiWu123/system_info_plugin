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
const loading = ref<boolean>(true)

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
  try {
    const [cpuRes, memoRes, memoLayoutRes, gpuRes, diskRes, boardRes] = await Promise.allSettled([
      window.services.getCpuInfo(),
      window.services.getMemInfo(),
      window.services.getMemoryLayout(),
      window.services.getGpuInfo(),
      window.services.getDiskData(),
      window.services.getBoardData(),
    ])

    if (cpuRes.status === 'fulfilled') {
      cpuData.value = cpuRes.value
    }
    if (memoRes.status === 'fulfilled') {
      memoData.value = memoRes.value
    }
    if (memoLayoutRes.status === 'fulfilled') {
      memoLayoutData.value = memoLayoutRes.value
    }
    if (gpuRes.status === 'fulfilled') {
      gpuData.value = gpuRes.value
    }
    if (diskRes.status === 'fulfilled') {
      diskData.value = diskRes.value
    }
    if (boardRes.status === 'fulfilled') {
      boardData.value = boardRes.value
    }
  } catch (error) {
    console.error('初始化数据失败:', error)
  }
  loading.value = false
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
          <div v-if="loading" class="loading-container">
            <el-empty description="正在加载中">
              <template #image>
                <el-icon class="loading-icon"><Loading /></el-icon>
              </template>
            </el-empty>
          </div>

          <template v-else>
            <!-- CPU信息卡片 -->
            <el-card class="info-card mb-2" shadow="hover">
              <CpuCard :data="cpuData" />
            </el-card>

            <!-- 内存和显卡信息卡片 -->
            <el-card class="info-card mb-2" shadow="hover">
              <MemoCard :data="memoData" :memoLayoutData="memoLayoutData" :gpuData="gpuData" :loading="loading" :queryMemo="queryMemo" />
            </el-card>

            <!-- 主板信息卡片 -->
            <el-card class="info-card mb-2" shadow="hover">
              <BoardCard :data="boardData" />
            </el-card>

            <!-- 硬盘信息卡片 -->
            <el-card class="info-card" shadow="hover">
              <DiskCard :data="diskData" />
            </el-card>
          </template>
        </div>
      </el-scrollbar>
    </div>
  </div>
</template>

<style scoped lang="less">
.container {
  height: 100%;
  width: 100%;
  background: linear-gradient(180deg, #ffffff 0%, var(--apple-gray) 100%);
  display: flex;
  flex-direction: column;

  .content {
    flex: 1;
    overflow: hidden;

    .main-container {
      max-width: 700px;
      margin: 0 auto;
      padding: 20px;

      .info-card {
        background: var(--card-bg) !important;
        backdrop-filter: blur(20px);
        border: none !important;
        border-radius: var(--el-border-radius-base);
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        margin-bottom: 16px;
        box-shadow:
          0 1px 3px rgba(0, 0, 0, 0.02),
          0 1px 2px rgba(0, 0, 0, 0.04);

        &:hover {
          transform: translateY(-2px);
          box-shadow:
            0 4px 12px rgba(0, 0, 0, 0.05),
            0 2px 4px rgba(0, 0, 0, 0.08);
        }

        &:last-child {
          margin-bottom: 0;
        }

        :deep(.el-card__body) {
          padding: 20px;
        }
      }

      .loading-container {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 200px;

        .loading-icon {
          font-size: 24px;
          color: var(--el-color-primary);
          animation: rotating 2s linear infinite;
        }
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
