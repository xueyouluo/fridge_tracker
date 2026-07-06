# 鲜知贴

四色电子墨水屏食材保鲜提醒器项目，包含本地服务端和 ESP32-S3 固件。

## 目录

- `fridge_tracker_server/`：Node.js 本地 H5、API、SQLite 数据和四色屏帧生成服务。
- `esp32_s3_epaper_fridge_tracker_4color/`：ESP32-S3 N16R8 + `800x480` 黑/白/黄/红四色电子墨水屏固件。

## 本地启动服务端

需要 Node.js 22.5 或更高版本。

```sh
cd fridge_tracker_server
npm install
npm start
```

打开 `http://127.0.0.1:8788`。

本地私有配置从示例文件复制：

```sh
cp config.example.json config.json
```

`config.json`、SQLite 数据库、`node_modules/` 和日志文件都已被 Git 忽略。

## 编译固件

固件首次启动会打开 `XianZhiTie-xxxxxx` 配网热点，服务地址、Wi-Fi 和 H5 生成的一次性设备配对码会写入 ESP32 NVS，不需要提交到仓库。

```sh
'/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli' compile --clean --fqbn 'esp32:esp32:esp32s3:FlashSize=16M,PartitionScheme=app3M_fat9M_16MB,CDCOnBoot=cdc,PSRAM=opi' ./esp32_s3_epaper_fridge_tracker_4color
```

更多接口、显示规则和硬件接线见两个子目录内的 README。

## 开源前检查

- 选择并添加许可证文件。
- 确认 `fridge_tracker_server/config.json` 和 `fridge_tracker_server/data/` 未被提交。
- 将示例密码和演示设备 token 替换为部署环境自己的值。
