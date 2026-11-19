/**
 * v0.11.6 UI 验证：
 *  1. 查找为可拖动浮窗，位置持久化
 *  2. 所有标签查找：命中另一个标签 → 点击结果切换标签
 *  3. 底部结果面板仍在；菜单栏「我的网站」调用系统浏览器
 */
import { chromium } from "/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs";
import { createServer } from "vite";

const results = [];
const check = (name, cond, extra = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) process.exitCode = 1;
};

const server = await createServer({ root: "/workspace/notepp", server: { port: 5204 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();

await page.addInitScript(() => {
  window.__FS__ = {
    "/demo/a.txt": { content: "alpha apple\nline two\n", mtime: 100 },
    "/demo/b.txt": { content: "beta banana\ntarget line\n", mtime: 100 },
  };
  window.__pick = 0;
  window.__opened = [];
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => cb,
    invoke: (cmd, args) => {
      if (cmd === "plugin:dialog|open") {
        window.__pick++;
        return Promise.resolve(window.__pick === 1 ? ["/demo/a.txt"] : ["/demo/b.txt"]);
      }
      if (cmd === "plugin:opener|open_url") {
        window.__opened.push(args?.url ?? args?.path ?? args);
        return Promise.resolve(null);
      }
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
      if (cmd === "list_dir") return Promise.resolve([]);
      return Promise.resolve(null);
    },
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
    unregisterListener: () => {},
    registerListener: () => {},
  };
  window.matchMedia =
    window.matchMedia ||
    (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
});
await page.goto("http://localhost:5204/", { waitUntil: "networkidle" });
await page.waitForSelector(".cm-content");

// ---------- 1. 打开两个标签 ----------
await page.keyboard.press("Control+o");
await page.waitForTimeout(300);
await page.keyboard.press("Control+o");
await page.waitForTimeout(300);
const names = await page.locator(".tabbar .tab-name").allInnerTexts();
check("两个文件标签已打开", names.includes("a.txt") && names.includes("b.txt"), names.join(","));

// ---------- 2. 查找浮窗拖动 ----------
await page.keyboard.press("Control+f");
await page.waitForSelector(".findbar");
const posBefore = await page.evaluate(() => {
  const el = document.querySelector(".findbar");
  return { x: parseInt(el.style.left), y: parseInt(el.style.top) };
});
const drag = page.locator(".findbar-drag");
const db = await drag.boundingBox();
await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2);
await page.mouse.down();
await page.mouse.move(db.x + db.width / 2 + 90, db.y + db.height / 2 + 50, { steps: 6 });
await page.mouse.up();
const posAfter = await page.evaluate(() => {
  const el = document.querySelector(".findbar");
  return { x: parseInt(el.style.left), y: parseInt(el.style.top) };
});
check("查找窗口可拖动", posAfter.x > posBefore.x + 60 && posAfter.y > posBefore.y + 30,
  `${JSON.stringify(posBefore)} → ${JSON.stringify(posAfter)}`);
const persisted = await page.evaluate(() => localStorage.getItem("notepp.find.pos"));
check("窗口位置已持久化", !!persisted && JSON.parse(persisted).x === posAfter.x, persisted);

// ---------- 3. 所有标签查找 ----------
await page.locator(".findbar-tabs button", { hasText: "所有标签" }).click();
await page.locator('.findbar [data-role="query"]').fill("banana");
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
const groups = await page.locator(".findbar-group-head").allInnerTexts();
check("所有标签找到 b.txt", groups.some((g) => g.includes("b.txt")), groups.join(","));
const hit = page.locator(".findbar-hit").first();
check("命中行内容显示", (await hit.innerText()).includes("banana"));
await hit.click();
await page.waitForTimeout(400);
const active = await page.locator(".tabbar .tab.active .tab-name, .tabbar .on .tab-name").first().innerText().catch(() => "");
check("点击结果切到 b.txt 标签", active.includes("b.txt") || (await page.locator(".cm-content").innerText()).includes("banana"), active);

// ---------- 4. 底部结果面板不变 ----------
await page.locator(".findbar-tabs button", { hasText: "当前文件" }).click();
await page.locator(".findbar-btn", { hasText: "结果面板" }).click();
await page.waitForTimeout(200);
check("底部结果面板仍可用", (await page.locator(".search-results").count()) === 1);

// ---------- 5. 网站入口 ----------
await page.locator('.menubar button', { hasText: "我的网站" }).click();
await page.waitForTimeout(200);
const opened = await page.evaluate(() => window.__opened);
check("我的网站打开正确网址", opened.some((u) => String(u).includes("notepp.ambook.vip")), JSON.stringify(opened));

await page.screenshot({ path: "/workspace/notepp/docs/find-floating.png" });
await browser.close();
await server.close();
const pass = results.filter((r) => r.ok).length;
console.log(`\n${pass}/${results.length} 通过`);
