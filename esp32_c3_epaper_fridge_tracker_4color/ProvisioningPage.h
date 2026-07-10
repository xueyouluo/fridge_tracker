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
    input, select { width: 100%; height: 44px; border: 1px solid #c7c1b2; border-radius: 8px; padding: 0 11px; font: inherit; background: white; }
    .check { display: flex; align-items: center; gap: 9px; font-weight: 600; }
    .check input { width: 18px; height: 18px; margin: 0; padding: 0; }
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
      <p class="hint">NVS 中已有的 Wi-Fi 名称、服务地址和检查间隔会自动带入。为避免泄露，Wi-Fi 密码和设备 token 不显示；已有配置时留空即可保留。</p>
      <form action="/save" method="post">
        <label for="ssid">Wi-Fi 名称</label>
        <select id="ssidSelect" onchange="if(this.value)document.getElementById('ssid').value=this.value">
          %SSID_OPTIONS%
        </select>
        <input id="ssid" name="ssid" value="%SSID%" required>
        <label for="password">Wi-Fi 密码</label>
        <input id="password" name="password" type="password" placeholder="留空则保留已有密码">
        <label for="api">服务地址</label>
        <input id="api" name="api" value="%API%" placeholder="http://192.168.0.2:8788" required>
        <label for="pairing">设备配对码</label>
        <input id="pairing" name="pairing" value="%PAIRING%" placeholder="已注册设备留空；未注册时填写 6 位配对码">
        <label for="token">设备 token（可选）</label>
        <input id="token" name="token" type="password" placeholder="已注册设备留空则保留；需要替换时再填写">
        <label for="interval">检查间隔（分钟）</label>
        <input id="interval" name="interval" type="number" min="5" max="1440" step="1" value="%INTERVAL%" required>
        <p class="hint">设备按此间隔连接服务端检查新画面；只有内容变化时才刷新墨水屏。可设置 5–1440 分钟。手动开机后的配置热点不会超过这个间隔。</p>
        <label class="check" for="forceRefresh">
          <input id="forceRefresh" name="force_refresh" type="checkbox" value="1"%FORCE_REFRESH_CHECKED%>
          调试：每次检查都刷新屏幕
        </label>
        <p class="hint">默认关闭。开启后，即使服务器返回 304，也会使用本地缓存重新刷屏；不会重复下载画面。</p>
        <button type="submit">保存并连接</button>
      </form>
      <p class="hint">屏幕：<code>%PANEL%</code>。序列号：<code>%SERIAL%</code>。首次配置或需要修改 Wi-Fi 密码时才需要手动输入；已有密码留空即可保留。使用本地服务时请填写电脑的局域网 IP，不要填写 <code>127.0.0.1</code>。</p>
    </section>
  </main>
</body>
</html>
)HTML";

const char PROVISIONING_SAVED_PAGE[] PROGMEM = R"HTML(
<!doctype html>
<html lang="zh-CN"><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font-family:sans-serif;margin:40px;background:#f3f1e9}main{max-width:420px;background:#fff;padding:24px;border-radius:14px}</style>
</head><body><main><h1>已保存</h1><p>设备将关闭配置热点，并使用新设置连接服务端。</p></main></body></html>
)HTML";
