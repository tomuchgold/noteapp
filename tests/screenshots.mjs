import { chromium } from "/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs";
import { createServer } from "vite";

const server = await createServer({ root: process.cwd(), server: { port: 5199 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();

await page.addInitScript(() => {
  const handlers = {};
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => cb,
    invoke: (cmd, args) => {
      if (cmd === "plugin:event|listen") return Promise.resolve(1);
      if (cmd === "read_text_file") return Promise.resolve({ content: "", encoding: "UTF-8", bom: false, eol: "LF", size: 0 });
      if (cmd === "file_info") return Promise.resolve({ size: 10 });
      return Promise.resolve(null);
    },
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
    unregisterListener: () => {},
    registerListener: () => {},
  };
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
});
await page.goto("http://localhost:5199/", { waitUntil: "networkidle" });
await page.waitForSelector(".cm-content");

// 打开设置面板（主题色卡）
await page.locator(".menubar button", { hasText: "设置" }).click();
await page.waitForSelector(".theme-grid");
await page.screenshot({ path: "docs/theme-settings.png" });
await page.locator(".modal-actions button", { hasText: "完成" }).click();

// 输入文本 → 选区 → 右键标注菜单
await page.locator(".cm-content").click();
await page.keyboard.type("NotePP v0.9 支持段落高亮与标注。\n选中文字可以高亮、划线、写标注信息，也可以直接调用 AI。");
const line = page.locator(".cm-line", { hasText: "选中文字" }).first();
const box = await line.boundingBox();
await page.mouse.move(box.x + 10, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + 220, box.y + box.height / 2, { steps: 6 });
await page.mouse.up();
await page.locator(".cm-content").click({ button: "right", position: { x: box.x - 200, y: box.y - 40 } });
await page.waitForSelector(".ai-menu");
await page.screenshot({ path: "docs/annotations-menu.png" });

await browser.close();
await server.close();
console.log("screenshots saved");
process.exit(0);
