# Vue3 组件库

## 项目简介

这是一个基于 Vue3 + TypeScript 开发的现代化组件库，遵循苹果设计风格，提供了一系列易用、美观的 UI 组件。

## 技术栈

- Vue 3
- TypeScript
- Less
- iconfont

## 组件列表

### LabelIcon 图标标签组件

一个简洁的垂直排列的图标文字组合组件。

#### 属性

| 属性名 | 类型   | 默认值 | 说明              |
| ------ | ------ | ------ | ----------------- |
| label  | string | ''     | 显示的文字标签    |
| icon   | string | ''     | iconfont 图标类名 |

#### 使用示例

```vue
<template>
  <LabelIcon icon="icon-home" label="首页" />
</template>

<script setup lang="ts">
import { LabelIcon } from '@/components'
</script>
```
