<script setup lang="ts">
import {Cpu,Disk,DownloadOne,UploadOne} from '@icon-park/vue-next'
import {onMounted, onUnmounted, ref,toRefs,computed,reactive} from "vue";
import { bytesToMB} from "../../utils.ts";
import VConsole from "vconsole";
const memoData = reactive<MemoData>({
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
  memoData.active = memo.active
  memoData.total = memo.total
  memoData.available = memo.available

  netData.value = net
}
let timerId:NodeJS.Timeout
onMounted(()=>{
   timerId = setInterval(()=>{
    getCpuFullLoad()
    init()
  },2000)
})
onUnmounted(()=>{
  clearInterval(timerId)
})
const colors = [
  { color: '#1989fa', percentage: 60 },
  { color: '#e6a23c', percentage: 81 },
  { color: '#f56c6c', percentage: 100},
]
const {active,total} = toRefs(memoData)
const usedMemoPercent = computed( ()=>((active.value / total.value) * 100))
const vsConsole = new VConsole()
console.log(vsConsole)
</script>

<template >
  <div class="container">


  <div class="title">
    <div style="display: flex;justify-content: center; align-items: center;gap: 5px">
      <div style="height: 12px;width: 12px;border-radius: 100%; background-color: #fb625f"/>
      <div style="height: 12px;width: 12px;border-radius: 100%; background-color: #f9c57a"/>
      <div style="height: 12px;width: 12px;border-radius: 100%; background-color: #8ac872"/>
    </div>

  </div>
  <div style="padding:0 10px">
  <WatchRow>
    <template v-slot:icon>
      <Cpu/>
    </template>
    <template v-slot:content>
      <el-progress
          :percentage="Number(cpu_fullLoad)"
          :stroke-width="18"
          :text-inside="true"
          :color="colors"
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
          :percentage="Number(usedMemoPercent.toFixed(2))"
          :stroke-width="18"
          :color="colors"
      >
      </el-progress>

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


  </div>
  </div>
</template>

<style scoped lang="less">
.container{
  .title{
    background-color:  #d9d8d9;
    padding: 0 10px;
    height: 30px;
    display: flex;
    justify-content: space-between;
  }
}
</style>