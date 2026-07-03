#pragma once

const char PROVISIONING_PAGE[] PROGMEM = R"HTML(
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>鲜知贴 · 设备设置</title>
  <style>
    :root { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #181818; background: #f3f1e9; }
    * { box-sizing: border-box; }
    body { margin: 0; }
    main { max-width: 520px; margin: 0 auto; padding: 28px 18px; }
    .card { background: white; border: 1px solid #d7d2c2; border-radius: 15px; padding: 21px; }
    h1 { margin: 0 0 8px; font-size: 26px; }
    p { color: #56534c; line-height: 1.45; }
    label { display: block; margin: 14px 0 6px; font-weight: 700; font-size: 14px; }
    input { width: 100%; height: 44px; border: 1px solid #c7c1b2; border-radius: 8px; padding: 0 11px; font: inherit; }
    button { margin-top: 20px; width: 100%; height: 46px; border: 0; border-radius: 9px; color: white; background: #161616; font: inherit; font-weight: 800; }
    code { background: #eee9dc; padding: 2px 4px; border-radius: 4px; }
    .hint { font-size: 13px; }
  </style>
</head>
<body>
  <main>
    <section class="card">
      <h1>鲜知贴 · 设备设置</h1>
      <p>将墨水屏连接到 Wi-Fi 与本地服务。</p>
      <form action="/save" method="post">
        <label for="ssid">Wi-Fi 名称</label>
        <input id="ssid" name="ssid" value="%SSID%" required>
        <label for="password">Wi-Fi 密码</label>
        <input id="password" name="password" type="password" placeholder="留空则保留已有密码">
        <label for="api">服务地址</label>
        <input id="api" name="api" value="%API%" placeholder="http://192.168.0.2:8788" required>
        <label for="claim">绑定码</label>
        <input id="claim" name="claim" value="%CLAIM%" placeholder="FRIDGE-001">
        <label for="provisioning">配网注册密钥</label>
        <input id="provisioning" name="provisioning" type="password" placeholder="注册新设备时必填">
        <label for="token">已有设备 token（可选）</label>
        <input id="token" name="token" type="password" placeholder="已注册的演示设备可直接填写">
        <button type="submit">保存并重启</button>
      </form>
      <p class="hint">屏幕：<code>%PANEL%</code>。序列号：<code>%SERIAL%</code>。使用本地服务时请填写电脑的局域网 IP，不要填写 <code>127.0.0.1</code>。</p>
    </section>
  </main>
</body>
</html>
)HTML";

const char PROVISIONING_SAVED_PAGE[] PROGMEM = R"HTML(
<!doctype html>
<html lang="zh-CN"><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font-family:sans-serif;margin:40px;background:#f3f1e9}main{max-width:420px;background:#fff;padding:24px;border-radius:14px}</style>
</head><body><main><h1>已保存</h1><p>屏幕正在重启，并将连接服务端。</p></main></body></html>
)HTML";
