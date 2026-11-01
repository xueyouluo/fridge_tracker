# 鲜知贴 ESP32-C3 / ESP32-S3 墨水屏固件

这一份 Arduino 固件同时支持 `ESP32-C3 Super Mini`、`墨鱼 AI V1.1.1` 和 `ESP32-S3 N16R8`。
编译时根据目标芯片和 C3 板型选择引脚、Wi-Fi 参数和显示缓冲策略，上层配网、注册、
帧下载、`ETag`、配置入口与休眠流程只维护一份。

## 编译前配置（先看这里）

编译前确认三件事：**C3 板型和屏幕型号在 `HardwareConfig.h` 中选择，处理器型号在
Arduino IDE 的开发板菜单中选择。不要手动修改 `BoardProfile.h`。**

### 1. 选择 C3 板型

墨鱼板和 Super Mini 都是 ESP32-C3，不能只靠 Arduino IDE 的处理器选项区分。
打开 `HardwareConfig.h`，把 `FRIDGE_C3_BOARD_TYPE` 设置为实际板型：

| 实际 C3 板型 | 配置值 |
| --- | --- |
| ESP32-C3 Super Mini | `FRIDGE_C3_BOARD_SUPER_MINI`（默认） |
| 墨鱼 AI V1.1.1 | `FRIDGE_C3_BOARD_MOYU_AI_V111` |

ESP32-S3 会忽略这个 C3 板型选项。

### 2. 选择屏幕

在同一个 `HardwareConfig.h` 中找到下面这行（保留原来的 F52 默认）：

```cpp
#define FRIDGE_PANEL_TYPE FRIDGE_PANEL_GDEM075F52
```

根据实际屏幕，只修改这一行最右侧的配置值，不要另外新增
`FRIDGE_PANEL_TYPE`：

| 实际屏幕 | 配置值 |
| --- | --- |
| 7.5 寸 GDEM075F52，800x480 黑白黄红四色 | `FRIDGE_PANEL_GDEM075F52` |
| 7.5 寸 GDEM075F53，800x480 黑白黄红四色，JD79665CA | `FRIDGE_PANEL_GDEM075F53` |
| 3.97 寸 GDEM0397F81，800x480 黑白黄红四色 | `FRIDGE_PANEL_GDEM0397F81` |
| 4.2 寸 GDEY042Z98 / E042A13，400x300 黑白红三色 | `FRIDGE_PANEL_GDEY042Z98` |

墨鱼 AI V1.1.1 + F53 成品应选择：

```cpp
#define FRIDGE_C3_BOARD_TYPE FRIDGE_C3_BOARD_MOYU_AI_V111
#define FRIDGE_PANEL_TYPE FRIDGE_PANEL_GDEM075F53
```

修改文件中已有的两行，不要在文件末尾重复定义。

### 3. 选择处理器

处理器不在代码中手动配置。在 Arduino IDE 中打开
`esp32_epaper_fridge_tracker.ino`，然后通过 `Tools → Board` 选择：

| 实际开发板 | Arduino IDE Board | 关键设置 |
| --- | --- | --- |
| ESP32-C3 Super Mini | `Nologo ESP32C3 Super Mini` | 4MB Flash；`No OTA (2MB APP/2MB FATFS)`；USB CDC Enabled |
| 墨鱼 AI V1.1.1 | `ESP32C3 Dev Module` | 4MB Flash；`No OTA (2MB APP/2MB FATFS)`；USB CDC Enabled |
| ESP32-S3 N16R8 | `ESP32S3 Dev Module` | 16MB Flash；`16M Flash (3MB APP/9.9MB FATFS)`；OPI PSRAM；USB CDC Enabled |

固件根据 Arduino IDE 选择的目标处理器进入 C3 或 S3 分支，C3 再读取板型配置。
命令行由 `--fqbn` 决定处理器；`sketch.yaml` 保留原来的 Super Mini 默认目标，
墨鱼板使用下面列出的通用 C3 命令。

## 功能

- 首次启动创建 `XianZhiTie-xxxxxx` 热点，打开 `192.168.4.1` 完成配置。
- 使用 H5 设备页生成的一次性配对码注册，并保存设备 Bearer token。
- 配网页可设置 Wi-Fi、服务地址、横/竖显示方向和 5–1440 分钟检查间隔。
- 手动上电会在本轮画面检查后开放最多 10 分钟配置窗口；定时唤醒不会开放。
- 使用 `ETag` 避免重复下载和刷新；没有有效本地帧时不会发送旧 `ETag`。
- 可选“调试：每次检查都刷新屏幕”，收到 `304` 时使用 FFat 缓存重新刷屏。
- 下载失败时保留上一幅画面；完成后关闭 Wi-Fi、休眠屏幕并进入深度睡眠。

