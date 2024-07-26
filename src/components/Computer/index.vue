<script setup lang="ts">
import { onMounted, ref, watch } from "vue";

const cpuData = ref<CpuData>();
const memoData = ref<MemoData>();
let memoLayoutData = ref<MemoLayoutData[]>([]);
const loading = ref<boolean>(false);
const watchMemo = ref(false);
let watchMemoTimerId: NodeJS.Timeout;
function onWatchMemoChange() {
  watchMemo.value = !watchMemo.value;
}
async function queryMemo() {
  console.log("queryMemo");
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
    const [cpuRes, memoRes, memoLayoutRes] = await Promise.allSettled([
      window.services.getCpuInfo(),
      window.services.getMemInfo(),
      window.services.getMemoryLayout(),
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
  } catch {
    loading.value = false;
  }
}

onMounted(() => {
  init();
});
</script>

<template>
  <CpuCard :data="cpuData" :loading="loading" />
  <MemoCard
    :data="memoData"
    :memoLayoutData="memoLayoutData"
    :loading="loading"
    :watchMemo-="watchMemo"
  />
</template>

<style scoped></style>
