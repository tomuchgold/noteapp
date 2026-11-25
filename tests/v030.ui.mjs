/**
 * v0.30.0 验证：
 *  1. 导出 HTML 内嵌媒体（所见即所得自包含 HTML：asset 引用 → base64 data URL）
 *  2. 预览为分屏不遮盖编辑区（editor-area 让位）
 *  3. 点击文件夹树媒体文件 → 新标签媒体查看器（只读引用渲染）
 */
import { chromium } from "/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs";
import { createServer } from "vite";

const results = [];
const check = (name, cond, extra = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) process.exitCode = 1;
};

const server = await createServer({ root: "/workspace/notepp", server: { port: 5251 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 940 } })).newPage();

await page.addInitScript(() => {
  window.__FS__ = {
    "/demo/a.txt": { content: "第一行\n![引用](media/pic.png)\n第二行\n", mtime: 1 },
    "/demo/media/pic.png": { content: "PNGDATA", mtime: 1 },
  };
  window.__exports = [];
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => cb,
    convertFileSrc: (p) => "asset://localhost/" + encodeURIComponent(p),
    invoke: (cmd, args) => {
      if (cmd === "opened_urls") return Promise.resolve([]);
      if (cmd === "read_text_file") {
        const f = window.__FS__[args.path];
        if (!f) return Promise.reject("not found");
        return Promise.resolve({ content: f.content, encoding: "UTF-8", bom: false, eol: "LF", size: f.content.length });
      }
      if (cmd === "file_info") {
        const f = window.__FS__[args.path];
        if (!f) return Promise.reject("not found");
        return Promise.resolve({ size: f.content.length, mtime: f.mtime });
      }
      if (cmd === "write_text_file") {
        window.__exports.push({ path: args.path, content: args.req.content });
        const f = window.__FS__[args.path];
        if (f) f.content = args.req.content;
        return Promise.resolve(null);
      }
      if (cmd === "read_file_base64") {
        const f = window.__FS__[args.path];
        if (!f) return Promise.reject("not found");
        return Promise.resolve(window.btoa(unescape(encodeURIComponent(f.content))));
      }
      if (cmd === "plugin:dialog|save") return Promise.resolve("/demo/export.html");
      if (cmd === "list_dir") {
        if (args.path === "/demo") return Promise.resolve([
          { name: "a.txt", path: "/demo/a.txt", is_dir: false },
          { name: "media", path: "/demo/media", is_dir: true },
        ]);
        if (args.path === "/demo/media") return Promise.resolve([
          { name: "pic.png", path: "/demo/media/pic.png", is_dir: false },
        ]);
        return Promise.resolve([]);
      }
      if (cmd === "path_is_dir") return Promise.resolve(args.path === "/demo" || args.path === "/demo/media");
      if (cmd === "plugin:event|listen") return Promise.resolve(1);
      return Promise.resolve(null);
    },
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
    unregisterListener: () => {},
    registerListener: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  window.addEventListener("DOMContentLoaded", () => {
    localStorage.setItem("notepp.library", JSON.stringify([
      { path: "/demo/a.txt", name: "a.txt", category: null, favorite: false, lastOpened: 2, preview: "" },
    ]));
    localStorage.setItem("notepp.folder", "/demo");
  });
});

await page.goto("http://localhost:5251/", { waitUntil: "networkidle" });
await page.waitForTimeout(900);
await page.locator(".tree-item", { hasText: "a.txt" }).first().click();
await page.waitForTimeout(400);

// ---------- 2. 预览分屏不遮盖 ----------
await page.locator(".menubar button", { hasText: "预览" }).first().click();
await page.waitForTimeout(400);
check("预览面板打开", (await page.locator(".preview-side").count()) === 1);
const layout = await page.evaluate(() => {
  const ed = document.querySelector(".editor-area")?.getBoundingClientRect();
  const pv = document.querySelector(".preview-side")?.getBoundingClientRect();
  const cls = document.querySelector(".editor-area")?.className ?? "";
  return { cls, edRight: ed ? Math.round(ed.right) : -1, pvLeft: pv ? Math.round(pv.left) : -1, vw: window.innerWidth };
});
check("编辑区让位（不遮盖）", layout.cls.includes("preview-open") && layout.pvLeft >= layout.edRight - 2, JSON.stringify(layout));
const clickOk = await page.evaluate(() => {
  const cm = document.querySelector(".editor-area .cm-content");
  if (!cm) return false;
  const r = cm.getBoundingClientRect();
  return r.width > 100; // 编辑器未被压没
});
check("编辑器仍可正常显示", clickOk);
// 全屏时编辑区不要求让位（预览盖全屏，属预期）
await page.locator(".preview-side .preview-actions button", { hasText: "全屏" }).click();
await page.waitForTimeout(200);
await page.locator(".preview-side .preview-actions button", { hasText: "还原" }).click();
await page.waitForTimeout(200);
await page.locator(".preview-side .preview-actions button", { hasText: "关闭" }).click();
await page.waitForTimeout(200);
check("预览关闭后编辑区恢复", !(await page.evaluate(() => document.querySelector(".editor-area")?.className)).includes?.("preview-open") ?? true);

// ---------- 1. 导出 HTML 内嵌媒体 ----------
await page.locator(".menubar button", { hasText: "预览" }).first().click();
await page.waitForTimeout(400);
await page.locator(".preview-side .preview-actions button", { hasText: "导出 HTML" }).click();
await page.waitForTimeout(600);
const exp = (await page.evaluate(() => window.__exports))[0];
check("导出 HTML 已写出", !!exp, exp ? exp.path : "无");
check("导出 HTML 内嵌媒体为 base64", !!exp && exp.content.includes("data:image/png;base64,UE5HREFUQQ=="), exp ? `len=${exp.content.length}` : "");
check("导出 HTML 无 asset 协议残留", !!exp && !exp.content.includes("asset://"));
await page.locator(".preview-side .preview-actions button", { hasText: "关闭" }).click();
await page.waitForTimeout(200);

// ---------- 3. 媒体新标签查看器 ----------
await page.locator(".tree-item", { hasText: "media" }).first().click();
await page.waitForTimeout(400);
await page.locator(".tree-item", { hasText: "pic.png" }).first().click();
await page.waitForTimeout(500);
check("媒体标签已打开", (await page.locator(".tab", { hasText: "pic.png" }).count()) === 1);
check("媒体查看器渲染", (await page.locator(".media-viewer .mv-img").count()) === 1);
const mvSrc = await page.locator(".media-viewer .mv-img").getAttribute("src");
check("查看器引用原文件", !!mvSrc && decodeURIComponent(mvSrc).includes("/demo/media/pic.png"), `src=${mvSrc}`);
// 切回 a.txt 不受影响
await page.locator(".tab", { hasText: "a.txt" }).first().click();
await page.waitForTimeout(300);
check("文本标签可正常切回", (await page.locator(".cm-content").count()) === 1);
// 再点媒体 → 激活已有标签（不重复开）
await page.locator(".tree-item", { hasText: "pic.png" }).first().click();
await page.waitForTimeout(300);
check("重复点击不重复开标签", (await page.locator(".tab", { hasText: "pic.png" }).count()) === 1);

console.log(`\n===== v030: ${results.filter((r) => r.ok).length}/${results.length} PASS =====`);
await browser.close();
await server.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
