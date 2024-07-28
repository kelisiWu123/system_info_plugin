<script setup lang="ts">
import {onMounted, ref, watch} from 'vue'

import {
  Cpu,
  MemoryOne,
  Airplay
} from "@icon-park/vue-next";
import VConsole from "vconsole";
import {bytesToGB, mbToGB} from "../../utils.ts";
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
const memory_layout = ref<Partial<{
  clockSpeed: number, size: number, type: string
}>[]>([])
async function queryMemo(){
  console.log('queryMemo')
  const memoInfo = await window.services.getMemInfo()
  memory_used.value = memoInfo
}
const watchMemo = ref(false)
let watchMemoTimerId:NodeJS.Timeout
function onWatchMemoChange(){
  watchMemo.value = !watchMemo.value
}
watch(watchMemo,()=>{
  console.log('这时有触发吗')
  if (watchMemo.value){
    watchMemoTimerId = setInterval(()=>{
      queryMemo()
    },2000)
  }else {
    clearInterval(watchMemoTimerId)
  }
})

async function allInfoInit() {
  const {brand, physicalCores, performanceCores} = await window.services.getCpuInfo()
  const {vram, model} = await window.services.getGpuInfo()
  const memoryLayout = await window.services.getMemoryLayout()
  memory_layout.value = memoryLayout
  cpu_brand.value = brand
  cpu_cores.value = Number(physicalCores)
  cpu_performanceCores.value = Number(performanceCores)
  gpuInfo.value.vram = vram
  gpuInfo.value.model = model
}

onMounted(() => {
  allInfoInit()
})

const vConsole = new VConsole();
console.log(vConsole)


</script>

<template>


  <OptionCard title="CPU">
    <template v-slot:icon>
      <cpu theme="outline" size="24" fill="#333"/>
    </template>
    <template v-slot:content>
      <el-descriptions  :column="2">
        <el-descriptions-item :span="2" label="CPU">{{cpu_brand}}</el-descriptions-item>
        <el-descriptions-item label="核心">{{cpu_cores}}</el-descriptions-item>
        <el-descriptions-item label="线程">{{cpu_performanceCores}}</el-descriptions-item>
      </el-descriptions>
    </template>
  </OptionCard>
  <OptionCard title="GPU">
    <template v-slot:icon>
      <airplay theme="outline" size="24" fill="#333"/>
    </template>
    <template v-slot:content>
      <el-descriptions  :column="2">
        <el-descriptions-item :span="2" label="显卡">{{gpuInfo.model}}</el-descriptions-item>
        <el-descriptions-item label="显存">{{`${mbToGB(gpuInfo.vram)} GB`}}</el-descriptions-item>

      </el-descriptions>
    </template>
  </OptionCard>
  <OptionCard :title="'运存'">
    <template v-slot:icon>
      <memory-one theme="outline" size="24" fill="#333"/>
    </template>
    <template v-slot:content>
      <el-descriptions title="运行信息" :column="2">
        <template v-slot:extra>
          <span>实时监听：</span><el-switch v-model="watchMemo" :on-change="onWatchMemoChange"/>
        </template>
        <el-descriptions-item :span="2"  label="总内存">{{ `${bytesToGB(memory_used.total)} GB` }}</el-descriptions-item>
        <el-descriptions-item label="可用">{{ `${bytesToGB(memory_used.available)} GB` }}</el-descriptions-item>
        <el-descriptions-item label="已用">{{ `${bytesToGB(memory_used.active)} GB` }}</el-descriptions-item>
      </el-descriptions>
      <el-descriptions title="硬件信息" >
        <el-descriptions-item>
          <template  v-for="(item,index) in memory_layout">
            <el-descriptions :column="4">
              <el-descriptions-item :label="`内存条${index+1}`"/>
              <el-descriptions-item label="频率">{{ item.clockSpeed }}</el-descriptions-item>
              <el-descriptions-item label="类型">{{ item.type }}</el-descriptions-item>
              <el-descriptions-item label="容量">{{ `${bytesToGB(item.size || 0)} GB` }}</el-descriptions-item>
            </el-descriptions>
          </template>
        </el-descriptions-item>
      </el-descriptions>

    </template>
  </OptionCard>
</template>

<style scoped>

</style>
