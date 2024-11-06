<script setup lang="ts">
import VConsole from 'vconsole'
import { onMounted, ref, watch } from 'vue'

function closeWindow(): void {
  window.services.closeWindow()
}
const vsConsole = new VConsole()
console.log(vsConsole)
onMounted(() => {
  addEventListener('keyup', (evt) => {
    switch (evt.key) {
      case 'Escape': {
        window.close()
        break
      }
    }
  })
})

const onTop = ref(false)
watch(onTop, () => {
  window.services.alwaysOnTop(onTop.value)
})
function alwaysOnTop() {
  onTop.value = !onTop.value
}
</script>

<template>
  <div class="bar">
    <div class="btnSpace">
      <el-tooltip effect="light" content="关闭窗口" placement="top">
        <div tabindex="0" @click="closeWindow" class="btn close" />
      </el-tooltip>

      <div class="btn minimize" />

      <el-tooltip effect="light" :content="onTop ? '取消置顶' : '窗口置顶'" placement="top">
        <div tabindex="0" @click="alwaysOnTop" :class="['btn', 'maximize', { active: onTop }]" />
      </el-tooltip>
    </div>
    <div class="dragSpace"></div>
  </div>
</template>

<style scoped lang="less">
.bar {
  flex: 0;
  background-color: #f5f5f5;
  height: 28px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 12px;
  -webkit-app-region: no-drag;
  border-bottom: 1px solid rgba(0, 0, 0, 0.1);

  .btnSpace {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-left: 2px;
    padding: 6px 0;

    .btn {
      height: 12px;
      width: 12px;
      border-radius: 50%;
      cursor: pointer;
      transition: all 0.2s ease;
      position: relative;
      border: 0.5px solid rgba(0, 0, 0, 0.1);

      &:hover::after {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 6px;
        height: 6px;
        background-color: rgba(0, 0, 0, 0.3);
        border-radius: 50%;
      }

      &.close {
        background-color: #ff5f57;
        &:hover {
          background-color: #ff4b47;
        }
      }

      &.minimize {
        background-color: #febc2e;
        &:hover {
          background-color: #feb01e;
        }
      }

      &.maximize {
        background-color: #28c840;
        &:hover {
          background-color: #24b539;
        }

        &.active {
          background-image: linear-gradient(rgba(255, 255, 255, 0) 0, rgba(255, 255, 255, 0) 50%, rgba(255, 255, 255, 0.3) 95%, rgba(255, 255, 255, 0.3) 100%);
          box-shadow:
            0 1px 1px rgba(0, 0, 0, 0.1),
            inset 0 0 1px rgba(0, 0, 0, 0.2);
        }
      }
    }
  }

  .dragSpace {
    flex: 1;
    height: 100%;
    -webkit-app-region: drag;
  }
}
</style>
