<script setup lang="ts">

function closeWindow(){
  window.services.closeWindow()
}
</script>

<template>

  <div class="container">
    <div class="btnSpace">
      <div @click="closeWindow" class="btn" style="background-color: #fb625f"/>
      <div class="btn" style="background-color: #f9c57a"/>
      <div class="btn" style="background-color: #8ac872"/>
    </div>

  </div>
</template>

<style scoped lang="less">
.container {
  background-color: #d9d8d9;
  padding: 0 10px;
  height: 30px;
  display: flex;
  justify-content: space-between;

  .btnSpace {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 5px;

    .btn {
      height: 12px;
      width: 12px;
      border-radius: 100%;
    }
  }
}
</style>
