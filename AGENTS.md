# system_info_plugin 协作指南

这是一个面向 uTools 的硬件信息插件。前端使用 Vue 3、Vite 和 TypeScript；同时支持 Electron 调试，并包含 macOS 与 Windows 的硬件传感器集成。

## 项目结构

- `src/`：Vue 页面、组件、组合式函数、样式和前端工具。
  - `src/components/`：硬件概览、监控、CPU、GPU、内存和存储等视图。
  - `src/composables/`：硬件数据获取与聚合。
  - `src/utils/`：平台判断、传感器读取、监控调度、路由和布局逻辑。
- `utools/`：uTools preload、运行时桥接及系统信息服务。
- `plugin.json`：uTools 插件元数据、入口和功能码；功能变更时需与 `utools/` 运行时逻辑保持一致。
- `electron/`：Electron 主进程和桌面调试入口。
- `native/`：macOS 原生辅助程序的 C 源码。
- `vendor/`：随插件分发的第三方程序和构建后的原生二进制；不要手工修改二进制文件。
- `scripts/`：原生传感器构建和 uTools 多入口页面生成脚本。
- `tests/`：按功能拆分的回归测试；目前没有统一的 `npm test` 脚本。

## 编码约束

- 遵循现有 Vue 3 Composition API 与 TypeScript 严格模式；不要以 `any` 绕过类型检查。
- 平台差异应集中在现有的 `src/utils/`、`utools/services/` 或原生辅助层处理，组件层保持数据展示职责。
- 修改传感器读取或监控调度时，保留无传感器权限、设备不支持或数据缺失时的现有降级展示，不把平台专有逻辑散落到多个页面。
- 新增或调整 uTools 功能时，同步检查 `plugin.json`、`utools/preload.js`、`utools/runtime.ts` 与相关页面路由。
- 修改 `native/` 下的 C 源码后，不直接替换 `vendor/macos/` 产物；使用正式构建脚本重新生成。
- 未经明确要求，不更新 `vendor/` 中的第三方二进制、`package-lock.json` 或依赖版本。

## 新增 uTools 快捷启动

新增一个可由 uTools 搜索唤起的功能时，按以下链路同步修改：

1. 在 `plugin.json` 的 `features` 中新增功能，使用唯一的 `code`，并填写 `explain` 和至少一个 `cmds` 搜索关键词。
2. 在 `utools/preload.js` 的 `window.exports` 中新增同名 `code`。`window.exports` 的键必须与 `plugin.json` 的 `features[].code` 一致，否则 uTools 无法触发该功能。
3. 在该功能的 `args.enter` 中调用 `openPresetWindow('<入口名>')` 打开页面；若只需执行后台动作，则保持与现有 `mode: 'none'` 约定一致。
4. 新增独立窗口时，在 `windowPresets` 中声明开发和生产环境的尺寸、背景色；新增独立页面入口时，同步更新 `scripts/generate-utools-entry-pages.mjs`、页面路由和对应 Vue 视图。
5. 使用 `npm run dev` 在 uTools 开发环境验证搜索关键词、窗口打开和退出插件行为；提交前运行 `npm run build` 验证最终入口页与插件产物。

## 开发、构建与验证

- 日常 uTools 前端开发：`npm run dev`
- Electron 调试：`npm run dev:electron`
- uTools 正式构建：`npm run build`
  - 在 macOS 上会先编译 `native/mac-smc-sensors` 与 `native/macos-powermetrics-helper`，再执行类型检查、Vite 构建和 uTools 入口页面生成。
  - 该流程需要本机可用的 `clang`，且 `macos-temperature-sensor` 必须已安装；非 macOS 会跳过原生辅助程序编译。
- Electron 打包：`npm run build:electron`
- 优先执行与改动对应的 `tests/*.test.cjs`，例如：`node tests/serviceReader.test.cjs`。对于 `.test.ts`，先沿用项目已有的运行方式；不要凭空引入新的测试运行器。
- 涉及 Vue、TypeScript 或入口配置时，至少执行 `npx vue-tsc --noEmit`；跨页面、uTools 入口、原生传感器或打包配置变更时，再运行对应的完整构建。
- 不要默认执行 `npm install`；仅在 `node_modules` 缺失、锁文件/依赖清单变更，或构建明确提示依赖缺失时执行。

## 构建产物

- `dist/`、`dist-electron/`、`release/` 和 `upx/` 是生成产物，不提交，除非任务明确要求交付产物。
- `vite.config.ts` 会在启动或构建时清理 `dist-electron/`；不要把该目录作为源文件或手工修改目标。
- `npm run build` 会生成多个 uTools 页面入口并向 `dist/` 拷贝 `vendor/`，修改入口页或原生组件后应以构建输出为准验证。
