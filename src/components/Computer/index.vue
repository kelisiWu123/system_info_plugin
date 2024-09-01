<script setup lang="ts">
import {onMounted, onUnmounted, ref} from "vue";


const cpuData = ref<CpuData>();
const memoData = ref<MemoData>({
  active:0,
  available:0,
  total:0
});
const gpuData = ref<GpuData[]>();
const boardData = ref<BoardData>()
const loading = ref<boolean>(false);

let memoLayoutData = ref<MemoLayoutData[]>([]);
let diskData = ref<DiskData[]>([]);

let watchMemoTimerId: NodeJS.Timeout;

onMounted(()=>{
  watchMemoTimerId = setInterval(() => {
    queryMemo();
  }, 2000);
})
onUnmounted(()=>{
  clearInterval(watchMemoTimerId)
})
async function queryMemo() {
  memoData.value = await window.services.getMemInfo();
}


async function init() {
  loading.value = true;
  try {
    const [cpuRes, memoRes, memoLayoutRes, gpuRes, diskRes,boardRes] =
      await Promise.allSettled([
        window.services.getCpuInfo(),
        window.services.getMemInfo(),
        window.services.getMemoryLayout(),
        window.services.getGpuInfo(),
        window.services.getDiskData(),
        window.services.getBoardData()
      ]);
    loading.value = false;
    if (cpuRes.status === "fulfilled") {
      cpuData.value = cpuRes.value;
    }
    if (memoRes.status === "fulfilled") {
      memoData.value = memoRes.value;
    }
    if (memoLayoutRes.status === "fulfilled") {
      memoLayoutData.value = memoLayoutRes.value;
      // console.log(memoLayoutData);
    }
    if (gpuRes.status === "fulfilled") {
      gpuData.value = gpuRes.value;
      console.log(gpuData);
    }
    if (diskRes.status === "fulfilled") {
      diskData.value = diskRes.value;
    }
    if (boardRes.status === 'fulfilled'){
      boardData.value = boardRes.value
    }
  } catch {
    loading.value = false;
  }
}
onMounted(() => {
  init();
});
</script>

<template>
  <Bar/>
  <div class="content">

    <template v-if="!loading">
      <div style="display: flex;margin-bottom: 20px">
        <CpuCard :data="cpuData" />
        <BoardCard :data="boardData" />
      </div>

      <div style="display: flex">
        <MemoCard
            :data="memoData"
            :memoLayoutData="memoLayoutData"
            :loading="loading"
            :queryMemo="queryMemo"
        />
        <div style="display: flex;flex-direction: column">
          <div style="margin-bottom: 20px">
            <GpuCard :data="gpuData" />
          </div>

          <DiskCard :data="diskData" />
        </div>

      </div>
    </template>
    <template v-else>
      <div v-loading="loading"   >
        <el-empty description="正在加载中" />
      </div>
    </template>
  </div>



</template>

<style scoped >
.content{
  height: 100%;
  width: 100%;
  min-width: 700px;
  overflow: auto;
  background-color: #ffffff;
  padding: 20px 0;
}
</style>
