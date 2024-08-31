<script setup lang="ts">
defineProps({
  title: {
    type: String,
    default: 'cpu'
  }
});
</script>

<template>
  <div>
    <div style="display: flex;align-items: center;gap: 20px">
      <div style="display: flex;flex-direction: column">

      </div>
      <div>
        <slot name="content">

        </slot>
      </div>
    </div>


  </div>
</template>

<style scoped>

</style>