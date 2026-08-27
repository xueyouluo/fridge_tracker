# 墨水屏字体

系统模板的排版目标是 7.5 寸、800 × 480 画布（横屏 800 × 480、竖屏 480 × 800）。服务端先由
Playwright 以本目录的固定字体生成 PNG，再量化为设备原生帧；ESP32 不安装字体，也不会重新排版。

开源服务当前角色如下：

| 角色 | 字体 | 字号 |
| --- | --- | --- |
| 元信息、状态时间、页脚 | `fusion-pixel-12px-proportional-zh_hans.ttf.woff2` | 原生 12px |
| 列表名称、到期状态、汇总 | `unifont-17.0.05.otf` | 原生 16px |
| 页面标题 | Fusion Pixel | 24px（12px 的 2 倍） |

Fusion Pixel 来源：<https://github.com/TakWolf/fusion-pixel-font>，固定版本 `2026.07.20`；许可证为
`OFL-FusionPixel.txt`。GNU Unifont 固定版本、官方来源和 SHA-256 见
`SOURCE-Unifont-17.0.05.md`，许可证为 `OFL-Unifont.txt`。

渲染与字体目录只保留 Fusion Pixel 与 GNU Unifont 两套字体。字体角色由最终渲染器显式写入，
不再使用 8–10px 系统字体，也不允许缺少字体时静默回退。

7.5 寸模板的可见文字不得低于 12px。标题优先换行，元信息允许单行省略；新增字体或可见文案后，
必须检查最终量化帧的缺字、基线、换行和四色/黑白量化效果。部署服务端时必须同时复制 Fusion Pixel、
GNU Unifont 与各自的许可证文件；缺少当前使用的任一字体文件、出现非标准字号或回退到系统字体都会使
帧生成明确失败。
