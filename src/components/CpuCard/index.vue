<script setup lang="ts">

import {Cpu} from "@icon-park/vue-next";
defineProps({
  data: {
    type: Object as ()=>CpuData|undefined,
    default: undefined
  },
  title: {
    type: String,
    default: ''
  },
  loading: {
    type: Boolean,
    default: false
  }
,
});
</script>

<template>
  <OptionCard title="CPU" v-loading="loading">
    <template v-slot:icon>
      <cpu theme="outline" size="24" fill="#333"/>
    </template>
    <template v-slot:content>
      <el-descriptions  :column="3">
        <el-descriptions-item :span="3" label="CPU">{{data?.brand}}</el-descriptions-item>
        <el-descriptions-item label="核心">{{data?.physicalCores}}</el-descriptions-item>
        <el-descriptions-item label="线程">{{data?.performanceCores}}</el-descriptions-item>
      </el-descriptions>
    </template>
  </OptionCard>
</template>

<style scoped>

</style>