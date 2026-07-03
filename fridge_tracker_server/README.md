# 鲜知贴服务端

“鲜知贴”四色电子墨水屏食材保鲜提醒器的本地 MVP 服务：

- 提供带导航栏的响应式 bento H5 工作台，将概览、食材管理、屏幕预览、设备绑定和用户管理拆分为独立视图。
- 使用 Node.js 内置的 `node:sqlite` 保存本地数据。
- 按上海时区计算到期状态，并优先展示最紧急的食材。
- 以 `480x800` 竖屏作为默认展示方向，并向设备提供 `800x480` 四色原生帧接口及 `ETag`。
- 使用 Playwright 与 `pngjs` 将 HTML 画面转换为帧数据；中文排版在服务端完成，而不是交给 ESP32。

## 本地启动

需要 Node.js 22.5 或更高版本。

```sh
cd fridge_tracker_server
npm install
npm start
```

打开：

```text
http://127.0.0.1:8788
```

未创建本地 `config.json` 时，服务会自动创建已被 Git 忽略的 SQLite 数据库 `data/fridge_v2.sqlite` 和示例内容，并使用以下演示配置：

```text
账号: admin
密码: fridge-demo
演示设备 token: local-fridge-device-token
```

如需保存不同于演示默认值的配置：

```sh
cp config.example.json config.json
```

在将服务暴露到本机以外的网络前，应先更换 `config.json` 中的所有密钥。`config.json` 和 `data/` 均已排除在 Git 跟踪范围外。

`adminLogin`、`adminEmail` 与 `adminPassword` 是本地管理员账号的初始
配置。修改 `adminPassword` 并重启服务后，服务会更新管理员账号的密码
哈希，并使该账号先前的浏览器登录会话失效，需要使用新密码重新登录。

登录页支持使用邮箱注册新账号。邮箱注册账号默认为普通成员，只能看到
自己的食材、设备和账号信息；管理员可在“用户”页面查看全部已注册账号
及对应的食材、设备数量。当前项目未上线时，如需完全启用新库而不沿用
旧数据，保持 `databasePath` 指向新的 SQLite 文件即可，例如
`data/fridge_v2.sqlite`。

如需让同一 Wi-Fi 下的实体 ESP32 访问 Mac，请在 `config.json` 中设置
`"host": "0.0.0.0"`，重启服务，然后在设备上填写 Mac 的局域网地址，
例如 `http://192.168.0.117:8788`。不要在 ESP32 上填写
`http://127.0.0.1:8788`。

## 数据与显示规则

- 添加食材时，可以直接填写到期日，也可以填写购买/生产日期和保鲜天数。
- 预置分类包含水果、蔬菜、肉类、海鲜、乳品、蛋类、饮料、豆制品、熟食、调味品、冷冻、甜点和其他，并在屏幕上显示对应简图。
- `daysRemaining < 0`：已过期，使用红色显示。
- `0 <= daysRemaining <= 3`：即将到期，使用黄色显示。
- 其余食材使用黑色显示。
- 进度条表示到期紧急度：今天到期至剩余 7 天分别使用 `100%`、`88%`、`76%`、`64%`、`52%`、`40%`、`28%`、`20%`；超过 7 天后按剩余天数反比例缩短，最低保留 `8%` 可见长度。
- 显示排序为已过期优先，其次按最近到期时间排列；默认竖屏展示前 9 项，横屏对照布局展示前 8 项，H5 保留全部记录。
- 日期计算统一使用 `Asia/Shanghai` 时区。
- 竖屏渲染使用 `480 x 800` 的逻辑画布，打包时旋转回面板原生 `800 x 480` 坐标，因此设备端帧大小和刷屏协议不变。

## 接口

浏览器会话接口：

```text
POST   /api/auth/login
POST   /api/auth/register
POST   /api/auth/logout
GET    /api/auth/me
GET    /api/users
GET    /api/foods
POST   /api/foods
PATCH  /api/foods/:id
DELETE /api/foods/:id
GET    /api/devices
POST   /api/devices/claim
GET    /api/display/preview?panel=gdem075f52&orientation=portrait
GET    /api/display/frame.png?panel=gdem075f52&orientation=portrait
```

设备接口：

```text
POST /api/device/register
GET  /api/device/frame.bin?panel=gdem075f52&orientation=portrait
GET  /api/device/frame.bin?panel=gdem0397f81&orientation=portrait
GET  /api/device/frame.png?panel=gdem075f52&orientation=portrait
```

`orientation` 可取 `portrait` 或 `landscape`；未提供时默认使用
`portrait`，因此现有固件无需更改拉帧 URL 即可切换到竖屏画面。

设备拉取帧时使用以下请求头：

```http
Authorization: Bearer <device-token>
If-None-Match: "<previous-etag>"
```

两种支持的屏幕共用同一份原生帧数据协议：

```text
大小: 96,000 bytes
原生分辨率: 800 x 480
默认逻辑布局: 480 x 800 竖屏
打包方式: 每字节 4 个像素
像素编码: 黑色 00，白色 01，黄色 10，红色 11
```

使用内置演示设备在本地请求帧：

```sh
curl -D - -H 'Authorization: Bearer local-fridge-device-token' \
  'http://127.0.0.1:8788/api/device/frame.bin?panel=gdem075f52&orientation=portrait' \
  --output /tmp/fridge-frame.bin
```

后续注册实体设备时，需要使用本地配置中的 provisioning key：

```sh
curl -X POST 'http://127.0.0.1:8788/api/device/register' \
  -H 'Content-Type: application/json' \
  -H 'X-Provisioning-Key: local-provisioning-key' \
  -d '{"serial":"fridge-001","claimCode":"ABCD-1234","panel":"gdem075f52"}'
```

## 验证

```sh
npm run check
npm test
```

H5 页面可直接使用自动生成的示例食材查看效果。配套设备固件位于
`../esp32_s3_epaper_fridge_tracker_4color`：
固件通过配网页面配置 Wi-Fi，注册或接收设备 token，请求 `frame.bin`，
处理 `ETag`，并将变化后的帧缓冲发送给 `display.drawNative()`。
