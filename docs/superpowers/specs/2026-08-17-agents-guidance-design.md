# AGENTS.md 项目协作规则设计

## 目标

在仓库根目录新增 `AGENTS.md`，让编码代理在处理此 uTools 硬件信息插件时先理解目录职责，并使用与项目匹配的构建和验证命令。

## 范围

规则仅覆盖项目结构、开发与构建命令、测试选择，以及 uTools、Electron、原生传感器和打包产物的边界；不引入功能设计流程、提交规范或发布流程。

## 结构与职责

- `src/`：Vue 3 页面、组件、组合式函数、样式和前端工具。
- `utools/`：uTools preload 与运行时桥接；`plugin.json` 定义插件入口和功能。
- `electron/`：Electron 主进程与桌面调试入口。
- `native/`：原生辅助程序源码；`vendor/`：随项目分发的第三方或已构建二进制。
- `scripts/`：构建前后的辅助脚本；`tests/`：可单独执行的回归测试。

## 验证

优先执行与改动直接相关的 `tests/` 用例；跨页面、构建配置、运行时桥接或原生传感器改动时，再执行对应的完整构建：`npm run build`（uTools 包）或 `npm run build:electron`（Electron 包）。不默认运行安装依赖或覆盖 `vendor/` 内二进制。

## 风险控制

`npm run build` 会先构建 macOS SMC 传感器辅助程序；平台相关改动需保持 Windows OpenHardwareMonitor、macOS helper 和通用降级路径兼容。`vite.config.ts` 在启动或构建时清理 `dist-electron`，调试期间不能把该目录当作需要保留的源文件。
