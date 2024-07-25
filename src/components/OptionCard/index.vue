<script setup lang="ts">
defineProps({
  title: {
    type: String,
    default: 'cpu'
  }
});
</script>

<template>
  <el-card shadow="hover" style="max-width: 480px">
    <div style="display: flex;align-items: center;gap: 20px">
      <div style="display: flex;flex-direction: column">
        <div style="width: 50px">
          <slot name="icon">
          </slot>
        </div>

        <div>
          {{title}}
        </div>
      </div>
      <div style="width: 360px">
        <slot name="content">

        </slot>
      </div>
    </div>


  </el-card>
</template>

<style scoped>

</style>