<script setup lang="ts">
import {bytesToGB} from "../../utils.ts";
import {onBeforeUnmount, onMounted, ref, watch} from "vue";
import {MemoryOne} from "@icon-park/vue-next";
const props = defineProps({
  data: {
    type: Object as ()=>MemoData|undefined,
    default: undefined
  },
  memoLayoutData:{
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
  },
  queryMemo:{
    type:Function,
  }
});
let timerId:NodeJS.Timeout
onMounted(()=>{
  timerId = setInterval(()=>{
    props.queryMemo?.()
  },2000)
})
onBeforeUnmount(()=>{
  clearInterval(timerId)
})

</script>
<template>
  <OptionCard :title="'运存'">
    <template v-slot:icon>
      <memory-one theme="outline" size="24" fill="#333"/>
    </template>
    <template v-slot:content>
      <el-descriptions :column="3">
        <el-descriptions-item  label="总内存">{{ `${bytesToGB(data?.total || 0)} GB` }}</el-descriptions-item>
        <el-descriptions-item  label="可用"><span style="color: #67c23a">{{ `${bytesToGB(data?.available || 0)} GB` }}</span></el-descriptions-item>
        <el-descriptions-item label="已用">{{ `${bytesToGB(data?.active || 0)} GB` }}</el-descriptions-item>
      </el-descriptions>
      <el-descriptions >
        <el-descriptions-item>
          <template  v-for="(item,index) in memoLayoutData">
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