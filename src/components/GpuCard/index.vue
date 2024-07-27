<script setup lang="ts">
import {mbToGB} from "../../utils.ts";
import {
  Airplay
} from "@icon-park/vue-next";
defineProps({
  data: {
    type: Object as ()=>GpuData|undefined,
    default: undefined
  },
});
</script>

<template>
  <OptionCard title="GPU">
    <template v-slot:icon>
      <airplay theme="outline" size="24" fill="#333"/>
    </template>
    <template v-slot:content>
      <el-descriptions  :column="2">
        <el-descriptions-item :span="2" label="显卡">{{data?.model}}</el-descriptions-item>
        <el-descriptions-item label="显存">{{`${mbToGB(data?.vram)} GB`}}</el-descriptions-item>
      </el-descriptions>
    </template>
  </OptionCard>
</template>

<style scoped>

</style>