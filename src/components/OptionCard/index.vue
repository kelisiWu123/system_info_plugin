<script setup lang="ts">
defineProps({
  title: {
    type: String,
    default: 'cpu'
  }
});
</script>

<template>
  <el-card shadow="hover" style="max-width: 100px;display: flex;flex-direction: column">
   <slot name="content">

   </slot>
    <div>
      {{title}}
    </div>
  </el-card>
</template>

<style scoped>

</style>