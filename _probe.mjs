import { chromium } from "/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs";
import { createServer } from "vite";
const server = await createServer({ root: "/workspace/notepp", server: { port: 5216 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 940 } })).newPage();
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("CONSOLE", m.type(), m.text().slice(0, 200)); });
page.on("pageerror", (e) => console.log("PAGEERROR", String(e).slice(0, 300)));
await page.addInitScript(() => {
  window.__DIRS__ = { "/demo": [{ name: "a.txt", path: "/demo/a.txt", is_dir: false }] };
  window.__FS__ = { "/demo/a.txt": { content: "AAA\n", mtime: 1 }, "/demo/extra.txt": { content: "EXTRA\n", mtime: 3 } };
  window.__OPENED__ = ["/demo/extra.txt"];
  window.__CALLS__ = [];
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => cb,
    invoke: (cmd, args) => {
      window.__CALLS__.push([cmd, JSON.stringify(args ?? {})]);
      if (cmd === "opened_urls") { const o = window.__OPENED__; window.__OPENED__ = []; return Promise.resolve(o); }
      if (cmd === "path_is_dir") return Promise.resolve(!!window.__DIRS__[args.path]);
      if (cmd === "list_dir") { const es = window.__DIRS__[args.path]; return es ? Promise.resolve(es) : Promise.reject("no dir"); }
      if (cmd === "read_text_file") { const f = window.__FS__[args.path]; return f ? Promise.resolve({ content: f.content, encoding: "UTF-8", bom: false, eol: "LF", size: f.content.length }) : Promise.reject("nf"); }
      if (cmd === "file_info") { const f = window.__FS__[args.path]; return f ? Promise.resolve({ size: f.content.length, mtime: f.mtime }) : Promise.reject("nf"); }
      return Promise.resolve(null);
    },
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
    unregisterListener: () => {}, registerListener: () => {},
  };
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
});
await page.goto("http://localhost:5216/", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
console.log("CALLS:", JSON.stringify(await page.evaluate(() => window.__CALLS__), null, 0));
console.log("TABS:", await page.locator(".tabbar").innerText().catch(() => "NO .tabbar"));
const cls = await page.evaluate(() => Array.from(document.querySelectorAll("[class*=tab]")).map((e) => e.className).slice(0, 8));
console.log("TAB-CLASSES:", JSON.stringify(cls));
await browser.close(); await server.close();
