# 鲜知贴 ESP32-S3 四色屏固件

该固件配合“鲜知贴”`fridge_tracker_server` MVP 使用，适用于 ESP32-S3 N16R8
开发板与 `800x480` 黑/白/黄/红四色电子墨水屏。

## 支持的屏幕

两种支持的屏幕共用同一份帧协议：

| 屏幕 | 尺寸 | GxEPD2 驱动 | `Config.h` |
| --- | --- | --- | --- |
| `GDEM075F52` | 7.5 寸 | `GxEPD2_750c_GDEM075F52` | `FRIDGE_USE_GDEM0397F81 0` |
| `GDEM0397F81` | 3.97 寸 | `GxEPD2_397c_GDEM0397F81` | `FRIDGE_USE_GDEM0397F81 1` |

屏幕驱动刻意采用编译期选择：两块屏幕均为 `800x480`，接收相同的
96,000 字节原生帧，但控制器指令集不同。

样机当前采用竖屏安装和展示：服务端以 `480x800` 布局渲染食材列表，
再将画面旋转打包为屏幕控制器要求的 `800x480` 原生帧。建议将屏幕从
原生横向方向逆时针旋转为竖向安装，使服务端画面与固件状态页保持正向。

## 固件流程

- 首次启动时，设备创建 `XianZhiTie-xxxxxx` Wi-Fi 热点。屏幕会提示用
  手机连接该热点，随后打开 `http://192.168.4.1` 并按页面提示填写
  Wi-Fi、服务地址和 H5 设备页生成的一次性配对码。
- 配网页会扫描附近 Wi-Fi 并提供 SSID 下拉选择；手机浏览器不能读取
  系统已保存的 Wi-Fi 密码，因此密码仍需手动输入。
- 配网信息、局域网服务地址和设备注册凭证写入 ESP32 NVS，不固化在受
  Git 跟踪的固件配置中。
- 新设备通过 `POST /api/device/register` 使用一次性配对码注册，服务端
  验证成功后会直接把设备绑定到生成该配对码的账号；注册成功后设备会
  清除本地保存的一次性配对码，只保留设备 token。
- 完成绑定后，ESP32 携带 Bearer 设备 token 与上一次保存的 `ETag`
  请求 `/api/device/frame.bin?panel=...`。
- 服务端未指定 `orientation` 时默认下发竖屏画面；固件自身的配网和
  错误提示页同样按竖屏绘制。
- 有变化的 96,000 字节帧先写入 FFat 临时文件，校验完整后再通过
  `display.drawNative()` 刷新；收到 HTTP `304` 时不刷新屏幕。
- Wi-Fi 连接失败时，设备会临时打开 10 分钟配网热点，方便修正旧的
  NVS 配置；下载失败时保留上一幅画面。每次正常检查后，屏幕与 Wi-Fi
  休眠 30 分钟。

按住开发板的 `BOOT` 按键（`GPIO0`）并按下复位，可清除配网信息并
重新打开设置门户。

## 本地服务配置

启动本地服务：

```sh
cd ../fridge_tracker_server
npm start
```

ESP32 无法访问 Mac 上的 `127.0.0.1`。连接实体硬件之前，请从示例配置
创建 `fridge_tracker_server/config.json` 并设置：

```json
{
  "host": "0.0.0.0",
  "port": 8788
}
```

在设备配网页面中填写 Mac 的局域网 URL，例如
`http://192.168.0.117:8788`。随后在 H5 页面登录，进入“设备”页面生成
一次性配对码，并把该码填入设备配网页。

在 Mac 上查询当前 Wi-Fi 局域网 IP：

```sh
networksetup -getinfo Wi-Fi
```

输出里的 `IP address` 就是要填写的地址，例如 `192.168.0.101` 时，
设备配网页面填写 `http://192.168.0.101:8788`。也可以用下面的命令
只输出 IP：

```sh
ipconfig getifaddr en0
```

如需直接使用服务端已创建的演示设备进行快速验证，也可以填写服务端
README 中的演示设备 token；实际设备应注册并使用各自独立的 token。

开发板设置：

- Board：`ESP32S3 Dev Module`
- Flash Size：`16MB`
- Partition Scheme：`16M Flash (3MB APP/9.9MB FATFS)`
- USB CDC On Boot：`Enabled`
- PSRAM：`OPI PSRAM`

串口监视器波特率为 `115200`。

## 接线

| 墨水屏转接板信号 | ESP32-S3 |
| --- | --- |
| GND | GND |
| 3V3 | 3V3 |
| SCK / CLK | GPIO 12 |
| SDA / DIN / MOSI | GPIO 11 |
| RST / RES | GPIO 7 |
| DC | GPIO 8 |
| CS | GPIO 10 |
| BUSY | GPIO 9 |

屏幕供电与全部信号线均必须使用 `3.3V`。本项目只向电子纸写入画面，
不连接 MISO。
