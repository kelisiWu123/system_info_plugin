<script setup lang="ts">
import {onMounted, ref} from "vue";
import {Cpu} from "@icon-park/vue-next";
const cpu = ref<Cpu>()
const loading = ref<boolean>(false)
async function init() {
  loading.value = true
  try {
    const [cpuRes] = await Promise.allSettled([window.services.getCpuInfo()])
    loading.value = false
    if (cpuRes.status === 'fulfilled'){
      cpu.value = cpuRes.value
    }
  }catch{
    loading.value = false
  }

}
onMounted(()=>{
  init()
})
</script>

<template>
  <OptionCard title="CPU" v-loading="loading">
    <template v-slot:icon>
      <cpu theme="outline" size="24" fill="#333"/>
    </template>
    <template v-slot:content>
      <el-descriptions  :column="2">
        <el-descriptions-item :span="2" label="CPU">{{cpu?.brand}}</el-descriptions-item>
        <el-descriptions-item label="核心">{{cpu?.physicalCores}}</el-descriptions-item>
        <el-descriptions-item label="线程">{{cpu?.performanceCores}}</el-descriptions-item>
      </el-descriptions>
    </template>
  </OptionCard>
</template>

<style scoped>

</style>