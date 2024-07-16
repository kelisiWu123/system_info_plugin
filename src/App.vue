<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { bytesToGB } from './utils'
const cpu_brand = ref('notion')
const cpu_cores = ref(0)
const cpu_performanceCores = ref(0)
const memory_used = ref({
  total: 0,
  active: 0,
  available: 0,
})
async function hello() {
  const { brand, cores, performanceCores } = await window.services.getCpuInfo()
  const memoInfo = await window.services.getMemInfo()
  memory_used.value = memoInfo
  cpu_brand.value = brand
  cpu_cores.value = Number(cores)
  cpu_performanceCores.value = Number(performanceCores)
}
onMounted(() => {
  hello()
})
</script>

<template>
  <div>
    <span>cpu: {{ cpu_brand }}</span>
  </div>
  <div>
    <span>核心: {{ cpu_cores }}</span>
  </div>
  <div>
    <span>线程: {{ cpu_performanceCores }}</span>
  </div>
  <div>
    <span>可用内存: {{ `${bytesToGB(memory_used.available)} GB` }}</span>
  </div>
  <div>
    <span>总内存:{{ `${bytesToGB(memory_used.total)} GB` }}</span>
  </div>
  <div>
    <span>已用内存:{{ `${bytesToGB(memory_used.active)} GB` }}</span>
  </div>
</template>

<style scoped>
.logo {
  height: 6em;
  padding: 1.5em;
  will-change: filter;
  transition: filter 300ms;
}

.logo:hover {
  filter: drop-shadow(0 0 2em #646cffaa);
}

.logo.vue:hover {
  filter: drop-shadow(0 0 2em #42b883aa);
}
</style>
