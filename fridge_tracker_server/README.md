# 鲜知贴服务端

“鲜知贴”家庭有效期物品与电子墨水屏提醒器的本地服务：

- 提供带导航栏的响应式 bento H5 工作台，将概览、物品管理、设备、助手和用户管理拆分为独立视图；支持地点复用、搜索和筛选。
- 使用 Node.js 内置的 `node:sqlite` 保存本地数据。
- 按上海时区计算到期状态，并优先展示最紧急的物品。
- 支持 `800x480` 四色屏和 `400x300` 黑白红三色屏，默认使用竖屏布局，并向设备提供原生帧及 `ETag`。
- 使用 Playwright 与 `sharp` 将 HTML 画面转换为帧数据；中文排版在服务端完成，而不是交给 ESP32。
- 提供带个人访问令牌认证的 Streamable HTTP MCP，让 Codex 等 Agent 管理当前家庭的有效期物品。
- 可选启用内置文字 Agent：管理员可提供系统配置，用户也可填写自己的 API Key；删除操作必须二次确认。

## 公共托管服务

没有自己的服务器时，可以直接使用：

```text
https://fridge.followllm.online
```

打开页面注册个人账号后，即可管理物品、生成设备配对码和创建个人 MCP
访问令牌。ESP32 配网页的服务地址填写
`https://fridge.followllm.online`。不同家庭的物品和设备相互隔离，MCP 令牌、
Agent 对话和个人模型配置仍按账号隔离；没有个人配置时才使用管理员提供的系统 Agent。

## 本地启动

需要 Node.js 22.5 或更高版本。

```sh
cd fridge_tracker_server
npm install
npm run install:browsers
npm start
```

打开：

```text
http://127.0.0.1:8788
```

未创建本地 `config.json` 时，服务会自动创建已被 Git 忽略的 SQLite 数据库 `data/fridge_v2.sqlite` 和示例内容，并使用以下演示配置：

`npm run install:browsers` 会下载 Playwright 管理的 Chromium，服务端不需要额外安装系统 Chrome。Linux 服务器如果缺少 Chromium 运行依赖，可改用 `npx playwright install --with-deps chromium`。

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

## 内置文字 Agent

管理员在 H5 的“用户 → 系统 Agent”中配置 API Key、模型 ID 和 Base URL，供未设置个人配置的用户使用。每位用户也可以在“我的 Agent”中保存自己的 API Key、模型和 Base URL；个人配置优先，仅当前账号可用，并且不消耗系统输入额度。Agent 对话记录、输入额度、个人配置和 MCP 访问令牌均按个人账号隔离。

页面不会再次回显完整 API Key，只显示末四位提示。用户只能查看和修改自己的个人配置，管理员另外可以修改系统配置。所有 API Key 使用 AES-256-GCM 加密后保存到 SQLite；服务端加密密钥来自 `config.json`：

```json
{
  "credentialEncryptionKey": "replace-with-a-long-random-secret"
}
```

如果没有显式设置 `credentialEncryptionKey`，服务会兼容性地使用 `adminPassword` 加密；正式部署仍建议配置独立随机密钥。部署后不要随意更换用于加密的值，否则已保存的系统和个人 API Key 都将无法解密，需要对应账号重新填写。使用其他 OpenAI-compatible 服务时，可把 Base URL 改为供应商提供的 `/v1` 地址。远程地址必须使用 HTTPS，本机模型服务可使用 `http://localhost` 或 `http://127.0.0.1`。

未配置系统模型时仍可使用其他功能，用户也可以填写个人配置后使用 Agent。当前内置 Agent 统一使用 Chat Completions API，官方 OpenAI 与兼容服务使用同一套 `tool_calls` / `role: tool` 消息协议。

新注册账号默认获得 100 次系统 Agent 文字输入额度；升级时，历史账号不足 100 次的剩余额度会一次性补到 100 次，已有更高额度不会减少。每条使用系统 Agent 的非空文本输入扣 1 次，同一输入触发的多轮工具调用不会重复扣除，确认或取消删除卡片也不扣额度。个人 API Key 不消耗系统额度。管理员可以在“用户 → 已注册用户”中查看已用、剩余和总额度，并修改任意账号的总额度；系统额度用完后，用户仍可填写个人 API Key，或等待管理员提高总额度。

