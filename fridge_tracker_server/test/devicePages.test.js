"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const { addDays, localDateKey } = require("../src/domain");

test("1.1.3 devices use the single-page adapter without breaking legacy devices", { timeout: 60000 }, async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "fridge-device-pages-"));
  let child;
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    await fs.rm(temp, { recursive: true, force: true });
  });

  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  const configPath = path.join(temp, "config.json");
  await fs.writeFile(configPath, JSON.stringify({
    host: "127.0.0.1", port, databasePath: path.join(temp, "test.sqlite"),
    adminLogin: "device-pages-test", adminPassword: "test-only-password",
    demoDeviceToken: "test-only-demo-token", credentialEncryptionKey: "test-only-encryption-key"
  }));
  child = spawn(process.execPath, ["--no-warnings=ExperimentalWarning", "src/server.js"], {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, FRIDGE_TRACKER_CONFIG: configPath, HOST: "127.0.0.1", PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("test server did not start")), 15000);
    let output = "";
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`test server exited: ${code}; ${output}`)); });
    child.stderr.on("data", (chunk) => { output = (output + chunk).slice(-4000); });
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes("XianZhi Tie listening")) {
        clearTimeout(timer);
        resolve();
      }
    });
  });

  const request = (resource, headers = {}, options = {}) => fetch(`http://127.0.0.1:${port}${resource}`, {
    ...options, headers, signal: AbortSignal.timeout(30000)
  });
  const post = (resource, body, headers = {}) => request(resource, { "Content-Type": "application/json", ...headers }, {
    method: "POST", body: JSON.stringify(body)
  });
  const login = await post("/api/auth/login", { login: "device-pages-test", password: "test-only-password" });
  assert.equal(login.status, 200);
  const userHeaders = { Cookie: login.headers.get("set-cookie").split(";")[0] };
  async function pair(serial, headers = userHeaders) {
    const pairing = await post("/api/devices/pairing-codes", {}, headers);
    assert.equal(pairing.status, 201);
    const registered = await post("/api/device/register", {
      serial, panel: "gdem075f53", pairingCode: (await pairing.json()).code
    });
    assert.equal(registered.status, 201);
    return { Authorization: `Bearer ${(await registered.json()).deviceToken}` };
  }
  const deviceHeaders = await pair("test-1.1.3-f53");
  const manifestPath = "/api/device/pages?panel=gdem075f53";
  const framePath = "/api/device/frame.bin?panel=gdem075f53";
  let manifest;
  let etag;

  await t.test("manifest authentication uses device tokens, not web sessions", async () => {
    for (const headers of [{}, userHeaders, { Authorization: "Bearer invalid-test-token" }]) {
      const response = await request(manifestPath, headers);
      assert.equal(response.status, 401);
      assert.match((await response.json()).error, /device token/);
      assert.equal((await request(`${framePath}&paging=1&page=0&revision=invalid`, headers)).status, 401);
    }
  });

  await t.test("manifest has one page, firmware-compatible hashes and conditional caching", async () => {
    const response = await request(manifestPath, deviceHeaders);
    assert.equal(response.status, 200);
    manifest = await response.json();
    assert.equal(manifest.pageCount, 1);
    assert.equal(manifest.protocolVersion, 1);
    assert.match(manifest.revision, /^[a-f0-9]{64}$/);
    assert.match(manifest.viewKey, /^[a-f0-9]{64}$/);
    assert.deepEqual(manifest.remaining, { items: 0, todos: 0 });
    assert.equal(manifest.truncated, false);
    etag = response.headers.get("etag");
    assert.equal(etag, `"${manifest.revision}"`);
    assert.equal(response.headers.get("x-page-count"), "1");
    assert.equal(response.headers.get("x-page-protocol"), "device-pages-v1");
    assert.deepEqual(await (await request(manifestPath, deviceHeaders)).json(), manifest);
    assert.deepEqual(await (await request("/api/device/pages", deviceHeaders)).json(), manifest);
    const unchanged = await request(manifestPath, { ...deviceHeaders, "If-None-Match": etag });
    assert.equal(unchanged.status, 304);
    assert.equal(await unchanged.text(), "");
    const devices = await (await request("/api/devices", userHeaders)).json();
    assert.equal(devices.devices.find((device) => device.serial === "test-1.1.3-f53").lastSeenAt, null);
  });

  await t.test("page bounds and revision errors do not fall through to user authentication", async () => {
    assert.equal((await request("/api/device/pages?panel=unknown", deviceHeaders)).status, 400);
    assert.equal((await request(`${manifestPath}&orientation=unknown`, deviceHeaders)).status, 400);
    for (const page of ["", "-1", "0.5", "abc"]) {
      const response = await request(`${framePath}&paging=1&page=${page}&revision=${manifest.revision}`, deviceHeaders);
      assert.equal(response.status, 400);
      assert.equal((await response.json()).code, "device_page_invalid");
    }
    assert.equal((await request(`${framePath}&paging=1&page=1&revision=${manifest.revision}`, deviceHeaders)).status, 416);
    const missing = await request(`${framePath}&paging=1&page=0`, deviceHeaders);
    assert.equal(missing.status, 400);
    assert.equal((await missing.json()).code, "device_page_revision_required");
    const stale = await request(`${framePath}&paging=1&page=0&revision=${"0".repeat(64)}`, deviceHeaders);
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).code, "device_page_revision_changed");
  });

  await t.test("paged F53 frames match legacy bytes and record first synchronization", async () => {
    const response = await request(`${framePath}&paging=1&page=0&revision=${manifest.revision}`, deviceHeaders);
    assert.equal(response.status, 200);
    const frame = Buffer.from(await response.arrayBuffer());
    assert.equal(frame.length, 96000);
    assert.equal(response.headers.get("content-length"), "96000");
    assert.equal(response.headers.get("x-frame-format"), "2bpp-bwyr");
    assert.equal(response.headers.get("x-page-index"), "0");
    assert.equal(response.headers.get("x-page-count"), "1");
    assert.equal(response.headers.get("x-page-revision"), manifest.revision);
    assert.equal(response.headers.get("x-page-view-key"), manifest.viewKey);
    const legacy = await request(framePath, deviceHeaders);
    assert.equal(legacy.status, 200);
    assert.deepEqual(Buffer.from(await legacy.arrayBuffer()), frame);
    const cachedHeaders = { ...deviceHeaders, "If-None-Match": legacy.headers.get("etag") };
    assert.equal((await request(framePath, cachedHeaders)).status, 304);
    assert.equal((await request(`${framePath}&paging=1&page=0&revision=${manifest.revision}`, cachedHeaders)).status, 200);
    const png = await request(`/api/device/frame.png?panel=gdem075f53&paging=1&page=0&revision=${manifest.revision}`, deviceHeaders);
    assert.equal(png.status, 200);
    const pngBytes = Buffer.from(await png.arrayBuffer());
    const metadata = await sharp(pngBytes).metadata();
    assert.equal(metadata.width, 480);
    assert.equal(metadata.height, 800);
    if (process.env.DEVICE_PAGE_TEST_ARTIFACT_DIR) {
      await fs.mkdir(process.env.DEVICE_PAGE_TEST_ARTIFACT_DIR, { recursive: true });
      await fs.writeFile(path.join(process.env.DEVICE_PAGE_TEST_ARTIFACT_DIR, "f53-page.png"), pngBytes);
      await fs.writeFile(path.join(process.env.DEVICE_PAGE_TEST_ARTIFACT_DIR, "f53-page.bin"), frame);
    }
    const devices = await (await request("/api/devices", userHeaders)).json();
    assert.ok(devices.devices.find((device) => device.serial === "test-1.1.3-f53").lastSeenAt);
  });

  await t.test("content changes invalidate revisions while overflow still returns one page", async () => {
    for (let index = 0; index < 6; index += 1) {
      const created = await post("/api/foods", {
        name: `分页兼容测试物品 ${index}`, expiresOn: addDays(localDateKey("Asia/Shanghai"), 10)
      }, userHeaders);
      assert.equal(created.status, 201);
    }
    const response = await request(manifestPath, { ...deviceHeaders, "If-None-Match": etag });
    assert.equal(response.status, 200);
    const updated = await response.json();
    assert.equal(updated.pageCount, 1);
    assert.deepEqual(updated.remaining, { items: 2, todos: 0 });
    assert.equal(updated.truncated, true);
    assert.equal(updated.viewKey, manifest.viewKey);
    assert.notEqual(updated.revision, manifest.revision);
    assert.equal((await request(`${framePath}&paging=1&page=0&revision=${manifest.revision}`, deviceHeaders)).status, 409);
    manifest = updated;
  });

  await t.test("tri-color landscape frames keep their native size and distinct view identity", async () => {
    const query = "panel=gdey042z98&orientation=landscape";
    const response = await request(`/api/device/pages?${query}`, deviceHeaders);
    assert.equal(response.status, 200);
    const tri = await response.json();
    assert.equal(tri.pageCount, 1);
    assert.notEqual(tri.viewKey, manifest.viewKey);
    assert.deepEqual(tri.remaining, { items: 6, todos: 0 });
    const frame = await request(`/api/device/frame.bin?${query}&paging=1&page=0&revision=${tri.revision}`, deviceHeaders);
    assert.equal(frame.status, 200);
    assert.equal(frame.headers.get("x-frame-format"), "dual-1bpp-bwr");
    assert.equal((await frame.arrayBuffer()).byteLength, 30000);
  });

  await t.test("empty households have their own page identity and cannot use another household's revision", async () => {
    const registered = await post("/api/auth/register", {
      email: "device-pages-test@example.com", password: "test-only-password", displayName: "测试家庭"
    });
    assert.equal(registered.status, 201);
    const otherUser = { Cookie: registered.headers.get("set-cookie").split(";")[0] };
    const otherDevice = await pair("test-other-household", otherUser);
    const response = await request(manifestPath, otherDevice);
    assert.equal(response.status, 200);
    const empty = await response.json();
    assert.equal(empty.pageCount, 1);
    assert.equal(empty.truncated, false);
    assert.deepEqual(empty.remaining, { items: 0, todos: 0 });
    assert.notEqual(empty.viewKey, manifest.viewKey);
    assert.notEqual(empty.revision, manifest.revision);
    assert.equal((await request(`${framePath}&paging=1&page=0&revision=${manifest.revision}`, otherDevice)).status, 409);
  });
});
