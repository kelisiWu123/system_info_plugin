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
- `native/`：macOS 原生辅助程序源码，以及 Windows 传感器 helper 的 C# 源码。
- `vendor/`：随插件分发的第三方程序和预构建原生二进制；不要手工修改二进制文件。Windows `sensor-helper/` 也属于受构建脚本管理的预构建运行时。
- `scripts/`：原生传感器构建和 uTools 多入口页面生成脚本。
- `tests/`：按功能拆分的回归测试；目前没有统一的 `npm test` 脚本。

## 编码约束

- 遵循现有 Vue 3 Composition API 与 TypeScript 严格模式；不要以 `any` 绕过类型检查。
- 平台差异应集中在现有的 `src/utils/`、`utools/services/` 或原生辅助层处理，组件层保持数据展示职责。
- 修改传感器读取或监控调度时，保留无传感器权限、设备不支持或数据缺失时的现有降级展示，不把平台专有逻辑散落到多个页面。
- 新增或调整 uTools 功能时，同步检查 `plugin.json`、`utools/preload.js`、`utools/runtime.ts` 与相关页面路由。
- 修改 `native/` 下的原生 helper 源码后，不直接替换 `vendor/` 二进制；使用对应正式构建脚本重新生成，并保留构建产生的指纹/manifest 等校验文件。
- 未经明确要求，不更新 `vendor/` 中的第三方二进制、`package-lock.json` 或依赖版本。

## 原生传感器与 Windows 增强约束

- 把第三方 GUI 监控程序改造成无界面 helper 时，先区分“宿主/传输层”和“传感器引擎”。若目标只是改善启动与 IPC，不要同时替换已经验证过的传感器核心、版本线或数据语义；确需换引擎时按独立变更处理并做真实硬件回归。
- 不要假设第三方应用程序 `.exe` 可以直接当作可嵌入库引用，也不要仅凭产品名相同就认为 NuGet/library 与应用发布版使用同一套硬件核心。集成前确认程序集公开 API、版本、目标框架和上游发布关系。
- Windows helper 只负责权限、单实例、IPC、采样调度和数据序列化；低层硬件访问尽量复用选定的传感器库，不在插件侧重复实现 CPU/MSR/Super I/O 等驱动逻辑。
- 现有 `systeminformation`、系统原生接口和已验证平台 helper 仍是优先数据源；Windows helper 用于补齐低层传感器缺口，不为了同一指标再并行引入另一套重复采集链。
- `native/windows-sensor-helper/` 的源码变更后，显式运行 `npm run build:windows-helper` 重新生成 `vendor/openhardwaremonitor/sensor-helper/`。日常 macOS/Windows 发布构建不现场编译 C#，而由 `npm run build` / `npm run verify:windows-helper` 校验预构建 helper、运行时 DLL、manifest 与源码指纹。
- 预构建源码指纹必须跨平台稳定：文本参与 hash 前规范化 CRLF/LF；二进制仍按原始字节校验。不要让 Windows 生成、macOS 发布因为换行差异产生假 stale。
- 从 asar/vendor 释放原生运行时时，缓存键必须覆盖实际运行时版本或 helper 指纹，不能只检查某个旧 `.exe` 是否存在。新增 DLL/helper 后必须能自动避开旧缓存，防止“新包 + 旧 userData runtime”混用。
- 新包明确包含新 helper 时，helper 缺失、复制不完整或启动失败应返回明确错误，不要静默降级到旧 GUI/legacy 后端。Legacy fallback 只用于真正不包含新 helper 的旧包兼容路径。
- “进程运行中”不等于“传感器工作正常”。Windows 增强诊断至少要能区分：IPC 无响应、snapshot 异常、0 传感器、未枚举 CPU、CPU 过滤未命中、CPU 存在但无 Temperature、原始温度存在但上层未展示。诊断应保留原始 error、传感器类型/硬件类型计数和少量原始样本，并提供一键复制。
- 调试真实 Windows 问题时优先增加可观察性再猜原因。需要判断谁启动了进程时，记录选择的 backend、实际 executable path、runtime 目录、PID 和 fallback 原因；需要判断数据在哪层丢失时，从 helper raw snapshot → IPC → service 过滤 → 页面归一化逐层验证。
- 提权 helper 与普通 uTools 进程通信时，要同时考虑 DACL 与 Windows Mandatory Integrity Control；Named Pipe 权限必须允许同一用户的中完整性客户端访问提升后的 helper，同时保持本机、最小权限和只暴露必要命令。
- Windows 原生改动不能只以 macOS 上的类型检查/源码测试宣告完成。至少保留 Windows 真机 smoke 清单：helper 编译、UAC、Named Pipe、CPU/GPU 真实传感器、关闭/重启、升级旧缓存、安全软件影响和多窗口共享。

## 窗口实例约束

- uTools 每个独立入口使用稳定且彼此不同的 `singletonKey`。同一入口重复触发时恢复、显示并聚焦已有窗口，而不是继续创建新窗口；不同入口按产品语义决定是否允许并存。
- 不要用 preload/renderer 内的普通 `Map` 作为插件全局单例，因为不同 BrowserWindow 的 preload 上下文不共享。uTools 路径使用跨窗口可见的原子 pending/live 记录，Electron fallback 由主进程维护 BrowserWindow registry。
- 单例创建必须处理快速连续触发竞态：在真正创建窗口前先原子占位，窗口关闭/崩溃时清理或探活淘汰 stale record。

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
- Windows helper 重新生成：`npm run build:windows-helper`。仅在修改 Windows helper 源码/运行时依赖后显式执行；生成物位于 `vendor/openhardwaremonitor/sensor-helper/`。
- Windows helper 预构建校验：`npm run verify:windows-helper`。正常发布前必须通过，确保 helper、DLL、manifest 与源码指纹一致。
- uTools 正式构建：`npm run build`
  - 先校验 Windows 预构建 helper；正常发布构建不会现场编译 C#。
  - 在 macOS 上还会编译 `native/mac-smc-sensors` 与 `native/macos-powermetrics-helper`，再执行类型检查、Vite 构建和 uTools 入口页面生成。
  - macOS 原生编译需要本机可用的 `clang`，且 `macos-temperature-sensor` 必须已安装；非 macOS 会跳过 macOS 原生辅助程序编译，但仍需通过 Windows helper 预构建校验。
- Electron 打包：`npm run build:electron`，同样先校验 Windows helper 预构建资产。
- 优先执行与改动对应的 `tests/*.test.cjs`，例如：`node tests/serviceReader.test.cjs`。对于 `.test.ts`，先沿用项目已有的运行方式；不要凭空引入新的测试运行器。
- 涉及 Vue、TypeScript 或入口配置时，至少执行 `npx vue-tsc --noEmit`；跨页面、uTools 入口、原生传感器或打包配置变更时，再运行对应的完整构建。
- 不要默认执行 `npm install`；仅在 `node_modules` 缺失、锁文件/依赖清单变更，或构建明确提示依赖缺失时执行。

## 构建产物

- `dist/`、`dist-electron/`、`release/` 和 `upx/` 是生成产物，不提交，除非任务明确要求交付产物。
- `vite.config.ts` 会在启动或构建时清理 `dist-electron/`；不要把该目录作为源文件或手工修改目标。
- `npm run build` 会生成多个 uTools 页面入口并向 `dist/` 拷贝 `vendor/`，修改入口页或原生组件后应以构建输出为准验证。
