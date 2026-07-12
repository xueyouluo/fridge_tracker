"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { renderMarkdown } = require("../public/markdown");

test("agent markdown renders lists, emphasis and tables", () => {
  const html = renderMarkdown("你有 **2 项**：\n\n- 牛奶\n- 苹果\n\n| 食材 | 到期日 |\n|---|---|\n| 牛奶 | 2026-07-12 |");
  assert.match(html, /<strong>2 项<\/strong>/);
  assert.match(html, /<ul>\s*<li>牛奶<\/li>\s*<li>苹果<\/li>\s*<\/ul>/);
  assert.match(html, /<table>\s*<thead>/);
  assert.match(html, /<td>牛奶<\/td>\s*<td>2026-07-12<\/td>/);
});

test("agent markdown renders the short GFM table delimiter returned by the model", () => {
  const html = renderMarkdown("当前过期的食品如下：\n\n| ID | 名称 | 到期日 | 状态 |\n|:--:|:----:|:------:|:----:|\n| 14 | 🥛 牛奶 | 2026-07-08 | **已过期（-3天）** |");
  assert.match(html, /<div class="markdown-table-wrap"><table>/);
  assert.match(html, /<th style="text-align:center">ID<\/th>/);
  assert.match(html, /<td style="text-align:center">14<\/td>/);
  assert.match(html, /<strong>已过期（-3天）<\/strong>/);
});

test("agent markdown escapes HTML and rejects unsafe link schemes", () => {
  const html = renderMarkdown('<img src=x onerror=alert(1)> [危险](javascript:alert(1)) [安全](https://example.com)');
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /href="https:\/\/example.com"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noreferrer noopener"/);
});
