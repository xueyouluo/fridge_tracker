# 鲜知贴

多面板电子墨水屏食材保鲜提醒器项目，包含本地服务端、同时支持
ESP32-C3 Super Mini 和 ESP32-S3 N16R8 的统一固件，以及 4.2 寸和 7.2 寸
设备外壳模型。

## 目录

- `fridge_tracker_server/`：Node.js 本地 H5、API、SQLite 数据及四色/三色屏帧生成服务。
- `esp32_epaper_fridge_tracker/`：ESP32-C3/S3 统一固件，支持 `800x480`
  四色屏及 E042A13 / GDEY042Z98 `400x300` 三色屏。
- `models/ink_frame_v1/`：4.2 寸墨水屏外壳的 build123d 参数化源码、STEP
  装配/零件、STL/3MF 打印文件、设计检查和审图记录。
- `models/epaper_enclosure_7_2/`：7.2 寸墨水屏外壳的 STEP 装配、Bambu Studio
  3MF 打印工程和实物预览。

## 4.2 寸外壳模型

完整装配请打开 `models/ink_frame_v1/ink_frame_assembly.step`；需要在 Fusion
360 中分别编辑或检查前后壳时，使用同目录下的 `ink_frame_front_bezel.step`
和 `ink_frame_rear_shell.step`。参数与待复测尺寸见 `CAD_BRIEF.md`，P2S 首版
打印方向和装配注意事项见 `PRINT_NOTES.md`，再生成与校验方式见该模型目录的
`README.md`。

如果你也想尝试让大模型根据实物尺寸生成自己的外壳或其他 3D 模型，可以参考
[模型目录中的设计方法](models/ink_frame_v1/README.md#设计方法全程由大模型完成建模)。
其中记录了 CAD Skill 的安装方式、硬件测量方法、如何向 coding agent 描述螺丝或
卡扣结构，以及通过多轮交互、Fusion 360 检查和实际打印逐步调整模型的完整流程。

## 7.2 寸外壳模型

7.2 寸外壳位于 `models/epaper_enclosure_7_2/`。使用 Fusion 360 查看或继续修改时
打开 `冰箱显示屏.step`；准备打印时可直接用 Bambu Studio 打开
`冰箱显示屏.3mf`。模型尺寸、文件结构、打印参数、实物预览及 MakerWorld 分享地址
见 [7.2 寸外壳说明](models/epaper_enclosure_7_2/README.md)。

## 无需自己部署

如果没有自己的服务器，可以直接使用公共托管服务：

```text
https://fridge.followllm.online
```

打开页面注册个人账号，在“设备”页面生成一次性配对码。连接设备创建的
`XianZhiTie-xxxxxx` 热点并打开 `http://192.168.4.1`，填写家里 Wi-Fi、
服务地址 `https://fridge.followllm.online` 和配对码即可完成绑定。

每个账号的食材、设备、访问令牌和模型配置相互隔离。内置助手使用的模型
API Key 仍由用户在“用户 → 我的模型”中自行配置。

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

## 自己部署服务

需要完全控制数据和服务运行环境时，可以按以下流程在本地或自己的服务器部署。

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

ESP32-C3 Super Mini：

```sh
'/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli' compile --clean \
  --fqbn 'esp32:esp32:nologo_esp32c3_super_mini:PartitionScheme=noota_ffat,CDCOnBoot=cdc' \
  ./esp32_epaper_fridge_tracker
```

ESP32-S3 N16R8：

```sh
'/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli' compile --clean \
  --fqbn 'esp32:esp32:esp32s3:FlashSize=16M,PartitionScheme=app3M_fat9M_16MB,CDCOnBoot=cdc,PSRAM=opi' \
  ./esp32_epaper_fridge_tracker
```

固件会根据编译目标自动选择 C3 或 S3 的引脚、Wi-Fi 参数与显示缓冲策略。
使用 CLI 上传时把串口替换为实际设备端口。

更多接口、显示规则和两种开发板的接线见统一固件目录内的 README。

## 开源前检查

- 选择并添加许可证文件。
- 确认 `fridge_tracker_server/config.json` 和 `fridge_tracker_server/data/` 未被提交。
- 将示例密码和演示设备 token 替换为部署环境自己的值。
