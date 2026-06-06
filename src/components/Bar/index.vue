<script setup lang="ts">
function minimizeWindow() {
  window.services.minimizeWindow?.()
}

function toggleMaximizeWindow() {
  window.services.toggleMaximizeWindow?.()
}

function closeWindow() {
  window.services.closeWindow()
}
</script>

<template>
  <div class="window-controls">
    <button type="button" class="control control--minimize" @click="minimizeWindow" aria-label="最小化窗口" />
    <button type="button" class="control control--maximize" @click="toggleMaximizeWindow" aria-label="切换最大化窗口" />
    <button type="button" class="control control--close" @click="closeWindow" aria-label="关闭窗口" />
  </div>
</template>

<style scoped lang="less">
.window-controls {
  display: flex;
  align-items: center;
  gap: 6px;
}

.control {
  position: relative;
  width: 34px;
  height: 28px;
  border-radius: 8px;
  color: rgba(233, 238, 247, 0.86);
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease;
}

.control:hover {
  background: rgba(255, 255, 255, 0.06);
}

.control::before,
.control::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
}

.control--minimize::before {
  width: 12px;
  height: 1.5px;
  background: currentColor;
  margin-top: 3px;
}

.control--maximize::before {
  width: 11px;
  height: 9px;
  border: 1.5px solid currentColor;
  border-radius: 2px;
}

.control--close::before,
.control--close::after {
  width: 12px;
  height: 1.5px;
  background: currentColor;
}

.control--close::before {
  transform: translate(-50%, -50%) rotate(45deg);
}

.control--close::after {
  transform: translate(-50%, -50%) rotate(-45deg);
}

.control--close:hover {
  background: #d9534f;
  color: #ffffff;
}
</style>
