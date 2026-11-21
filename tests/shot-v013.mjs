import { chromium } from "/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs";
import { createServer } from "vite";

const server = await createServer({ root: "/workspace/notepp", server: { port: 5213 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 })).newPage();
const TEXT = "short line\n这是一行明显更长的内容文本，用于演示列编辑补空格\n\nend line\n查找关键词 界面 出现在这里\n另一个 界面 命中行";
await page.addInitScript((txt) => {
  window.__FS__ = { "/demo/c.txt": { content: txt, mtime: 100 } };
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => cb,
    invoke: (cmd, args) => {
      if (cmd === "plugin:dialog|open") return Promise.resolve(["/demo/c.txt"]);
      if (cmd === "read_text_file") { const f = window.__FS__[args.path]; return f ? Promise.resolve({ content: f.content, encoding: "UTF-8", bom: false, eol: "LF", size: f.content.length }) : Promise.reject("nf"); }
      if (cmd === "file_info") { const f = window.__FS__[args.path]; return f ? Promise.resolve({ size: f.content.length, mtime: f.mtime }) : Promise.reject("nf"); }
      if (cmd === "list_dir") return Promise.resolve([]);
      return Promise.resolve(null);
    },
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
    unregisterListener: () => {}, registerListener: () => {},
  };
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} }));
}, TEXT);
await page.goto("http://localhost:5213/", { waitUntil: "networkidle" });
await page.waitForSelector(".cm-content");
await page.keyboard.press("Control+o");
await page.waitForTimeout(300);

// 1. 设置弹窗（emoji + tooltip）
await page.locator(".menubar button", { hasText: "设置" }).click();
await page.waitForSelector(".modal.settings");
await page.screenshot({ path: "/workspace/notepp/docs/v013-settings-emoji.png" });
await page.locator(".modal.settings .modal-actions button.primary", { hasText: "完成" }).click();
await page.waitForTimeout(100);

// 2. 搜索结果面板（增强后）
await page.keyboard.press("Control+f");
await page.waitForTimeout(200);
await page.locator('.findbar-input[data-role="query"]').fill("界面");
await page.waitForTimeout(200);
const toggle = page.locator('.findbar button[title*="结果面板"]').first();
if (await toggle.count()) await toggle.click();
await page.waitForTimeout(200);
await page.screenshot({ path: "/workspace/notepp/docs/v013-search-panel.png" });
await page.keyboard.press("Escape");
await page.waitForTimeout(100);

// 3. 宏管理弹窗（先造两个宏，然后刷新让组件读取到）
await page.evaluate(() => localStorage.setItem("notepp.saved-macros", JSON.stringify([
  { id: "m1", name: "插入版权声明", items: [{ type: "text", text: "Copyright © 2026 NotePP" }], createdAt: Date.now() },
  { id: "m2", name: "插入日期分隔线", items: [{ type: "text", text: "----------" }, { type: "cmd", cmd: "Enter" }], createdAt: Date.now() },
])));
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".cm-content");
await page.locator(".menubar button", { hasText: "宏管理" }).click();
await page.waitForSelector(".macro-modal");
await page.screenshot({ path: "/workspace/notepp/docs/v013-macro-dialog.png" });

await browser.close();
await server.close();
console.log("screenshots done");
