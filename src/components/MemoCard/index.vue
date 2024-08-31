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
      <el-descriptions  direction="vertical" size="small" :column="3" border>
        <el-descriptions-item
            :width="80"
            :rowspan="2"
        ><template v-slot:default>
          <LabelIcon label="运存" icon="icon-yuncunRAM
"/>
        </template>
        </el-descriptions-item>
        <el-descriptions-item label="总内存"
          >{{ `${bytesToGB(data?.total || 0)} GB` }}
        </el-descriptions-item>
        <el-descriptions-item label="可用"
          ><span style="color: #67c23a">{{
            `${bytesToGB(data?.available || 0)} GB`
          }}</span></el-descriptions-item
        >
        <el-descriptions-item label="已用"
          >{{ `${bytesToGB(data?.active || 0)} GB` }}
        </el-descriptions-item>
        <el-descriptions-item label="使用率"
          ><span style="color: #ff4600"
            >{{ ((data.active / data.total) * 100).toFixed(2) }}%</span
          ></el-descriptions-item
        >
      </el-descriptions>


      <el-descriptions size="small" direction="vertical" border :column="5">
        <el-descriptions-item :width="80"  :rowspan="memoLayoutData?.length">
          <LabelIcon label="内存条"  icon="icon-neicuntiao"/>
        </el-descriptions-item>
        <template v-for="(item, index) in memoLayoutData">
          <el-descriptions-item :label="`#`"
            >{{ index + 1 }}
          </el-descriptions-item>
          <el-descriptions-item label="频率"
            >{{ item?.clockSpeed }}
          </el-descriptions-item>
          <el-descriptions-item label="类型"
            >{{ item?.type }}
          </el-descriptions-item>
          <el-descriptions-item label="容量"
            >{{ `${bytesToGB(item?.size || 0)} GB` }}
          </el-descriptions-item>
        </template>
      </el-descriptions>
    </template>
  </OptionCard>
</template>

<style scoped></style>
