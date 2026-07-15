"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const serverDir = path.resolve(__dirname, "..");
const publicDir = path.join(serverDir, "public");

function pngDimensions(filename) {
  const image = fs.readFileSync(path.join(publicDir, filename));
  assert.deepEqual(image.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return {
    width: image.readUInt32BE(16),
    height: image.readUInt32BE(20)
  };
}

test("web app manifest launches XianZhi Tie in standalone mode", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(publicDir, "manifest.webmanifest"), "utf8"));

  assert.equal(manifest.name, "鲜知贴");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.theme_color, "#196849");
  assert.deepEqual(manifest.icons.map(({ sizes }) => sizes), ["192x192", "512x512"]);
});

test("page advertises iPhone web app metadata and install icons", () => {
  const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");

  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/);
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="鲜知贴">/);
  assert.match(html, /<link rel="apple-touch-icon" sizes="180x180" href="\/icons\/apple-touch-icon\.png">/);
  assert.deepEqual(pngDimensions("icons/apple-touch-icon.png"), { width: 180, height: 180 });
  assert.deepEqual(pngDimensions("icons/icon-192.png"), { width: 192, height: 192 });
  assert.deepEqual(pngDimensions("icons/icon-512.png"), { width: 512, height: 512 });
});

test("server exposes the manifest and PNG app icons", () => {
  const server = fs.readFileSync(path.join(serverDir, "src/server.js"), "utf8");

  assert.match(server, /url\.pathname === "\/manifest\.webmanifest"/);
  assert.match(server, /"application\/manifest\+json; charset=utf-8"/);
  assert.match(server, /url\.pathname === "\/icons\/apple-touch-icon\.png"/);
  assert.match(server, /url\.pathname === "\/icons\/icon-192\.png"/);
  assert.match(server, /url\.pathname === "\/icons\/icon-512\.png"/);
});
