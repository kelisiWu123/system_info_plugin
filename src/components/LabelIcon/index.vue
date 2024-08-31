<script setup lang="ts">
defineProps({
  label: {
    type: String,
    default: '',
  },
  icon: {
    type: String,
    default: '',
  },
})
</script>

<template>
  <div class="container">
    <span :class="`iconfont ${icon}`"/>
    <span >{{ label }}</span>
  </div>
</template>

<style scoped lang="less">
.container {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  span:first-child{
    font-size: 24px;
    color: black;
  }
}
</style>
