<script setup lang="ts">
import { bytesToGB } from "../../utils.ts";
import { onBeforeUnmount, onMounted } from "vue";
import { MemoryOne } from "@icon-park/vue-next";

const props = defineProps({
  data: {
    type: Object as () => MemoData,
    default: {
      active: 0,
      total: 0,
      available: 0,
    } satisfies MemoData,
  },
  memoLayoutData: {
    type: Object as () => MemoLayoutData[] | undefined,
    default: undefined,
  },
  title: {
    type: String,
    default: "",
  },
  loading: {
    type: Boolean,
    default: false,
  },
  queryMemo: {
    type: Function,
  },
});
let timerId: NodeJS.Timeout;
onMounted(() => {
  timerId = setInterval(() => {
    props.queryMemo?.();
  }, 2000);
});
onBeforeUnmount(() => {
  clearInterval(timerId);
});
</script>
<template>
  <OptionCard :title="'运存'">
    <template v-slot:icon>
      <memory-one theme="outline" size="24" fill="#333" />
    </template>
    <template v-slot:content>

        <el-descriptions title="使用情况" :column="4" border>
          <el-descriptions-item label="总内存">{{
            `${bytesToGB(data?.total || 0)} GB`
          }}</el-descriptions-item>
          <el-descriptions-item label="可用"
            ><span style="color: #67c23a">{{
              `${bytesToGB(data?.available || 0)} GB`
            }}</span></el-descriptions-item
          >
          <el-descriptions-item label="已用">{{
            `${bytesToGB(data?.active || 0)} GB`
          }}</el-descriptions-item>
          <el-descriptions-item label="使用率"
            ><span style="color: #ff4600"
              >{{ ((data.active / data.total) * 100).toFixed(2) }}%</span
            ></el-descriptions-item
          >
        </el-descriptions>

      <el-divider />
        <el-descriptions title="硬件" border :column="4">
          <template v-for="(item, index) in memoLayoutData">
            <el-descriptions-item :label="`内存条`">{{
              index + 1
            }}</el-descriptions-item>
            <el-descriptions-item label="频率">{{
              item?.clockSpeed
            }}</el-descriptions-item>
            <el-descriptions-item label="类型">{{
              item?.type
            }}</el-descriptions-item>
            <el-descriptions-item label="容量">{{
              `${bytesToGB(item?.size || 0)} GB`
            }}</el-descriptions-item>
          </template>
        </el-descriptions>

    </template>
  </OptionCard>
</template>

<style scoped></style>