助手支持有效期物品的批量查询、新增、修改和删除，并能按地点查找。食品缺少日期时可按常见储存条件保守推断；药品、保健品等健康相关物品必须提供明确到期日，或明确的起始日期与有效天数，助手不会猜测有效期或提供用药判断。删除操作由系统执行层生成五分钟有效的确认卡，卡片展示物品名称、分类、地点、数量和到期日；只有当前登录用户确认后才会在一个数据库事务中执行。历史对话、工具协议消息和确认状态仍按原有规则持久化。

## MCP 接入

登录 H5 后，在“用户”页面的“Agent 接入”区域创建个人访问令牌。令牌明文只显示一次，默认 90 天有效，可以随时撤销。MCP 地址为：

```text
http://127.0.0.1:8788/mcp
```

使用公共托管服务时，MCP 地址为：

```text
https://fridge.followllm.online/mcp
```

生成令牌后可以点击“复制给 Agent”，将自动生成一条包含当前 MCP 地址和本次令牌的安装指令。把它发送给 Codex 等 Agent 后，Agent 会按其客户端支持的方式配置 `xianzhitie`、安全保存 `XIANZHITIE_MCP_TOKEN` 并验证连接；令牌不应写入项目文件或提交到 Git。

Codex 的 `~/.codex/config.toml` 示例：

```toml
[mcp_servers.xianzhitie]
url = "http://127.0.0.1:8788/mcp"
bearer_token_env_var = "XIANZHITIE_MCP_TOKEN"
```

启动 Codex 前把刚创建的令牌放入环境变量：

```sh
export XIANZHITIE_MCP_TOKEN='xzt_...'
```

MCP 与内置 Agent 使用 `list_items`、`get_items`、`create_items`、`update_items` 和 `delete_items` 五个通用物品工具，可管理食品、药品、日用品等全部有效期物品。`list_items` 支持名称、分类、数量、地点模糊搜索和地点精确筛选；写入会先整批校验并在同一事务中执行。令牌只能访问其所属家庭的数据。

`adminLogin`、`adminEmail` 与 `adminPassword` 是本地管理员账号的初始
配置。修改 `adminPassword` 并重启服务后，服务会更新管理员账号的密码
哈希，并使该账号先前的浏览器登录会话失效，需要使用新密码重新登录。

登录页支持使用邮箱注册新账号。邮箱注册账号默认为普通成员，只能看到
自己的物品、设备和账号信息；管理员可在“用户”页面查看全部已注册账号
及对应的物品、设备数量。当前项目未上线时，如需完全启用新库而不沿用
旧数据，保持 `databasePath` 指向新的 SQLite 文件即可，例如
`data/fridge_v2.sqlite`。

如需让同一 Wi-Fi 下的实体 ESP32 访问 Mac，请在 `config.json` 中设置
`"host": "0.0.0.0"`，重启服务，然后在设备上填写 Mac 的局域网地址，
例如 `http://192.168.0.117:8788`。不要在 ESP32 上填写
`http://127.0.0.1:8788`。

在 Mac 上可以用下面的命令查询当前 Wi-Fi 局域网 IP：

```sh
networksetup -getinfo Wi-Fi
```

输出里的 `IP address` 就是要填写的地址；例如 `192.168.0.101` 对应
设备上的服务地址 `http://192.168.0.101:8788`。如果只想输出 IP，可用：

```sh
ipconfig getifaddr en0
```

## 数据与显示规则

- 添加物品时，可以直接填写到期日，也可以填写购买、生产或开封等起始日期与有效天数；有效天数范围为 0 到 36500。
- 地点为最长 40 字的可选字段，H5 会复用当前家庭用过的地点，并支持搜索和精确筛选。
- 预置分类保留全部食品细类，并增加零食、药品、保健品、美妆个护、日用品和宠物用品；屏幕为主要分类显示对应简图。
- `daysRemaining < 0`：已过期，使用红色显示。
- `0 <= daysRemaining <= 3`：即将到期；四色屏使用黄色，三色屏使用红色，并保留粗体和下划线区分。
- 其余物品使用黑色显示。
- 进度条表示到期紧急度：今天到期至剩余 7 天分别使用 `100%`、`88%`、`76%`、`64%`、`52%`、`40%`、`28%`、`20%`；超过 7 天后按剩余天数反比例缩短，最低保留 `8%` 可见长度。
- 显示排序为已过期优先，其次按最近到期时间排列；四色屏竖/横屏展示 9/8 项，4.2 寸三色屏竖/横屏展示 7/5 项，H5 保留全部记录。
- 日期计算统一使用 `Asia/Shanghai` 时区。
- 竖屏渲染使用交换宽高后的逻辑画布，打包时旋转回面板原生坐标；横屏直接使用面板原生方向。

