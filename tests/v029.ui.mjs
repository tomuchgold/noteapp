/**
 * v0.29.0 验证：
 *  1. 相对路径媒体支持 ../ 上级引用（路径归一化，编辑器/预览均不裂图）
 *  2. 生图偏好可编辑（增/删/改，持久化）+ 生图对话框全屏
 *  3. 右键弹出菜单始终完整出现在视口内（文件夹树 / 编辑器 AI 菜单 / 标签右键）
 */
import { chromium } from "/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs";
import { createServer } from "vite";

const results = [];
const check = (name, cond, extra = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) process.exitCode = 1;
};

const server = await createServer({ root: "/workspace/notepp", server: { port: 5249 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 940 } })).newPage();

await page.addInitScript(() => {
  window.__FS__ = {
    "/demo/a.txt": { content: "第一行\n第二行\n", mtime: 1 },
    "/demo/media/pic.png": { content: "PNGDATA", mtime: 1 },
    "/pic.png": { content: "PNGDATA2", mtime: 1 },
  };
  window.__openCalls = [];
  window.__convCalls = [];
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => cb,
    convertFileSrc: (p) => {
      window.__convCalls.push(p);
      return "asset://localhost/" + encodeURIComponent(p);
    },
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
        const f = window.__FS__[args.path];
        if (f) f.content = args.req.content;
        return Promise.resolve(null);
      }
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
      if (cmd === "open_path_default") { window.__openCalls.push(args.path); return Promise.resolve(null); }
      if (cmd === "ai_image") {
        return new Promise((res) => setTimeout(() => res({ urls: ["data:image/png;base64,AA"], model: "img-x" }), 300));
      }
      if (cmd === "save_image_b64") return Promise.resolve("media/ai-1.png");
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
    localStorage.setItem(
      "notepp.ai",
      JSON.stringify({ active: "deepseek", providers: { deepseek: { apiKey: "sk-t", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", imgModel: "img-x" } } })
    );
  });
});

await page.goto("http://localhost:5249/", { waitUntil: "networkidle" });
await page.waitForTimeout(900);

// 打开 a.txt（树中点击）
await page.locator(".tree-item", { hasText: "a.txt" }).first().click();
await page.waitForTimeout(500);

const inViewport = (sel) => page.locator(sel).first().evaluate((el) => {
  const r = el.getBoundingClientRect();
  return r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth - 1 && r.bottom <= window.innerHeight - 1 ? `${Math.round(r.right)}x${Math.round(r.bottom)}` : `OUT r=${Math.round(r.right)},b=${Math.round(r.bottom)},vw=${window.innerWidth},vh=${window.innerHeight}`;
});

// ---------- 1. ../ 相对引用媒体正常显示 ----------
const editor = page.locator(".cm-content").first();
await editor.click();
await page.keyboard.press("Control+End");
await page.keyboard.type("\n![测试](../pic.png)");
await page.keyboard.press("Control+Home");
await page.waitForTimeout(400);
const imgSrc = await page.locator(".cm-content .cm-media-img img").first().getAttribute("src");
check("编辑器渲染上级目录图片", !!imgSrc && imgSrc.includes("pic.png") && !imgSrc.includes(".."), `src=${imgSrc}`);
const convCalls = await page.evaluate(() => window.__convCalls);
check("路径归一化（无 .. 段）", (convCalls ?? []).some((p) => p === "/pic.png"), JSON.stringify(convCalls));
// 预览面板同样解析
await page.locator(".menubar button", { hasText: "预览" }).first().click();
await page.waitForTimeout(400);
const pvSrc = await page.locator(".preview-side .markdown-body img").first().getAttribute("src");
check("贴边预览渲染上级目录图片", !!pvSrc && decodeURIComponent(pvSrc).includes("/pic.png") && !decodeURIComponent(pvSrc).includes(".."), `src=${pvSrc}`);
await page.locator(".preview-side .preview-actions button", { hasText: "关闭" }).click();
await page.waitForTimeout(200);

// ---------- 2. 右键菜单视口钳制 ----------
// 文件夹树：在树底部空白处右键
await page.locator(".folder-tree").first().click({ button: "right", position: { x: 80, y: 800 } }).catch(async () => {
  await page.locator(".sidebar").first().click({ button: "right", position: { x: 80, y: 800 } });
});
await page.waitForTimeout(300);
if ((await page.locator(".folder-context-menu").count()) === 1) {
  check("文件夹树菜单在视口内", (await inViewport(".folder-context-menu")) !== "OUT" && !(await inViewport(".folder-context-menu")).startsWith("OUT"));
  await page.keyboard.press("Escape").catch(() => {});
  await page.mouse.click(700, 300);
} else {
  check("文件夹树菜单在视口内", false, "菜单未出现");
}
await page.waitForTimeout(200);
// 编辑器 AI 菜单：编辑器底部右键
await page.locator(".cm-content").first().click({ button: "right", position: { x: 200, y: 700 } });
await page.waitForTimeout(300);
if ((await page.locator(".ai-menu").count()) === 1) {
  check("AI 菜单在视口内", !(await inViewport(".ai-menu")).startsWith("OUT"), await inViewport(".ai-menu"));
  await page.mouse.click(700, 300);
} else {
  check("AI 菜单在视口内", false, "菜单未出现");
}
await page.waitForTimeout(200);
// 标签右键
await page.locator(".tab").first().click({ button: "right" });
await page.waitForTimeout(300);
if ((await page.locator("#tab-context-menu").isVisible()) === true) {
  check("标签右键菜单在视口内", !(await inViewport("#tab-context-menu")).startsWith("OUT"), await inViewport("#tab-context-menu"));
  await page.mouse.click(700, 300);
} else {
  check("标签右键菜单在视口内", false, "菜单未出现");
}

// ---------- 3. 生图对话框：全屏 + 偏好可编辑 ----------
await page.locator(".menubar button", { hasText: "生图" }).first().click();
await page.waitForTimeout(500);
check("默认 4 个偏好 chip", (await page.locator(".img-pref-chip").count()) === 4);
// 全屏切换
await page.locator(".img-dialog .head-actions .icon-btn").first().click();
await page.waitForTimeout(200);
check("对话框全屏类生效", (await page.locator(".modal.img-dialog.full").count()) === 1);
await page.locator(".img-dialog .head-actions .icon-btn").first().click();
await page.waitForTimeout(200);
check("退出对话框全屏", (await page.locator(".modal.img-dialog.full").count()) === 0);
// 编辑偏好：增加一条
await page.locator(".img-prefs-edit").click();
await page.waitForTimeout(200);
await page.locator(".pref-add-btn").click();
await page.waitForTimeout(200);
const rows = page.locator(".img-pref-row");
check("编辑模式出现偏好行", (await rows.count()) === 5);
await rows.nth(4).locator(".pref-emoji").fill("🌙");
await rows.nth(4).locator(".pref-label").fill("夜景氛围");
await rows.nth(4).locator(".pref-add").fill("夜晚氛围，霓虹灯光");
await page.locator(".img-prefs-edit").click(); // 完成
await page.waitForTimeout(200);
check("新增偏好出现在 chips", (await page.locator(".img-pref-chip").count()) === 5);
await page.locator(".img-pref-chip", { hasText: "夜景氛围" }).click();
await page.waitForTimeout(150);
check("点击新偏好追加到提示词", (await page.locator(".img-dialog textarea").inputValue()).includes("霓虹灯光"));
// 删除：移除第一条
await page.locator(".img-prefs-edit").click();
await page.waitForTimeout(150);
await page.locator(".img-pref-row .pref-del").first().click();
await page.locator(".img-prefs-edit").click(); // 完成
await page.waitForTimeout(150);
check("删除偏好后剩 4 条", (await page.locator(".img-pref-chip").count()) === 4);
// 持久化：关窗重开后仍为 4 条
await page.locator(".img-dialog .icon-btn[title='关闭']").click();
await page.waitForTimeout(200);
await page.locator(".menubar button", { hasText: "生图" }).first().click();
await page.waitForTimeout(300);
check("偏好编辑持久化", (await page.locator(".img-pref-chip").count()) === 4);

console.log(`\n===== v029: ${results.filter((r) => r.ok).length}/${results.length} PASS =====`);
await browser.close();
await server.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
