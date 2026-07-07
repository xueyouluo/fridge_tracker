# 鲜知贴

四色电子墨水屏食材保鲜提醒器项目，包含本地服务端、ESP32-S3 稳定版固件和
ESP32-C3 Super Mini 实验版固件。

## 目录

- `fridge_tracker_server/`：Node.js 本地 H5、API、SQLite 数据和四色屏帧生成服务。
- `esp32_s3_epaper_fridge_tracker_4color/`：ESP32-S3 N16R8 + `800x480` 黑/白/黄/红四色电子墨水屏固件。
- `esp32_c3_epaper_fridge_tracker_4color/`：ESP32-C3 Super Mini + 同款 `800x480` 四色屏的高成功率移植版固件。

## 本地启动服务端

需要 Node.js 22.5 或更高版本。

```sh
cd fridge_tracker_server
npm install
npm run install:browsers
npm start
```

打开 `http://127.0.0.1:8788`。

本地私有配置从示例文件复制：

```sh
cp config.example.json config.json
```

`config.json`、SQLite 数据库、`node_modules/` 和日志文件都已被 Git 忽略。

## 本地部署流程

1. 复制 `fridge_tracker_server/config.example.json` 为 `config.json`，修改管理员密码和演示设备 token。
2. 如果实体 ESP32 需要访问 Mac，把 `config.json` 中的 `host` 改为 `0.0.0.0`，然后重启服务。
3. 在 Mac 上查询局域网 IP：

```sh
ipconfig getifaddr en0
```

4. 启动服务端后打开 `http://127.0.0.1:8788`，登录 H5，在“设备”页面生成一次性配对码。
5. 编译并上传固件。首次启动后连接设备创建的 `XianZhiTie-xxxxxx` 热点，打开 `http://192.168.4.1`。
6. 在配网页填写家里 Wi-Fi、Mac 的局域网服务地址（例如 `http://192.168.0.101:8788`）和 H5 生成的配对码。
7. 保存重启后，回到 H5 的“设备”页面确认设备出现；设备下一次成功拉取帧后会显示最近同步时间。

## 编译固件

固件首次启动会打开 `XianZhiTie-xxxxxx` 配网热点，服务地址、Wi-Fi 和 H5 生成的一次性设备配对码会写入 ESP32 NVS，不需要提交到仓库。

```sh
'/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli' compile --clean --fqbn 'esp32:esp32:esp32s3:FlashSize=16M,PartitionScheme=app3M_fat9M_16MB,CDCOnBoot=cdc,PSRAM=opi' ./esp32_s3_epaper_fridge_tracker_4color
```

ESP32-C3 Super Mini 实验版：

```sh
'/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli' compile --clean \
  --fqbn 'esp32:esp32:nologo_esp32c3_super_mini:PartitionScheme=noota_ffat,CDCOnBoot=cdc' \
  ./esp32_c3_epaper_fridge_tracker_4color
```

上传时按固件目录选择对应开发板：S3 版使用 `ESP32S3 Dev Module`，C3 版使用
`Nologo ESP32C3 Super Mini`；使用 CLI 时把串口替换为实际设备端口。

更多接口、显示规则和硬件接线见各子目录内的 README。

## 开源前检查

- 选择并添加许可证文件。
- 确认 `fridge_tracker_server/config.json` 和 `fridge_tracker_server/data/` 未被提交。
- 将示例密码和演示设备 token 替换为部署环境自己的值。
