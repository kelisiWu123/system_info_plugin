# macOS 菜单栏独立指标配置设计

## 目标

提供一个可通过 uTools 搜索直接启动的「菜单栏显示设置」一级功能。用户可以分别开启 CPU 温度、CPU 负载、CPU 频率、风扇转速、内存使用率、磁盘读取和磁盘写入；每个已开启指标在 macOS 菜单栏中拥有独立的 status item。

## 用户入口

- 在 `plugin.json` 新增独立 feature code `hardwareMenubarSettings`。
- 提供「菜单栏设置」「托盘设置」「硬件托盘」等搜索关键词。
- feature 通过 `utools/preload.js` 直接打开 `a_menubar_settings` 独立窗口，不依赖硬件主界面。
- 独立窗口使用稳定的 `singletonKey`，重复搜索时聚焦已有设置窗口，不创建副本。

## 配置窗口

新增 `MenubarSettings` 页面和 `menubarSettings` 路由。窗口包含：

- 总开关：启用/关闭菜单栏监控。
- 图标开关：控制各指标 status item 是否显示 SF Symbol。
- 七个独立指标开关：
  - CPU 温度
  - CPU 负载
  - CPU 频率
  - 风扇转速
  - 内存使用率
  - 磁盘读取
  - 磁盘写入

开关变更后立即保存并同步到 helper；配置窗口关闭不影响已开启的菜单栏监控。默认保留现有 CPU 温度和 CPU 负载，新增频率、风扇、内存和磁盘读写默认关闭。

## 菜单栏展示

每个开启的指标创建一个独立 `NSStatusItem`，使用 macOS template SF Symbol：

| 指标 | SF Symbol | 示例标题 |
| --- | --- | --- |
| CPU 温度 | `thermometer.medium` | `55°C` |
| CPU 负载 | `gauge.with.needle` | `13%` |
| CPU 频率 | `speedometer` | `2.40 GHz` |
| 风扇转速 | `fanblades` | `1200 RPM` |
| 内存使用率 | `memorychip` | `38.8%` |
| 磁盘读取 | `arrow.down.circle` | `↓ 80 MB/s` |
| 磁盘写入 | `arrow.up.circle` | `↑ 12 MB/s` |

图标不可用时只显示指标标题；指标没有有效数据时显示 `--`。不再显示没有实际指标的 `HWInfoX` 空 status item。点击任一指标仍可打开共享菜单，菜单中保留当前指标详情、打开主界面和退出菜单栏操作。

## 数据与 IPC

扩展现有菜单栏 telemetry 快照，但不改变采样库：

- 风扇转速复用 `getCpuFanSpeed()`。
- 内存复用 `getMemInfo()`，使用 `used / total` 计算百分比，并保留字节值用于菜单详情。
- 磁盘读写复用 `getStorageIo()` 的 `readBytesPerSec` 和 `writeBytesPerSec`。
- CPU 温度、负载和频率继续复用现有值。

Node 服务将指标值和开关写入现有共享 telemetry 快照；唯一的 native helper 轮询并更新所有 status item。所有窗口共享同一 helper，不再让每个 preload 各自启动进程或各自维护 stdin 通道。

## 兼容与降级

- 现有已保存的 `showTemp`、`showLoad` 和 `showIcon` 字段继续被识别，并映射到新的指标设置。
- 旧配置缺少新字段时使用上述默认值。
- 任意单项采集失败只使该项显示 `--`，其他指标继续刷新。
- 非 macOS 环境仍可打开配置页，但显示平台不支持提示，不启动 macOS helper。

## 验证

1. 检查 `plugin.json` feature code 与 `utools/preload.js` export key 一致。
2. 运行 `npm run build`，验证入口页、preload、Vue/TypeScript 和 macOS helper 构建。
3. 运行现有菜单栏回归测试，并增加配置归一化、telemetry 字段和独立入口的回归覆盖。
4. 在 macOS 上搜索「菜单栏设置」，确认设置窗口可直接启动且重复搜索只保留一个窗口。
5. 分别开启 CPU 与风扇，确认菜单栏出现两个独立 status item；再开启内存和磁盘读写，确认各自独立出现并实时更新。
6. 关闭任一指标，确认对应 status item 消失而其他项不受影响；关闭总开关，确认所有 status item 消失。
