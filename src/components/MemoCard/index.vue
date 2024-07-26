<script setup lang="ts">
import {bytesToGB} from "../../utils.ts";
defineProps({
  data: {
    type: Object as ()=>MemoData|undefined,
    default: undefined
  },
  memoLayout:{
    type: Object as ()=>MemoLayoutData[]|undefined,
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
  <OptionCard :title="'运存'">
    <template v-slot:icon>
      <memory-one theme="outline" size="24" fill="#333"/>
    </template>
    <template v-slot:content>
      <el-descriptions title="运行信息" :column="2">
        <template v-slot:extra>
          <span>实时监听：</span><el-switch/>
        </template>
        <el-descriptions-item :span="2"  label="总内存">{{ `${bytesToGB(data?.total || 0)} GB` }}</el-descriptions-item>
        <el-descriptions-item label="可用">{{ `${bytesToGB(data?.available || 0)} GB` }}</el-descriptions-item>
        <el-descriptions-item label="已用">{{ `${bytesToGB(data?.active || 0)} GB` }}</el-descriptions-item>
      </el-descriptions>
      <el-descriptions title="硬件信息" >
        <el-descriptions-item>
          <template  v-for="(item,index) in memoLayout">
            <el-descriptions :column="4">
              <el-descriptions-item :label="`内存条${index+1}`"/>
              <el-descriptions-item label="频率">{{ item.clockSpeed }}</el-descriptions-item>
              <el-descriptions-item label="类型">{{ item.type }}</el-descriptions-item>
              <el-descriptions-item label="容量">{{ `${bytesToGB(item.size || 0)} GB` }}</el-descriptions-item>
            </el-descriptions>
          </template>
        </el-descriptions-item>
      </el-descriptions>

    </template>
  </OptionCard>
</template>

<style scoped>

</style>