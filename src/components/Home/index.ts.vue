<script setup lang="ts">
import {ref} from "vue";
const cpu = ref<Cpu>()
async function init() {
  const [cpuRes] = await Promise.allSettled([window.services.getCpuInfo()])

}
</script>

<template>

</template>

<style scoped>

</style>