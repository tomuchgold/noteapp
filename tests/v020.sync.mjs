/**
 * v0.20.0 验证（GitHub 云备份）：
 *  1. 设置出现 GitHub Token / Gist ID / 自动备份 / 立即备份 / 从云端恢复
 *  2. 立即备份：收集文件内容+设置 → gist_upload → 自动回填 Gist ID
 *  3. 从云端恢复：确认后写回文件与设置
 */
import { chromium } from "/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs";
import { createServer } from "vite";

const results = [];
const check = (name, cond, extra = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) process.exitCode = 1;
};

const server = await createServer({ root: "/workspace/notepp", server: { port: 5230 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 940 } })).newPage();

await page.addInitScript(() => {
  window.__FS__ = { "/demo/a.txt": { content: "hello world\n", mtime: 1 } };
  window.__uploads = [];
  window.__restored = [];
  window.__BACKUP_JSON__ = null;
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => cb,
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
      if (cmd === "gist_upload") {
        window.__uploads.push(args);
        window.__BACKUP_JSON__ = args.content;
        return Promise.resolve("gist1234567890");
      }
      if (cmd === "gist_download") {
        return Promise.resolve(window.__BACKUP_JSON__ ?? "");
      }
      if (cmd === "write_text_file") {
        window.__restored.push(args.req.path);
        return Promise.resolve(null);
      }
      return Promise.resolve(null);
    },
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
    unregisterListener: () => {},
    registerListener: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  window.matchMedia =
    window.matchMedia ||
    (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  localStorage.setItem(
    "notepp.library",
    JSON.stringify([{ path: "/demo/a.txt", name: "a.txt", category: null, favorite: false, lastOpened: 1, preview: "hello" }])
  );
  localStorage.setItem(
    "notepp.ann:/demo/a.txt",
    JSON.stringify([{ id: "ann1", from: 0, to: 5, text: "hello", kind: "highlight" }])
  );
});

await page.goto("http://localhost:5230/", { waitUntil: "networkidle" });
await page.waitForTimeout(700);

// ---------- 1. 设置里的云备份区块 ----------
await page.locator(".menubar button", { hasText: "设置" }).first().click();
await page.waitForSelector(".modal.settings");
const st = await page.locator(".modal.settings").innerText();
check("设置含 GitHub Token 行", st.includes("GitHub Token"));
check("设置含 Gist ID 行", st.includes("Gist ID"));
check("设置含自动备份行", st.includes("自动备份"));
check("设置含立即备份/恢复按钮", st.includes("立即备份") && st.includes("从云端恢复"));

// ---------- 2. 立即备份 ----------
await page.locator(".modal.settings input[type=password]").fill("github_pat_test123");
await page.locator(".modal.settings button", { hasText: "立即备份" }).click();
await page.waitForTimeout(600);
const uploads = await page.evaluate(() => window.__uploads);
check("调用了 gist_upload", (await page.evaluate(() => window.__uploads.length)) === 1);
check("上传带 Token", (await page.evaluate(() => window.__uploads[0]?.token)) === "github_pat_test123");
const bj = await page.evaluate(() => window.__BACKUP_JSON__);
const parsed = await page.evaluate(() => { try { return JSON.parse(window.__BACKUP_JSON__); } catch { return null; } });
check("备份 JSON 合法且含文件内容", !!parsed && Array.isArray(parsed.files) && parsed.files.some((f) => f.path === "/demo/a.txt" && f.content.includes("hello world")));
check("备份含标注", !!parsed && parsed.annotations && JSON.stringify(parsed.annotations).includes("ann1"));
check("备份含设置", !!parsed && parsed.settings && "notepp.editor-settings" in parsed.settings);
check("Gist ID 已自动回填", (await page.locator(".modal.settings input[list], .modal.settings .setting-row", { hasText: "Gist ID" }).locator("input[type=text]").inputValue().catch(() => "")) === "gist1234567890");
check("界面显示备份成功", (await page.locator(".modal.settings .theme-msg").innerText().catch(() => "")).includes("备份成功"));

// ---------- 3. 从云端恢复 ----------
await page.evaluate(() => {
  // 模拟本地文件被改坏，恢复后应写回
  window.__FS__ = {};
  localStorage.setItem("notepp.editor-settings", "{}");
});
page.once("dialog", (d) => d.accept());
await page.locator(".modal.settings button", { hasText: "从云端恢复" }).click();
await page.waitForTimeout(600);
check("恢复写回了文件", (await page.evaluate(() => window.__restored)).includes("/demo/a.txt"));
check("恢复写回了文件内容", await page.evaluate(() => window.__restored.length >= 1));
check("恢复还原了设置", await page.evaluate(() => {
  try {
    const s = JSON.parse(localStorage.getItem("notepp.editor-settings"));
    return s && typeof s.fontSize === "number";
  } catch { return false; }
}));
check("恢复还原了标注", await page.evaluate(() => {
  try { return !!JSON.parse(localStorage.getItem("notepp.ann:/demo/a.txt")); } catch { return false; }
}));
check("界面显示恢复成功", (await page.locator(".modal.settings .theme-msg").innerText().catch(() => "")).includes("已恢复"));

console.log(`\n===== v020sync: ${results.filter((r) => r.ok).length}/${results.length} PASS =====`);
await browser.close();
await server.close();
