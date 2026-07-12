# 仓库指南

## 项目结构与模块组织

本仓库是“鲜知贴”食材保鲜提醒器项目，包含服务端、双目标固件和 4.2 寸外壳 CAD：

- `fridge_tracker_server/`：Node.js 本地 H5 应用、API、SQLite 数据持久化，以及四色电子墨水屏帧渲染服务。
- `fridge_tracker_server/src/`：服务入口、领域逻辑、渲染器、用户与账号辅助模块。
- `fridge_tracker_server/public/`：浏览器端资源，包括 `index.html`、`app.js`、`styles.css` 和 favicon。
- `fridge_tracker_server/test/`：基于 Node test runner 的领域逻辑、渲染器和用户行为测试。
- `esp32_epaper_fridge_tracker/`：同时面向 ESP32-C3 Super Mini 和 ESP32-S3 N16R8 的 Arduino 固件，支持 800x480 四色屏和 400x300 三色屏；板卡引脚和内存策略集中在 `BoardProfile.h`。
- `models/ink_frame_v1/`：4.2 寸墨水屏外壳的 build123d 参数化源码、STEP 装配/零件、STL/3MF 打印文件、设计检查与审图记录；尺寸集中在 `ink_frame_common.py`。

## 构建、测试与开发命令

服务端命令需在 `fridge_tracker_server/` 目录下运行：

```sh
npm install
npm start      # 按配置的 host/port 启动本地服务
npm run dev    # 使用 Node --watch 进行本地迭代
npm run check  # 检查服务端和浏览器端 JavaScript 语法
npm test       # 运行 test/*.test.js 中的 node:test 测试
```

外壳模型需要 Python 3.12、`build123d` 和 `cadpy`。在项目本地虚拟环境安装依赖后，从仓库根目录运行：

```sh
python models/ink_frame_v1/design_checks.py
```
## 代码风格与命名约定

服务端代码使用 CommonJS、`"use strict"`、两个空格缩进、双引号、分号、`camelCase` 函数名和 `UPPER_CASE` 常量。领域计算放在 `src/domain.js`，渲染逻辑放在 `src/renderer.js`，HTTP、会话和用户相关行为放在 `src/server.js` 或 `src/users.js`。固件常量集中在 `Config.h`；硬件相关改动应使用明确的 `static const` 值，并在引脚或屏幕配置附近说明。

## 测试规范

测试使用 Node 内置的 `node:test` 和 `node:assert/strict`。测试名称应描述行为，例如 `test("portrait is the default display orientation...", ...)`。修改到期计算、屏幕排序、帧生成、认证或用户/设备归属规则时，需要新增或更新测试。修改外壳尺寸、配合、开孔、电子件布局或紧固结构时，需要运行 `design_checks.py`，重新导出 STEP，并检查完整装配和前后壳零件。提交 PR 前运行与改动范围对应的检查。

## 提交与 Pull Request 规范

当前 Git 历史只有一次初始导入，因此提交信息建议使用简短的祈使句，例如 `Add device claim validation` 或 `Fix portrait frame ordering`。PR 应分别说明服务端和固件影响，列出已执行的验证命令，关联相关 issue；如果改动 H5 布局或屏幕预览输出，请附截图。

## 安全与配置提示

不要提交 `fridge_tracker_server/config.json`、`fridge_tracker_server/data/`、`.env*`、生成的帧二进制文件或构建产物。需要本地配置时从 `config.example.json` 复制开始；在将服务暴露到 localhost 之外前，务必替换演示密码和演示设备 token。
