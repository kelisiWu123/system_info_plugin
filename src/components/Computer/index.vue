<script setup lang="ts">
import { onMounted, ref, watch } from "vue";

const cpuData = ref<CpuData>();
const memoData = ref<MemoData>();
const gpuData = ref<GpuData>();
const boardData = ref<BoardData>()
const loading = ref<boolean>(false);
const watchMemo = ref(false);
let memoLayoutData = ref<MemoLayoutData[]>([]);
let diskData = ref<DiskData[]>([]);

let watchMemoTimerId: NodeJS.Timeout;

async function queryMemo() {
  memoData.value = await window.services.getMemInfo();
}

watch(watchMemo, () => {
  console.log("这时有触发吗");
  if (watchMemo.value) {
    watchMemoTimerId = setInterval(() => {
      queryMemo();
    }, 2000);
  } else {
    clearInterval(watchMemoTimerId);
  }
});

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
      console.log(memoLayoutData);
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
  <div v-loading="loading">
    <CpuCard :data="cpuData" />
    <BoardCard :data="boardData" />
    <GpuCard :data="gpuData" />
    <MemoCard
        :data="memoData"
        :memoLayoutData="memoLayoutData"
        :loading="loading"
        :watchMemo-="watchMemo"
        :queryMemo="queryMemo"
    />
    <DiskCard :data="diskData" />

  </div>

</template>

<style scoped></style>
