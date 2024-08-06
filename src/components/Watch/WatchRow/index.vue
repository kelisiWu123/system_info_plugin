<script setup lang="ts">


</script>

<template>
  <div style="display: flex;justify-content: center;align-items: center">
     <span style="flex: 0;margin: 10px">
      <slot name="icon">
      </slot>
      </span>
    <div style="flex: 1">
      <slot name="content">
      </slot>
    </div>
  </div>
</template>

<style scoped>

</style>