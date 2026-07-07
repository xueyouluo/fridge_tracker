# 鲜知贴 ESP32-C3 Super Mini 四色屏固件

该固件配合“鲜知贴”`fridge_tracker_server` MVP 使用，目标是在
`ESP32-C3 Super Mini` 上尽量保留 ESP32-S3 版的完整功能：

- 首次启动热点配网。
- 使用 H5 设备页生成的一次性配对码注册。
- 使用 Bearer 设备 token 请求 `/api/device/frame.bin?panel=...`。
- 保存 `ETag`，服务端返回 `304` 时不刷新屏幕。
- 下载失败时保留上一幅画面。
- 正常检查后关闭 Wi-Fi、墨水屏休眠并进入深度睡眠。

ESP32-C3 Super Mini 通常没有 PSRAM，因此该版本是偏实验但成功率更高的
C3 移植版；如果要长期稳定运行，ESP32-S3 N16R8 仍是更稳的硬件。

## 支持的屏幕

两种支持的屏幕共用同一份服务端帧协议：

| 屏幕 | 尺寸 | GxEPD2 驱动 | `Config.h` |
| --- | --- | --- | --- |
| `GDEM075F52` | 7.5 寸 | `GxEPD2_750c_GDEM075F52` | `FRIDGE_USE_GDEM0397F81 0` |
| `GDEM0397F81` | 3.97 寸 | `GxEPD2_397c_GDEM0397F81` | `FRIDGE_USE_GDEM0397F81 1` |

两块屏幕均为 `800x480` 黑/白/黄/红四色原生帧。服务端以 `480x800`
竖屏布局渲染，再旋转打包成屏幕控制器需要的 `800x480` native frame。

## C3 内存策略

四色 native frame 大小固定为：

```text
800 * 480 * 2bit / 8 = 96,000 bytes
```

为提高 C3 成功率，本版本相对 S3 固件做了这些调整：

- `GxEPD2` 页缓冲高度降到 `30` 行，降低全局显示缓冲占用。
- 启动时不分配 `96KB` 整帧缓冲。
- HTTP 下载先写入 FFat 临时文件，不把网络响应整帧放进内存。
- 请求完成后先关闭 Wi-Fi，再从 FFat 按 `20` 行一块读取并调用
  `writeNative()` 写入屏幕控制器内存。
- 每个刷屏块只需要 `4,000` 字节 RAM，最后统一 `refresh(false)` 刷新整屏。
- 串口打印 `ESP.getFreeHeap()` 和最大连续 `8-bit` 内存块，方便判断 C3
  是否还有足够余量。
- 如果本地没有有效帧，即使 NVS 里保存了旧 `ETag`，也不会发送
  `If-None-Match`，避免拿到 `304` 但设备没有可显示文件。

## 本地服务配置

启动本地服务：

```sh
cd ../fridge_tracker_server
npm start
```

ESP32-C3 无法访问 Mac 上的 `127.0.0.1`。连接实体硬件之前，请从示例配置
创建 `fridge_tracker_server/config.json` 并设置：

```json
{
  "host": "0.0.0.0",
  "port": 8788
}
```

在设备配网页面中填写 Mac 的局域网 URL，例如
`http://192.168.0.101:8788`。随后在 H5 页面登录，进入“设备”页面生成
一次性配对码，并把该码填入设备配网页。

在 Mac 上查询当前 Wi-Fi 局域网 IP：

```sh
ipconfig getifaddr en0
```

本地开发建议优先使用 `http://...:8788`。C3 可以走 HTTPS，但 TLS 会明显
增加内存压力，调试阶段不建议先把问题复杂化。

## Arduino IDE 设置

开发板设置：

- Board：`Nologo ESP32C3 Super Mini`
- Partition Scheme：`No OTA (2MB APP/2MB FATFS)`
- USB CDC On Boot：`Enabled`
- Flash Mode：`QIO`

如果 Arduino IDE 里看不到 `Nologo ESP32C3 Super Mini`，可先用
`ESP32C3 Dev Module`，但同样选择 `4MB Flash`、`No OTA (2MB APP/2MB FATFS)`
并启用 USB CDC。

命令行编译参考：

```sh
'/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli' compile --clean \
  --fqbn 'esp32:esp32:nologo_esp32c3_super_mini:PartitionScheme=noota_ffat,CDCOnBoot=cdc' \
  /Users/xueyouluo/Documents/fridge_tracker/esp32_c3_epaper_fridge_tracker_4color
```

串口监视器波特率为 `115200`。

## 接线

下表按已校对过的 ESP32-C3 Super Mini 丝印来写。照片里左排从上到下是
`5V`、`G`、`3.3`、`4`、`3`、`2`、`1`、`0`；右排从上到下是
`5`、`6`、`7`、`8`、`9`、`10`、`20`、`21`。

注意右排最上面的 `5` 是 `GPIO5`，不是左上角的 `5V`。

| 墨水屏转接板信号 | ESP32-C3 Super Mini 丝印 | 照片位置 |
| --- | --- | --- |
| `GND` | `G` | 左排第 2 个 |
| `3V3` / `VCC` | `3.3` | 左排第 3 个 |
| `SCK` / `CLK` | `4` / `GPIO4` | 左排第 4 个 |
| `SDA` / `DIN` / `MOSI` | `6` / `GPIO6` | 右排第 2 个 |
| `RST` / `RES` | `5` / `GPIO5` | 右排第 1 个 |
| `DC` | `3` / `GPIO3` | 左排第 5 个 |
| `CS1` / `CS` | `7` / `GPIO7` | 右排第 3 个 |
| `BUSY` | `10` / `GPIO10` | 右排第 6 个 |
| `CS2` | 不接 | 不接 |

注意：

- 墨水屏驱动板上的 `SDA` 是 SPI `MOSI`，不是 I2C `SDA`。
- 本项目不接 `MISO`。
- 这套接线避开了 `GPIO8`、`GPIO9`、`GPIO20`、`GPIO21`。
- 只接 `3V3`，不要把屏幕供电接到 `5V`。

## 串口判断

启动后重点看这些日志：

```text
Heap after display init: free=... largest=...
Heap before frame request: free=... largest=...
Heap after Wi-Fi off: free=... largest=...
Heap before chunked drawNative: free=... largest=...
Heap before full refresh: free=... largest=...
```

新版本不再分配 `96KB` native frame；如果刷屏阶段失败，优先看
`Frame read error`、FATFS 文件大小、屏幕 BUSY 线和 SPI 接线。

如果串口显示 `HTTP -1`，先看它发生在 `Heap before frame request` 之后还是
刷屏前；这通常是连接/TLS/堆内存阶段的问题，不等同于服务端 token 错误。
