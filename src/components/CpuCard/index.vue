<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";

defineProps({
  data: {
    type: Object as () => CpuData | undefined,
    default: undefined,
  },
  title: {
    type: String,
    default: "",
  },
});
const cpu_fullLoad = ref<number>(0);
const getCpuFullLoad = async () => {
  cpu_fullLoad.value = await window.services.getCpuFullLoad();
};
let cpuTimerId: NodeJS.Timeout;
onMounted(() => {
  cpuTimerId = setInterval(() => {
    getCpuFullLoad();
  }, 1000);
});
onUnmounted(() => {
  clearInterval(cpuTimerId);
});
</script>

<template>
  <OptionCard title="CPU">
    <template v-slot:icon> </template>
    <template v-slot:content>
      <el-descriptions  size="small" direction="vertical"  border :column="4">
        <el-descriptions-item :width="80" :rowspan="2">
          <template v-slot:default>
            <LabelIcon label="处理器" icon="icon-cpu"/>
          </template>
        </el-descriptions-item>
        <el-descriptions-item :span="3" label="型号"
          >{{ data?.manufacturer }} {{ data?.brand }}</el-descriptions-item
        >
        <el-descriptions-item label="核心">{{
          data?.physicalCores
        }}</el-descriptions-item>
        <el-descriptions-item label="线程">{{
          data?.performanceCores
        }}</el-descriptions-item>
        <el-descriptions-item label="使用率"
          ><span style="color: #ff4600">{{ cpu_fullLoad }}%</span>
        </el-descriptions-item>
      </el-descriptions>
    </template>
  </OptionCard>
</template>

<style scoped></style>