## 接口

浏览器会话接口：

为兼容现有部署，物品接口继续使用 `/api/foods` 路径；请求和响应中的可选地点字段名为 `location`。

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
POST   /api/devices/pairing-codes
GET    /api/display/preview?panel=gdem075f52&orientation=portrait
GET    /api/display/preview?panel=gdey042z98&orientation=landscape
GET    /api/display/frame.png?panel=gdem075f52&orientation=portrait
GET    /api/access-tokens
POST   /api/access-tokens
DELETE /api/access-tokens/:id
GET    /api/agent/conversations
POST   /api/agent/conversations
GET    /api/agent/conversations/:id/messages
GET    /api/agent/settings
PUT    /api/agent/settings
DELETE /api/agent/settings
GET    /api/admin/agent/settings
PUT    /api/admin/agent/settings
DELETE /api/admin/agent/settings
PATCH  /api/users/:id/agent-quota
POST   /api/agent/messages
POST   /api/agent/actions/:id/confirm
POST   /api/agent/actions/:id/cancel
```

远程 Agent 接口：

```text
POST /mcp    # MCP Streamable HTTP，Authorization: Bearer xzt_...
```

设备接口：

```text
POST /api/device/register
GET  /api/device/frame.bin?panel=gdem075f52&orientation=portrait
GET  /api/device/frame.bin?panel=gdem0397f81&orientation=portrait
GET  /api/device/frame.bin?panel=gdey042z98&orientation=portrait
GET  /api/device/frame.png?panel=gdem075f52&orientation=portrait
```

`orientation` 可取 `portrait` 或 `landscape`；未提供时默认使用
`portrait`。统一固件的配网页可保存设备实际使用的方向。

设备拉取帧时使用以下请求头：

```http
Authorization: Bearer <device-token>
If-None-Match: "<previous-etag>"
```

两块四色屏共用以下原生帧协议：

```text
大小: 96,000 bytes
原生分辨率: 800 x 480
默认逻辑布局: 480 x 800 竖屏
打包方式: 每字节 4 个像素
像素编码: 黑色 00，白色 01，黄色 10，红色 11
```

4.2 寸 `GDEY042Z98` 使用双 1-bit 平面：

```text
大小: 30,000 bytes
原生分辨率: 400 x 300
默认逻辑布局: 300 x 400 竖屏
前 15,000 bytes: 黑色平面
后 15,000 bytes: 红色平面
白色像素: 两个平面对应位均为 1
```

二进制响应通过 `X-Frame-Format` 返回 `2bpp-bwyr` 或
`dual-1bpp-bwr`。`GET /api/health` 的 `panelProfiles` 字段同时列出各面板的
尺寸、颜色模式、帧格式和帧长度。

使用内置演示设备在本地请求帧：

```sh
curl -D - -H 'Authorization: Bearer local-fridge-device-token' \
  'http://127.0.0.1:8788/api/device/frame.bin?panel=gdem075f52&orientation=portrait' \
  --output /tmp/fridge-frame.bin
```

后续注册实体设备时，先登录 H5，在“设备”页面生成一次性配对码，然后
将该配对码填入设备配网页。调试 API 时也可以直接使用该配对码：

```sh
curl -X POST 'http://127.0.0.1:8788/api/device/register' \
  -H 'Content-Type: application/json' \
  -d '{"serial":"fridge-001","pairingCode":"A7K2Q9","panel":"gdem075f52"}'
```

同一个设备序列号如果已经绑定到某个账号，只能由该账号使用新的配对码
重新注册并轮换 token；其他账号尝试注册相同序列号会返回 `409`，配对码
不会被消费。

## 验证

```sh
npm run check
npm test
```

H5 页面可直接使用自动生成的示例物品查看效果。配套设备固件位于
`../esp32_epaper_fridge_tracker`，同一份代码支持 ESP32-C3 和 ESP32-S3：
固件通过配网页面配置 Wi-Fi、服务地址和一次性配对码，注册或接收设备 token，请求 `frame.bin`，
处理 `ETag`，并按面板协议调用 `drawNative()` 或 `drawImage()`。
