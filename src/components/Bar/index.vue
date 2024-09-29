<script setup lang="ts">

import {onMounted, ref, watch} from "vue";


function closeWindow(): void {
  window.services.closeWindow()
}
// const vsConsole = new VConsole();
// console.log(vsConsole);
onMounted(()=>{
  addEventListener('keyup',(evt)=>{
    switch (evt.key){
      case 'Escape':{
        window.close();
        break;
      }
    }
  })
})

const onTop = ref(false)
watch(onTop,()=>{
  window.services.alwaysOnTop(onTop.value)
})
function alwaysOnTop(){
  onTop.value = !onTop.value
}
</script>

<template>

  <div class="bar">
    <div class="btnSpace">
      <el-tooltip
          effect="light"
          content="关闭窗口"
          placement="top"
      >
        <div tabindex="0" @click="closeWindow" class="btn" style="background-color: #fb625f;"/>
      </el-tooltip>

      <div class="btn" style="background-color: #f9c57a"/>

      <el-tooltip
          effect="light"
          :content="onTop ? '取消置顶':'窗口置顶'"
          placement="top"
      >
        <div tabindex="0"   @click="alwaysOnTop" :class="onTop ? 'btnAct':'btn'" style="background-color: #8ac872">
        </div>
      </el-tooltip>


    </div>
    <div class="dragSpace">

    </div>

  </div>
</template>

<style scoped lang="less">
.bar {
  flex:0;
  background-color: #d9d8d9;
  //background-color: rgba(255, 255, 255, 0.5);
  padding:10px;
  height: 30px;
  display: flex;
  justify-content: space-between;

  .btnSpace {
    flex: 0;
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 5px;

    .btn {
      height: 12px;
      width: 12px;
      border-radius: 100%;
      cursor: pointer;
    }
    .btnAct{
      .btn;
      background-image: linear-gradient(rgba(255, 255, 255, 0) 0, rgba(255, 255, 255, 0) 50%, #fff 95%, #fff 100%);
      box-shadow: 0 2px 0 rgba(255, 255, 255, .8), inset 0 0 3px 1px rgba(0, 0, 0, .6), 0 -1px 1px 1px rgba(0, 0, 0, .4);
      -webkit-box-shadow: 0 2px 0 rgba(255, 255, 255, .8), inset 0 0 3px 1px rgba(0, 0, 0, .6), 0 -1px 1px 1px rgba(0, 0, 0, .4);
    }
  }
  .dragSpace {
    flex: 1;
    -webkit-app-region: drag;
  }
}
</style>
