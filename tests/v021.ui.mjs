/**
 * v0.21.0 验证（右键搜索 + 菜单栏紧凑化）：
 *  1. 选中文字 → 右键菜单出现「🌐 在 Web 搜索」「🔍 在 NotePP 中搜索」
 *  2. 无选区右键 → 不出现这两项（只有插入媒体）
 *  3. 点「在 NotePP 中搜索」→ 查找浮窗打开且关键词为选中文本
 *  4. 点「在 Web 搜索」→ 调用系统浏览器打开 Bing 搜索（URL 编码正确）
 *  5. 设置中可切换搜索引擎（百度）→ Web 搜索改用百度
 *  6. 菜单栏 flex-wrap 生效：窄窗口自动换行不遮挡（出现第二行）
 */
import { chromium } from "/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs";
import { createServer } from "vite";

const results = [];
const check = (name, cond, extra = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) process.exitCode = 1;
};

/** 点菜单栏按钮：优先直点，被收纳进 ▼ 时走下拉 */
async function menuBtn(page, text) {
  const btn = page.locator(".menubar button", { hasText: text }).first();
  try {
    await btn.click({ timeout: 2500 });
    return;
  } catch {
    await page.locator(".menubar-more").click();
    await page.waitForTimeout(200);
    await page.locator(".menubar-overflow button", { hasText: text }).first().click();
    await page.waitForTimeout(100);
  }
}

const server = await createServer({ root: "/workspace/notepp", server: { port: 5230 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 940 } })).newPage();

