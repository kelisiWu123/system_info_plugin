<script setup lang="ts">
import { onMounted, ref } from "vue";

const cpuData = ref<CpuData>();
const memoData = ref<MemoData>()
const memoLayoutData = ref<MemoLayoutData[]>([])
const loading = ref<boolean>(false);

async function init() {
  loading.value = true;
  try {
    const [cpuRes,memoRes,memoLayoutRes] = await Promise.allSettled([
        window.services.getCpuInfo(),
        window.services.getMemInfo(),
        window.services.getMemoryLayout()
    ]);
    loading.value = false;
    if (cpuRes.status === "fulfilled") {
      cpuData.value = cpuRes.value;
    }
    if (memoRes.status === 'fulfilled'){
      memoData.value = memoRes.value
    }
    if (memoLayoutRes.status === "fulfilled"){
      memoLayoutData.value = memoLayoutRes.value;
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
  <MemoCard :data="memoData" :memoLayoutData="memoLayoutData"  :loading="loading" />
</template>

<style scoped></style>
