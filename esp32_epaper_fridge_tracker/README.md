# 鲜知贴 ESP32-C3 / ESP32-S3 墨水屏固件

这一份 Arduino 固件同时支持 `ESP32-C3 Super Mini` 和 `ESP32-S3 N16R8`。
编译时根据目标芯片自动选择引脚、Wi-Fi 参数和显示缓冲策略，上层配网、注册、
帧下载、`ETag`、配置入口与休眠流程只维护一份。

## 功能

- 首次启动创建 `XianZhiTie-xxxxxx` 热点，打开 `192.168.4.1` 完成配置。
- 使用 H5 设备页生成的一次性配对码注册，并保存设备 Bearer token。
- 配网页可设置 Wi-Fi、服务地址、横/竖显示方向和 5–1440 分钟检查间隔。
- 手动上电会在本轮画面检查后开放最多 10 分钟配置窗口；定时唤醒不会开放。
- 使用 `ETag` 避免重复下载和刷新；没有有效本地帧时不会发送旧 `ETag`。
- 可选“调试：每次检查都刷新屏幕”，收到 `304` 时使用 FFat 缓存重新刷屏。
- 下载失败时保留上一幅画面；完成后关闭 Wi-Fi、休眠屏幕并进入深度睡眠。

## 支持的屏幕

在 `Config.h` 中通过 `FRIDGE_PANEL_TYPE` 编译期选择屏幕：

| 屏幕 | 帧协议 | GxEPD2 驱动 | 配置值 |
| --- | --- | --- | --- |
| `GDEM075F52` | 800x480 四色，96,000 字节 | `GxEPD2_750c_GDEM075F52` | `FRIDGE_PANEL_GDEM075F52`（默认） |
| `GDEM0397F81` | 800x480 四色，96,000 字节 | `GxEPD2_397c_GDEM0397F81` | `FRIDGE_PANEL_GDEM0397F81` |
| `GDEY042Z98` / E042A13 | 400x300 黑白红，30,000 字节 | `GxEPD2_420c_GDEY042Z98` | `FRIDGE_PANEL_GDEY042Z98` |

例如选择 4.2 寸三色屏：

```cpp
#define FRIDGE_PANEL_TYPE FRIDGE_PANEL_GDEY042Z98
```

## 板卡适配

`BoardProfile.h` 根据 `CONFIG_IDF_TARGET_ESP32C3` 或
`CONFIG_IDF_TARGET_ESP32S3` 自动选择板卡，不需要手动修改板卡宏。

- C3 通常没有 PSRAM：GxEPD2 页缓冲为 30 行，四色帧从 FFat 每次读取
  20 行并调用 `writeNative()`，最后执行一次整屏刷新。
- S3 使用原固件的 PSRAM 路径：四色帧完整读入 96 KB 缓冲后调用
  `drawNative()`。
- 三色屏在关闭 Wi-Fi 后读取两个 15 KB 平面并调用 `drawImage()`，两块板共用。
- C3 使用经过实机调整的 `8.5 dBm` Wi-Fi 发射功率；S3 使用核心默认值。

## 本地服务配置

ESP32 无法访问 Mac 上的 `127.0.0.1`。实体设备需要让服务监听局域网：

```json
{
  "host": "0.0.0.0",
  "port": 8788
}
```

启动服务并查询 Mac 局域网 IP：

```sh
cd ../fridge_tracker_server
npm start
ipconfig getifaddr en0
```

在 H5“设备”页面生成一次性配对码。连接设备热点后，在配网页填写家里 Wi-Fi、
类似 `http://192.168.0.101:8788` 的局域网地址和配对码。

已有配置重新进入页面时，SSID、服务地址、方向和检查间隔会自动带入。密码与
设备 token 不回显；对应输入框留空会保留原值。

## Arduino IDE 与命令行

### ESP32-C3 Super Mini

- Board：`Nologo ESP32C3 Super Mini`，也可使用 `ESP32C3 Dev Module`
- Flash：4 MB
- Partition Scheme：`No OTA (2MB APP/2MB FATFS)`
- USB CDC On Boot：`Enabled`
- Flash Mode：`QIO`

```sh
'/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli' compile --clean \
  --fqbn 'esp32:esp32:nologo_esp32c3_super_mini:PartitionScheme=noota_ffat,CDCOnBoot=cdc' \
  /Users/xueyouluo/Documents/fridge_tracker/esp32_epaper_fridge_tracker
```

### ESP32-S3 N16R8

- Board：`ESP32S3 Dev Module`
- Flash Size：16 MB
- Partition Scheme：`16M Flash (3MB APP/9.9MB FATFS)`
- USB CDC On Boot：`Enabled`
- PSRAM：`OPI PSRAM`

```sh
'/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli' compile --clean \
  --fqbn 'esp32:esp32:esp32s3:FlashSize=16M,PartitionScheme=app3M_fat9M_16MB,CDCOnBoot=cdc,PSRAM=opi' \
  /Users/xueyouluo/Documents/fridge_tracker/esp32_epaper_fridge_tracker
```

串口监视器波特率为 `115200`。

## 接线

| 墨水屏转接板 | ESP32-C3 Super Mini | ESP32-S3 N16R8 |
| --- | --- | --- |
| `GND` | `GND` | `GND` |
| `3V3` / `VCC` | `3V3` | `3V3` |
| `SCK` / `CLK` | GPIO4 | GPIO12 |
| `SDA` / `DIN` / `MOSI` | GPIO6 | GPIO11 |
| `RST` / `RES` | GPIO5 | GPIO7 |
| `DC` | GPIO3 | GPIO8 |
| `CS1` / `CS` | GPIO7 | GPIO10 |
| `BUSY` | GPIO10 | GPIO9 |
| `CS2` | 不接 | 不接 |
| `MISO` | 不接 | 不接 |

屏幕供电与信号均使用 3.3V。转接板上的 `SDA` 是 SPI `MOSI`，不是 I2C。

C3 接线应避开 GPIO20/GPIO21；部分 Super Mini 板在天线附近接线后可能影响
配置热点发现。如果 USB 供电时 Wi-Fi 明显变差，检查线材、供电压降、USB 3.x
干扰，以及天线附近的屏幕排线或金属外壳。

## 配置入口与运行日志

按住 BOOT（GPIO0）复位会清空 NVS 和缓存帧并重新进入首次配置。设备已经装入
外壳时，也可以断电再上电：有有效配置时会先检查画面，再开放有限时间的热点。
热点占用时间会从本轮检查间隔中扣除。

串口启动行会同时打印板卡和面板，例如：

```text
=== XianZhi Tie e-paper boot: ESP32-C3 Super Mini / gdem075f52 ===
```

C3 四色屏的健康路径应包含：

```text
Stored frame bytes: 96000
Heap after Wi-Fi off: free=... largest=...
Heap before chunked drawNative: free=... largest=...
Heap before full refresh: free=... largest=...
```

S3 四色屏应看到 `Heap after full-frame allocation` 和
`Heap before full-frame drawNative`。三色屏应看到 `Stored frame bytes: 30000`、
`Heap after tri-color plane allocation` 和 `Heap before tri-color drawImage`。
