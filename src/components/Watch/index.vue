<script setup lang="ts">
import {Cpu,Disk} from '@icon-park/vue-next'
import {onMounted, ref} from "vue";
const memoData = ref<MemoData>({
  active:0,
  available:0,
  total:0
});
const cpu_fullLoad = ref<number>(0)
const getCpuFullLoad = async () =>{
  cpu_fullLoad.value = await window.services.getCpuFullLoad()
}
// const duration = computed(() => Math.floor(cpu_fullLoad.value / 10))
async function init() {
 const memo =  await window.services.getMemInfo()

  memoData.value = memo
}
onMounted(()=>{
  setInterval(()=>{
    getCpuFullLoad()
    init()
  },1000)
})
</script>

<template>
  <div style="display: flex;justify-content: center;align-items: center">
     <span style="flex: 0;margin: 10px">
        <Cpu/>
      </span>
    <div style="flex: 1">
      <el-progress
          :percentage="Number(cpu_fullLoad)"
          :stroke-width="15"


      />
    </div>
  </div>
  <div style="display: flex;justify-content: center;align-items: center">
      <span style="flex: 0;margin: 10px">
      <Disk/>
      </span>
    <div style="flex: 1">
      <el-progress
          :percentage="Number((memoData.active / memoData.total * 100).toFixed(2))"
          :stroke-width="15"


      />
    </div>
  </div>

</template>

<style scoped>

</style>