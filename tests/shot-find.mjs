import { chromium } from "/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs";
import { createServer } from "vite";
const server = await createServer({ root: process.cwd(), server: { port: 5189 } });
await server.listen();
const b = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage();
await p.addInitScript(() => {
  window.__TAURI_INTERNALS__ = { transformCallback: (cb)=>cb, invoke: () => Promise.resolve(null),
    metadata:{currentWindow:{label:"main"},currentWebview:{label:"main",windowLabel:"main"}}, unregisterListener(){}, registerListener(){} };
  window.matchMedia = window.matchMedia || (()=>({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}}));
});
await p.goto("http://localhost:5189/", { waitUntil: "networkidle" });
await p.waitForSelector(".cm-content");
await p.locator(".cm-content").click();
await p.keyboard.type(`# NotePP 使用说明

NotePP 是一个轻量编辑器。查找替换是核心功能之一。
按下 Ctrl+F 可以查找，Ctrl+H 打开替换，Shift+F3 反向查找。

| 功能 | 快捷键 |
| --- | --- |
| 查找 | Ctrl+F |
| 替换 | Ctrl+H |
| 拆分 | Ctrl+D |

查找支持区分大小写、全字匹配和正则表达式。`);
await p.keyboard.press("Control+f");
await p.waitForSelector(".findbar");
await p.locator(".findbar-input").first().fill("查找");
await p.waitForTimeout(400);
await p.screenshot({ path: "docs/findbar.png" });
await b.close(); await server.close(); process.exit(0);
