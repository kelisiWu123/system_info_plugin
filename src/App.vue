<script setup lang="ts">

import {onBeforeMount, ref, watch} from "vue";
let uToolCode = ref<string>('')
watch(uToolCode,()=>{
  if(uToolCode.value ==="hardwareWatch"){
    window.services.creatSomething()
  }else if(uToolCode.value === 'hardwareWatch'){} {
    window.services.creatSomething()
    utools.outPlugin()
  }
})
onBeforeMount(()=>{
  utools.onPluginEnter(({code})=>{
    uToolCode.value = code
  })
})
</script>

<template>
  <template v-if="uToolCode === 'hardware'">
    <Computer/>
  </template>
<!--  <el-button @click="openSome"></el-button>-->
</template>

<style scoped>

</style>