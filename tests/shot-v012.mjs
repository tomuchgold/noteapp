/** v0.12.0 效果截图：亮色主题整体界面 + 放大的查找框 + 列编辑多选 */
import { chromium } from "/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs";
import { createServer } from "vite";

const server = await createServer({ root: "/workspace/notepp", server: { port: 5209 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const CN = "# 项目说明\n\n这是 **NotePP** 的 Markdown 示例，包含中文与 English 混排。\n\n- 主题覆盖整体界面\n- 界面字号可调\n- 查找框可拖出窗口\n\n甲公司乙丙丁\nhello 世界\n";
await page.addInitScript((cn) => {
  window.__FS__ = { "/demo/readme.md": { content: cn, mtime: 100 } };
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => cb,
    invoke: (cmd, args) => {
      if (cmd === "plugin:dialog|open") return Promise.resolve(["/demo/readme.md"]);
      if (cmd === "read_text_file") return Promise.resolve({ content: cn, encoding: "UTF-8", bom: false, eol: "LF", size: cn.length });
      if (cmd === "file_info") return Promise.resolve({ size: cn.length, mtime: 100 });
      if (cmd === "list_dir") return Promise.resolve([]);
      return Promise.resolve(null);
    },
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
    unregisterListener: () => {}, registerListener: () => {},
  };
  localStorage.setItem("notepp.editor-settings", JSON.stringify({
    fontSize: 16, zoom: 100, lineHeight: 1.6, tabSize: 4, wrap: true,
    showWhitespace: false, activeLine: true, paragraphHighlight: true,
    paraColor: "", theme: "light", uiScale: 115, findScale: 120,
  }));
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
}, CN);
await page.goto("http://localhost:5209/", { waitUntil: "networkidle" });
await page.waitForSelector(".cm-content");
await page.keyboard.press("Control+o");
await page.waitForTimeout(400);

// 截图1：亮色主题 + 放大界面
await page.screenshot({ path: "/workspace/notepp/docs/v012-light-ui.png" });

// 截图2：查找框放大并拖到右下
await page.keyboard.press("Control+f");
await page.waitForSelector(".findbar");
await page.locator('.findbar [data-role="query"]').fill("界面");
await page.waitForTimeout(300);
await page.evaluate(() => {
  const el = document.querySelector(".findbar");
  el.style.left = "760px";
  el.style.top = "360px";
});
await page.screenshot({ path: "/workspace/notepp/docs/v012-findbar.png" });

await browser.close();
await server.close();
console.log("screenshots saved");
