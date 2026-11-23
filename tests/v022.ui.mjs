/**
 * v0.22.0 验证（菜单栏显示模式 + 溢出折叠「▼」）：
 *  1. 默认 emoji+文字：图标与文字都可见
 *  2. 设置切换「只显示 emoji」→ 文字隐藏；「只显示文字」→ 图标隐藏
 *  3. 宽窗口：无 ▼ 按钮
 *  4. 窄窗口（1000px）：按钮被收纳，出现 ▼；点开下拉可执行菜单项（宏管理）
 *  5. 下拉中有「🧭 菜单显示模式…」快捷入口
 */
import { chromium } from "/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs";
import { createServer } from "vite";

const results = [];
const check = (name, cond, extra = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) process.exitCode = 1;
};

const server = await createServer({ root: "/workspace/notepp", server: { port: 5231 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 940 } })).newPage();

await page.addInitScript(() => {
  window.__FS__ = { "/demo/a.txt": { content: "hello\n", mtime: 1 } };
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
});

await page.goto("http://localhost:5231/", { waitUntil: "networkidle" });
await page.waitForTimeout(700);

// ---------- 1. 默认 emoji+文字 ----------
const newBtn = page.locator(".menubar button", { hasText: "新建" }).first();
const icoVis = await newBtn.locator(".m-ico").evaluate((el) => getComputedStyle(el).display !== "none");
const txtVis = await newBtn.locator(".m-txt").evaluate((el) => getComputedStyle(el).display !== "none");
check("默认模式图标可见", icoVis);
check("默认模式文字可见", txtVis);

// ---------- 2. 显示模式切换 ----------
await page.locator(".menubar button", { hasText: "设置" }).first().click();
await page.waitForTimeout(300);
const row = page.locator(".modal.settings .setting-row", { hasText: "菜单显示" });
check("设置含「菜单显示」下拉", (await row.count()) === 1);
await row.locator("select").selectOption("emoji");
await page.waitForTimeout(200);
const txtHidden = await newBtn.locator(".m-txt").evaluate((el) => getComputedStyle(el).display === "none");
check("只显示 emoji：文字隐藏", txtHidden);
await row.locator("select").selectOption("text");
await page.waitForTimeout(200);
const icoHidden = await newBtn.locator(".m-ico").evaluate((el) => getComputedStyle(el).display === "none");
const txtShown = await newBtn.locator(".m-txt").evaluate((el) => getComputedStyle(el).display !== "none");
check("只显示文字：图标隐藏、文字可见", icoHidden && txtShown);
await row.locator("select").selectOption("both");
await page.waitForTimeout(200);
// 关闭设置
const doneBtn = page.locator(".modal.settings button", { hasText: "完成" });
if (await doneBtn.count()) await doneBtn.first().click().catch(() => {});
await page.keyboard.press("Escape");
await page.waitForTimeout(300);

// ---------- 3. 超宽窗口：无 ▼ ----------
await page.setViewportSize({ width: 2600, height: 900 });
await page.waitForTimeout(300);
check("2600px 超宽不溢出（无 ▼）", (await page.locator(".menubar-more").count()) === 0);
await page.setViewportSize({ width: 1600, height: 900 });
await page.waitForTimeout(300);

// ---------- 4. 窄窗口：出现 ▼，下拉可执行 ----------
await page.setViewportSize({ width: 1000, height: 900 });
await page.waitForTimeout(400);
check("1000px 出现 ▼ 收纳按钮", (await page.locator(".menubar-more").count()) === 1);
await page.locator(".menubar-more").click();
await page.waitForTimeout(250);
const ov = page.locator(".menubar-overflow");
check("▼ 下拉已展开", (await ov.count()) === 1);
check("下拉含「宏管理」", (await ov.locator("button", { hasText: "宏管理" }).count()) === 1);
check("下拉含「🧭 菜单显示模式…」", (await ov.locator("button", { hasText: "菜单显示模式" }).count()) === 1);
await ov.locator("button", { hasText: "宏管理" }).click();
await page.waitForTimeout(300);
check("下拉点击宏管理 → 弹出宏管理对话框", (await page.locator(".modal.macro, .macro-dialog, [class*=macro]").count()) >= 1);
await page.locator(".modal-mask button", { hasText: "完成" }).first().click();
await page.waitForTimeout(200);
// 点空白处关闭下拉（若仍开着）
await page.mouse.click(500, 400);
await page.waitForTimeout(200);

// ---------- 5. 变换菜单在收纳下拉中扁平展开 ----------
await page.locator(".menubar-more").click();
await page.waitForTimeout(250);
check("下拉含变换项（转为大写）", (await page.locator(".menubar-overflow button", { hasText: "转为大写" }).count()) === 1);
await page.keyboard.press("Escape");

console.log(`\n===== v022: ${results.filter((r) => r.ok).length}/${results.length} PASS =====`);
await browser.close();
await server.close();
