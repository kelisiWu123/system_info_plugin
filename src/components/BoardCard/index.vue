<script setup lang="ts">
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
      <el-descriptions size="small" direction="vertical"  border :column="2">
        <el-descriptions-item :width="80" :rowspan="2">
          <template v-slot:default>
            <LabelIcon label="主板" icon="icon-zhuban"/>
          </template>
        </el-descriptions-item>
        <el-descriptions-item :span="2" label="制造商">{{data?.manufacturer}}</el-descriptions-item>
        <el-descriptions-item label="型号">{{data?.model}}</el-descriptions-item>
      </el-descriptions>
    </template>
  </OptionCard>
</template>

<style scoped>

</style>