<script setup lang="ts">
import { bytesToGB } from "../../utils.ts";
import { HardDisk } from "@icon-park/vue-next";

defineProps({
  data: {
    type: Object as () => DiskData[] | undefined,
    default: [],
  },
});
</script>

<template>
  <OptionCard title="硬盘">
    <template v-slot:icon>
      <hard-disk theme="outline" size="24" fill="#333" />
    </template>
    <template v-slot:content>
      <el-descriptions direction="vertical" :column="4" border size="small">
        <el-descriptions-item :width="80" :rowspan="(data || []).length * 2">
          <template v-slot:default>
            <LabelIcon label="磁盘" icon="icon-cipan-L"></LabelIcon>
          </template>
        </el-descriptions-item>
        <template v-for="item in data">
          <el-descriptions-item :span="3" label="名称"
            >{{ item?.name }}
          </el-descriptions-item>
          <el-descriptions-item label="大小"
            >{{ `${bytesToGB(item?.size)} GB` }}
          </el-descriptions-item>
          <el-descriptions-item label="类型"
            >{{ item?.type }}
          </el-descriptions-item>
          <el-descriptions-item label="接口类型"
            >{{ item?.interfaceType }}
          </el-descriptions-item>
        </template>
      </el-descriptions>
    </template>
  </OptionCard>
</template>

<style scoped></style>