墨鱼板 + F53 沿用本公开版的单帧协议：注册后下载
`/api/device/frame.bin?panel=gdem075f53`，使用 Bearer token 和 `ETag`。
可以使用公共托管服务，也可以使用本仓库自建服务；本仓库固件不请求 `/api/device/pages`，
不提供官方 1.1.3 的多页缓存和离线翻页。设备身份密钥注册逻辑仍保持本公开版原样。

已有官方 1.1.3 固件的墨鱼板 + F53 / GDEY042Z98 设备，也可连接更新后的本仓库服务端：
服务端为分页请求提供固定一页的兼容接口，保留本公开版物品布局和展示上限。
因此这些设备无需为连接自建服务降级固件；旧公开版服务端需更新代码并重启。

## 支持的屏幕

屏幕通过 `HardwareConfig.h` 中的 `FRIDGE_PANEL_TYPE` 在编译期选择：

| 屏幕 | 帧协议 | GxEPD2 驱动 | 配置值 |
| --- | --- | --- | --- |
| `GDEM075F52` | 800x480 四色，96,000 字节 | `GxEPD2_750c_GDEM075F52` | `FRIDGE_PANEL_GDEM075F52`（默认） |
| `GDEM075F53` | 800x480 四色，96,000 字节 | 本仓库 `GxEPD2_750c_GDEM075F53` | `FRIDGE_PANEL_GDEM075F53` |
| `GDEM0397F81` | 800x480 四色，96,000 字节 | `GxEPD2_397c_GDEM0397F81` | `FRIDGE_PANEL_GDEM0397F81` |
| `GDEY042Z98` / E042A13 | 400x300 黑白红，30,000 字节 | `GxEPD2_420c_GDEY042Z98` | `FRIDGE_PANEL_GDEY042Z98` |

例如选择 4.2 寸三色屏时，把默认配置行改成：

```cpp
#define FRIDGE_PANEL_TYPE FRIDGE_PANEL_GDEY042Z98
```

## 板卡适配

`BoardProfile.h` 根据 Arduino IDE/CLI 产生的 `CONFIG_IDF_TARGET_ESP32C3`
或 `CONFIG_IDF_TARGET_ESP32S3` 选择处理器，再读取 `HardwareConfig.h` 的 C3 板型。

- C3 通常没有 PSRAM：GxEPD2 页缓冲为 30 行，四色帧从 FFat 每次读取
  20 行并调用 `writeNative()`，最后执行一次整屏刷新。
- F53 使用独立 JD79665CA 初始化时序。C3 写帧前开启一次连续写入，再从首行开始
  顺序追加所有分块；只执行整屏刷新，不沿用 F52 的随机窗口或局刷命令。
- 配网页和错误提示页使用 GxEPD2 的页缓冲绘制，同样顺序写满一帧后整屏刷新。
- S3 使用原固件的 PSRAM 路径：四色帧完整读入 96 KB 缓冲后调用
  `drawNative()`。
- 三色屏在关闭 Wi-Fi 后读取两个 15 KB 平面并调用 `drawImage()`，两块板共用。
- C3 使用经过实机调整的 `8.5 dBm` Wi-Fi 发射功率；S3 使用核心默认值。

## 服务地址与设备绑定

### 使用公共托管服务

如果没有自己的服务器，可以打开以下地址注册个人账号，并在 H5“设备”页面
生成一次性配对码：

```text
https://fridge.followllm.online
```

连接设备创建的 `XianZhiTie-xxxxxx` 热点，打开 `http://192.168.4.1`，
填写家里 Wi-Fi、服务地址 `https://fridge.followllm.online` 和配对码。

### 使用本地服务

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

安装 Espressif `esp32` 开发板包、`GxEPD2` 和 `Adafruit GFX Library`。
本次适配参考的本机依赖版本为 ESP32 core `3.3.10`、GxEPD2 `1.6.9`、
Adafruit GFX `1.12.6`；这不是本次完整固件编译或实屏验收结果。
F53 驱动的 `.h/.cpp` 与主 `.ino` 放在同一目录，由 Arduino 一起构建。
以下命令在仓库根目录运行；`arduino-cli` 未加入 PATH 时使用本机安装路径。

### ESP32-C3 Super Mini

- Board：`Nologo ESP32C3 Super Mini`，也可使用 `ESP32C3 Dev Module`
- Flash：4 MB
- Partition Scheme：`No OTA (2MB APP/2MB FATFS)`
- USB CDC On Boot：`Enabled`
- Flash Mode：`QIO`

