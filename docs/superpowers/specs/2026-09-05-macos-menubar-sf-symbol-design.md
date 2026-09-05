# macOS 菜单栏 SF Symbol 图标设计

## 目标

将 macOS 菜单栏 helper 当前使用的彩色火焰字符 `🔥` 替换为 macOS 原生 SF Symbol `cpu`，让菜单栏入口更符合系统视觉风格，同时保留现有数据展示和 `showIcon` 开关行为。

## 范围

- 修改 `native/macos-menubar-helper/main.m` 的 status item 按钮图标初始化和更新逻辑。
- 保留现有温度、负载、频率文字及下拉菜单内容。
- 保留 `showIcon` JSON 配置语义：开启时显示图标，关闭时隐藏图标。
- 不新增外部图片资源，不改变 IPC 协议，不调整风扇或磁盘指标采集范围。

## 视觉与交互设计

- 使用 `NSImage imageWithSystemSymbolName:@"cpu" accessibilityDescription:@"HWInfoX 硬件监控"` 创建图标。
- 将图标设为 template image，使 macOS 自动适配浅色和深色菜单栏。
- 使用合适的 image scaling，并将图标作为 status item button 的 image；实时数值继续作为 button title 显示。
- 菜单栏无可用实时数值时仍显示 `HWInfoX`，避免入口消失。
- 若运行环境无法提供该 SF Symbol，回退为现有文字入口，不阻止 helper 启动。

## 数据流与边界

现有 Node/uTools 服务继续通过 stdin 向 helper 发送 JSON。helper 只负责把 `showIcon` 状态映射到 status item image，并继续在主线程更新 AppKit UI；不改变 telemetry 的字段、采样频率或进程生命周期。

## 验证

1. 使用 clang 编译 macOS helper，确认 Objective-C 代码和 Cocoa 链接通过。
2. 运行 `npm run build`，确认 Windows helper 校验、TypeScript、Vite 构建和 uTools 入口生成均通过。
3. 运行 `node tests/macMenubarHelper.test.cjs`，确认现有菜单栏 IPC 配置和 telemetry 序列化回归测试通过。
4. 在 macOS 深色和浅色外观下手动确认图标可见、大小合适，且 `showIcon: false` 时只隐藏图标不影响数值文字。

## 非目标

- 本次不加入风扇转速、磁盘读写等新指标。
- 本次不制作自定义位图、SVG 或应用图标资源。
- 本次不增加菜单栏图标的动态状态切换。
