<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { bytesToGB } from './utils'
import {
  Cpu,
    MemoryOne,
    Airplay
} from "@icon-park/vue-next";


import VConsole from "vconsole";
const cpu_brand = ref('notion')
const cpu_cores = ref(0)
const cpu_performanceCores = ref(0)
const gpuInfo = ref({
  vram: 0,
  model: ''
})
const memory_used = ref({
  total: 0,
  active: 0,
  available: 0,
})
const loading = ref(false)
async function hello() {
  const { brand, physicalCores, performanceCores } = await window.services.getCpuInfo()
  const memoInfo = await window.services.getMemInfo()
  const {vram,model} = await window.services.getGpuInfo()

  memory_used.value = memoInfo
  cpu_brand.value = brand
  cpu_cores.value = Number(physicalCores)
  cpu_performanceCores.value = Number(performanceCores)

  gpuInfo.value.vram = vram
  gpuInfo.value.model = model
}
onMounted(() => {
    hello()
})

const vConsole = new VConsole();

</script>

<template>

  <el-card style="max-width: 480px">
    <OptionCard :title="'cpu'">
      <template v-slot:content>
        <cpu theme="outline" size="24" fill="#333"/>
      </template>
    </OptionCard>
    <OptionCard :title="'memory'">
      <template v-slot:content>
        <memory-one theme="outline" size="24" fill="#333"/>
      </template>
    </OptionCard>
    <OptionCard :title="'gpu'">
      <template v-slot:content>
        <airplay theme="outline" size="24" fill="#333"/>
      </template>
    </OptionCard>
  <p>
    <span>cpu: {{ cpu_brand }}</span>
  </p>

  <p>
    <span>核心: {{ cpu_cores }}</span>
  </p>
  <p>
    <span>线程: {{ cpu_performanceCores }}</span>
  </p>
  <p>
    <span>可用内存: {{ `${bytesToGB(memory_used.available)} GB` }}</span>
  </p>
  <p>
    <span>总内存:{{ `${bytesToGB(memory_used.total)} GB` }}</span>
  </p>
  <p>
    <span>已用内存:{{ `${bytesToGB(memory_used.active)} GB` }}</span>
  </p>
  <p>
    <span>显卡:{{ `${gpuInfo.model}`}}</span>
  </p>
  <p>
    <span>显存:{{ `${gpuInfo.vram}`}}</span>
  </p>
  </el-card>
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
