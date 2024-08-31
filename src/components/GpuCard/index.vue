<script setup lang="ts">
import { mbToGB } from '../../utils.ts'
import '@/assets/icon/iconfont.css'
import { Airplay } from '@icon-park/vue-next'

defineProps({
  data: {
    type: Object as () => GpuData[] | undefined,
    default: undefined,
  },
})
</script>

<template>
  <OptionCard title="显卡">
    <template v-slot:icon>
      <airplay theme="outline" size="24" fill="#333" />
    </template>
    <template v-slot:content>
      <el-descriptions direction="vertical" size="small" border :column="4">
        <el-descriptions-item  :width="80" align="center" :rowspan="data?.length">
          <template v-slot:default>
            <LabelIcon label="显卡" icon="icon-xianka"/>
          </template>
        </el-descriptions-item>
        <template v-for="item in data">
          <el-descriptions-item label="名称">{{ item.model }} </el-descriptions-item>
          <el-descriptions-item label="显存">{{ `${mbToGB(item?.vram || 0)} GB` }} </el-descriptions-item>
          <el-descriptions-item label="总线类型">{{ item.bus }} </el-descriptions-item>
        </template>
      </el-descriptions>
    </template>

    <!--    <template v-slot:content>-->
    <!--      <el-descriptions  :column="2">-->
    <!--        <el-descriptions-item :span="2" label="显卡">{{data?.model}}</el-descriptions-item>-->
    <!--        <el-descriptions-item label="显存">{{`${mbToGB(data?.vram || 0)} GB`}}</el-descriptions-item>-->
    <!--      </el-descriptions>-->
    <!--    </template>-->
  </OptionCard>
</template>

<style scoped></style>