await page.addInitScript(() => {
  window.__openUrls = [];
  window.__FS__ = {
    "/demo/a.txt": { content: "hello world from notepp\nsecond line here\n", mtime: 1 },
  };
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => cb,
    invoke: (cmd, args) => {
      if (cmd === "opened_urls") return Promise.resolve([]);
      if (cmd === "plugin:opener|open_url") {
        window.__openUrls.push(args.path ?? args.url ?? JSON.stringify(args));
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

await page.goto("http://localhost:5230/", { waitUntil: "networkidle" });
await page.waitForTimeout(700);

// 打开文件
const listBtn = page.locator(".menubar button", { hasText: "列表" }).first();
if (!((await listBtn.getAttribute("class")) || "").includes("on")) await listBtn.click();
await page.locator(".file-row", { hasText: "a.txt" }).first().click();
await page.waitForTimeout(400);

/** 精确选中第一行前 n 个字符（键盘选区，所见即所得） */
async function selectFirstChars(n) {
  const line = page.locator(".cm-content .cm-line").first();
  const box = await line.boundingBox();
  await page.mouse.click(box.x + 2, box.y + box.height / 2);
  await page.keyboard.press("Home");
  for (let i = 0; i < n; i++) await page.keyboard.press("Shift+ArrowRight");
  await page.waitForTimeout(150);
}

// ---------- 2. 无选区右键 → 不出现搜索项（先测，避免选区缓存干扰） ----------
const lineBox0 = await page.locator(".cm-content .cm-line").first().boundingBox();
await page.mouse.click(lineBox0.x + 300, lineBox0.y + lineBox0.height / 2, { button: "right" });
await page.waitForTimeout(250);
const menu0 = page.locator(".ai-menu");
check("无选区右键弹插入菜单", (await menu0.count()) === 1);
check("无选区不出现 Web 搜索项", (await menu0.locator("button", { hasText: "在 Web 搜索" }).count()) === 0);
check("无选区不出现 NotePP 搜索项", (await menu0.locator("button", { hasText: "在 NotePP 中搜索" }).count()) === 0);
check("无选区仍可插入媒体", (await menu0.locator("button", { hasText: "插入媒体" }).count()) === 1);
await page.keyboard.press("Escape");
await page.mouse.click(10, 500);
await page.waitForTimeout(200);

// ---------- 1. 选中文字 → 右键菜单出现两个搜索项 ----------
await selectFirstChars(11);
const lineBox = await page.locator(".cm-content .cm-line").first().boundingBox();
await page.mouse.click(lineBox.x + 40, lineBox.y + lineBox.height / 2, { button: "right" });
await page.waitForTimeout(250);
const menu = page.locator(".ai-menu");
check("有选区右键弹出菜单", (await menu.count()) === 1);
check("菜单含「在 Web 搜索」", (await menu.locator("button", { hasText: "在 Web 搜索" }).count()) === 1);
check("菜单含「在 NotePP 中搜索」", (await menu.locator("button", { hasText: "在 NotePP 中搜索" }).count()) === 1);
check("菜单头部显示搜索区", (await menu.locator(".ai-menu-head", { hasText: "搜索" }).count()) === 1);

// ---------- 3. 在 NotePP 中搜索 → 查找浮窗带关键词 ----------
await menu.locator("button", { hasText: "在 NotePP 中搜索" }).click();
await page.waitForTimeout(400);
check("查找浮窗已打开", (await page.locator(".findbar").count()) === 1);
const q = await page.locator(".findbar-input[data-role=query]").inputValue();
check("关键词为选中文本", q === "hello world", JSON.stringify(q));
await page.keyboard.press("Escape");
await page.waitForTimeout(200);

// ---------- 4. 在 Web 搜索 → Bing（URL 编码） ----------
await selectFirstChars(11);
await page.mouse.click(lineBox.x + 40, lineBox.y + lineBox.height / 2, { button: "right" });
await page.waitForTimeout(250);
await page.locator(".ai-menu button", { hasText: "在 Web 搜索" }).click();
await page.waitForTimeout(300);
const urls = await page.evaluate(() => window.__openUrls);
check(
  "系统浏览器打开 Bing 搜索（含 URL 编码）",
  urls.length === 1 && urls[0] === "https://www.bing.com/search?q=hello%20world",
  JSON.stringify(urls)
);

// ---------- 5. 设置切换搜索引擎为百度 ----------
await menuBtn(page, "设置");
await page.waitForTimeout(300);
const engRow = page.locator(".modal.settings .setting-row", { hasText: "Web 搜索引擎" });
check("设置含 Web 搜索引擎下拉", (await engRow.count()) === 1);
await engRow.locator("select").selectOption("baidu");
await page.waitForTimeout(200);
// 关闭设置弹窗
await page.locator(".modal.settings").press("Escape").catch(() => {});
const closeBtn = page.locator(".modal.settings button", { hasText: "完成" });
if (await closeBtn.count()) await closeBtn.first().click().catch(() => {});
await page.waitForTimeout(300);
await selectFirstChars(11);
await page.mouse.click(lineBox.x + 40, lineBox.y + lineBox.height / 2, { button: "right" });
await page.waitForTimeout(250);
await page.locator(".ai-menu button", { hasText: "在 Web 搜索" }).click();
await page.waitForTimeout(300);
const urls2 = await page.evaluate(() => window.__openUrls);
check(
  "切换后用百度搜索",
  urls2.length === 2 && urls2[1] === "https://www.baidu.com/s?wd=hello%20world",
  JSON.stringify(urls2)
);

// ---------- 6. 菜单栏紧凑化：flex-wrap + 窄窗口自动换行 ----------
const ow = await page.locator(".menubar").evaluate((el) => getComputedStyle(el).overflow);
check("菜单栏单行收纳（overflow hidden）", ow === "hidden", ow);
check("1440px 溢出按钮收纳进 ▼", (await page.locator(".menubar-more").count()) === 1);
await page.setViewportSize({ width: 900, height: 900 });
await page.waitForTimeout(300);
check("900px 溢出按钮收纳进 ▼", (await page.locator(".menubar-more").count()) === 1);
await page.locator(".menubar-more").click();
await page.waitForTimeout(250);
check("900px ▼ 下拉含被收纳的「设置」", (await page.locator(".menubar-overflow button", { hasText: "设置" }).count()) === 1);
await page.keyboard.press("Escape");
await page.waitForTimeout(150);

console.log(`\n===== v021: ${results.filter((r) => r.ok).length}/${results.length} PASS =====`);
await browser.close();
await server.close();
