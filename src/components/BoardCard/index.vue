<script setup lang="ts">
import {
  Pad
} from "@icon-park/vue-next";
defineProps({
  data: {
    type: Object as ()=>BoardData|undefined,
    default: undefined
  },
});
</script>

<template>
  <OptionCard title="主板">
    <template v-slot:icon>

    </template>
    
    <template v-slot:content>
      <el-descriptions direction="vertical"  border :column="2">
        <el-descriptions-item :rowspan="2" label="主板">  <pad theme="outline" size="24" fill="#333"/></el-descriptions-item>
        <el-descriptions-item :span="2" label="制造商">{{data?.manufacturer}}</el-descriptions-item>
        <el-descriptions-item label="型号">{{data?.model}}</el-descriptions-item>
      </el-descriptions>
    </template>
  </OptionCard>
</template>

<style scoped>

</style>