```sh
arduino-cli compile --clean \
  --fqbn 'esp32:esp32:nologo_esp32c3_super_mini:PartitionScheme=noota_ffat,CDCOnBoot=cdc' \
  ./esp32_epaper_fridge_tracker
```

### 墨鱼 AI V1.1.1 + GDEM075F53

- Board：`ESP32C3 Dev Module`
- Flash：4 MB
- Partition Scheme：`No OTA (2MB APP/2MB FATFS)`
- USB CDC On Boot：`Enabled`
- `HardwareConfig.h`：选择 `FRIDGE_C3_BOARD_MOYU_AI_V111` 和 `FRIDGE_PANEL_GDEM075F53`

```sh
arduino-cli compile --clean \
  --fqbn 'esp32:esp32:esp32c3:PartitionScheme=noota_ffat,CDCOnBoot=cdc' \
  ./esp32_epaper_fridge_tracker
```

### ESP32-S3 N16R8

- Board：`ESP32S3 Dev Module`
- Flash Size：16 MB
- Partition Scheme：`16M Flash (3MB APP/9.9MB FATFS)`
- USB CDC On Boot：`Enabled`
- PSRAM：`OPI PSRAM`

```sh
arduino-cli compile --clean \
  --fqbn 'esp32:esp32:esp32s3:FlashSize=16M,PartitionScheme=app3M_fat9M_16MB,CDCOnBoot=cdc,PSRAM=opi' \
  ./esp32_epaper_fridge_tracker
```

串口监视器波特率为 `115200`。

## 接线

| 墨水屏信号 | ESP32-C3 Super Mini | 墨鱼 AI V1.1.1 | ESP32-S3 N16R8 |
| --- | --- | --- | --- |
| `GND` | `GND` | 板载 | `GND` |
| `3V3` / `VCC` | `3V3` | 板载屏幕供电 | `3V3` |
| `SCK` / `CLK` | GPIO4 | GPIO4 | GPIO12 |
| `SDA` / `DIN` / `MOSI` | GPIO6 | GPIO6 | GPIO11 |
| `RST` / `RES` | GPIO5 | GPIO2 | GPIO7 |
| `DC` | GPIO3 | GPIO1 | GPIO8 |
| `CS1` / `CS` | GPIO7 | GPIO7 | GPIO10 |
| `BUSY` | GPIO10 | GPIO10 | GPIO9 |
| `CS2` | 不接 | 不接 | 不接 |
| `MISO` | 不接 | 不接 | 不接 |

屏幕供电与信号均使用 3.3V。转接板上的 `SDA` 是 SPI `MOSI`，不是 I2C。
墨鱼板使用板载屏幕驱动接口，F53 裸屏仍需确认 FPC 方向、供电和 BS1 的 4-wire SPI
选择，不能照抄厂商样例中的其他开发板引脚。

C3 接线应避开 GPIO20/GPIO21；部分 Super Mini 板在天线附近接线后可能影响
配置热点发现。如果 USB 供电时 Wi-Fi 明显变差，检查线材、供电压降、USB 3.x
干扰，以及天线附近的屏幕排线或金属外壳。

## 配置入口与运行日志

本版固件启动时检测配置按键，按住时会清空本固件的配网设置和缓存帧并进入首次配置。
墨鱼板的 BOOT 是 GPIO9，也是下载模式脚：**先松开 BOOT 点按 RST，再在约 2.5 秒的
串口启动等待期间按住 BOOT，保持到配置被清除。不要按住 BOOT 再按 RST，否则会进入
下载模式。** Super Mini 和 S3 保留原来的 GPIO0 配置按键映射。
GPIO9 不能唤醒深睡中的 ESP32-C3，墨鱼板需先按 RST；本版没有多击翻页手势。
设备已经装入
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

## 墨鱼板 + F53 实屏验收

适配源码沿用现有 F53 驱动和公开版单帧流程，仍需编译并在实际墨鱼板 + F53 上验收：

1. 首次配网提示页能完整刷新，启动日志为 `Moyu AI V1.1.1 / gdem075f53`。
2. 使用目标服务的配对码注册，下载帧为 96,000 字节，竖屏和横屏内容正确。
3. 连续两次下载不同画面均可完整刷新，观察 F53 BUSY 释放和深睡后的再次唤醒。
4. 未变化时收到 `304` 并保留画面；启用调试强制刷新后可从 FFat 重绘。
5. 点按 RST 后按住 BOOT 能恢复配网设置；正常上电仍可通过配置窗口修改设置。

这套流程分别使用公共托管服务和自建公开版服务验证。需要恢复官方固件时，可前往
[硬件固件更新页面](https://fridge.followllm.online/hardware-update)选择与实际屏幕匹配的版本。
