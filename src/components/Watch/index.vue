<script setup lang="ts">
import {Cpu,Disk,DownloadOne,UploadOne} from '@icon-park/vue-next'
import {onMounted, ref} from "vue";
import { bytesToMB} from "../../utils.ts";

const memoData = ref<MemoData>({
  active:0,
  available:0,
  total:0
});
const netData = ref<NetworkStateData>({
  tx_sec: 0,
  rx_sec:0
})
const cpu_fullLoad = ref<number>(0)
const getCpuFullLoad = async () =>{
  cpu_fullLoad.value = await window.services.getCpuFullLoad()
}
// const duration = computed(() => Math.floor(cpu_fullLoad.value / 10))
async function init() {
 const memo =  await window.services.getMemInfo()
  const net =  await window.services.getNetworkInfo()

  memoData.value = memo
  netData.value = net
}
onMounted(()=>{
  setInterval(()=>{
    getCpuFullLoad()
    init()
  },1000)
})
</script>

<template>
  <WatchRow>
    <template v-slot:icon>
      <Cpu/>
    </template>
    <template v-slot:content>
      <el-progress
          :percentage="Number(cpu_fullLoad)"
          :stroke-width="10"
          :text-inside="true"
      />
    </template>
  </WatchRow>

  <WatchRow>
    <template v-slot:icon>
      <Disk/>
    </template>
    <template v-slot:content>
      <el-progress
          :text-inside="true"
          :percentage="Number((memoData.active / memoData.total * 100).toFixed(2))"
          :stroke-width="10"
      />
    </template>
  </WatchRow>

  <WatchRow>
    <template v-slot:icon>
      <DownloadOne/>
    </template>
    <template v-slot:content>
    {{bytesToMB(netData?.rx_sec).toFixed(2)}}MB
    </template>
  </WatchRow>

  <WatchRow>
    <template v-slot:icon>
      <UploadOne/>
    </template>
    <template v-slot:content>
      {{bytesToMB(netData?.rx_sec).toFixed(2)}}MB
    </template>
  </WatchRow>



</template>

<style scoped>

</style>