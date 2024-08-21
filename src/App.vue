<script setup lang="ts">

import { ref, watch} from "vue";
let uToolCode = ref<string>('')
watch(uToolCode,()=>{
if(uToolCode.value ==="hardwareWatch"){
 window.services.creatSomething()
 utools.outPlugin()
}
})
utools.onPluginEnter(({code})=>{
uToolCode.value = code
})

</script>
<template>
<!--  <Bar/>-->
<!--  <template v-if="uToolCode === 'hardware'">-->
    <Computer/>
<!--  <Watch />-->
<!--  </template>-->
<!--  <template v-else-if="uToolCode === 'hardwareWatch'">-->
<!--    <Watch/>-->
<!--  </template>-->
<!--  <el-button>点击</el-button>-->
</template>
<style scoped>

</style>