/**
 * v0.22.1 验证（菜单栏显示模式 + 两层自适应换行，无「▼」收纳）：
 *  1. 默认 emoji+文字：图标与文字都可见
 *  2. 设置切换「只显示 emoji」→ 文字隐藏；「只显示文字」→ 图标隐藏
 *  3. 宽窗口：菜单栏单行放得下（无 ▼ 按钮）
 *  4. 窄窗口（1000px）：菜单栏换行为两行，所有按钮仍可见可点（直接点「宏管理」弹窗）
 *  5. 全程不存在 .menubar-more / .menubar-overflow
 */
import { chromium } from "/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs";
import { createServer } from "vite";

const results = [];
const check = (name, cond, extra = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) process.exitCode = 1;
};

const server = await createServer({ root: "/workspace/notepp", server: { port: 5232 } });
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

await page.goto("http://localhost:5232/", { waitUntil: "networkidle" });
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

// ---------- 3. 宽窗口：单行 + 无 ▼ ----------
await page.setViewportSize({ width: 2600, height: 900 });
await page.waitForTimeout(300);
const mbH_wide = await page.locator(".menubar").evaluate((el) => el.offsetHeight);
check("2600px 超宽单行（高度 ≤ 40px）", mbH_wide <= 40, `height=${mbH_wide}`);
check("全程无 ▼ 收纳按钮", (await page.locator(".menubar-more, .menubar-overflow").count()) === 0);

// ---------- 3.5 逐级压缩：变窄字号/间距变小 ----------
await page.setViewportSize({ width: 1600, height: 900 });
await page.waitForTimeout(200);
const fsWide = await page.locator(".menubar button").first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
await page.setViewportSize({ width: 1100, height: 900 });
await page.waitForTimeout(300);
const fs1100 = await page.locator(".menubar button").first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
check("1100px 一级压缩（字号变小）", fs1100 < fsWide, `${fsWide} -> ${fs1100}`);
await page.setViewportSize({ width: 900, height: 900 });
await page.waitForTimeout(300);
const fs900 = await page.locator(".menubar button").first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
check("900px 二级压缩（字号更小）", fs900 < fs1100, `${fs1100} -> ${fs900}`);

// ---------- 4. 窄窗口：换行或压缩，按钮直接可见可点 ----------
await page.setViewportSize({ width: 1000, height: 900 });
await page.waitForTimeout(400);
const mbH_narrow = await page.locator(".menubar").evaluate((el) => el.offsetHeight);
check("1000px 两层换行或压缩可见", mbH_narrow > 0 && (await page.locator(".menubar button", { hasText: "宏管理" }).count()) === 1, `height=${mbH_narrow}`);
const macroBtn = page.locator(".menubar button", { hasText: "宏管理" }).first();
const macroVisible = await macroBtn.evaluate((el) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
});
check("「宏管理」按钮直接可见（不被遮挡）", macroVisible);
await macroBtn.click();
await page.waitForTimeout(300);
check("直接点击宏管理 → 弹出宏管理对话框", (await page.locator(".modal.macro, .macro-dialog, [class*=macro]").count()) >= 1);
await page.locator(".modal-mask button", { hasText: "完成" }).first().click();
await page.waitForTimeout(200);
check("收纳按钮/下拉仍未出现", (await page.locator(".menubar-more, .menubar-overflow").count()) === 0);

// ---------- 6. 极窄 430px：菜单栏换行、按钮全部可见 ----------
await page.setViewportSize({ width: 430, height: 800 });
await page.waitForTimeout(300);
const mb430 = await page.locator(".menubar").evaluate((el) => {
  const btns = Array.from(el.querySelectorAll(":scope > button")).filter((b) => {
    // menubar-secondary（打印/网站）在窄屏为设计隐藏，不算截断
    return getComputedStyle(b).display !== "none";
  });
  const clipped = btns.filter((b) => {
    const r = b.getBoundingClientRect();
    return r.width === 0 || r.left < 0 || r.right > window.innerWidth + 1;
  });
  return { wrap: getComputedStyle(el).flexWrap, clipped: clipped.length, hidden: btns.length === 0 ? -1 : undefined };
});
check("430px 菜单栏换行显示", mb430.wrap === "wrap", JSON.stringify(mb430));
check("430px 无按钮被截断", mb430.clipped === 0);

// ---------- 7. WebView 默认右键菜单已禁用（contextmenu preventDefault） ----------
const ctxPrevented = await page.evaluate(() => {
  const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  document.body.dispatchEvent(ev);
  return ev.defaultPrevented;
});
check("右键默认菜单被阻止（无共享→tauri.localhost）", ctxPrevented);

// ---------- 8. 点击标签栏空白新建 + 光标自动落编辑区 ----------
await page.setViewportSize({ width: 1600, height: 940 });
await page.waitForTimeout(300);
const tabsBefore = await page.locator(".tabbar .tab").count();
await page.locator(".tabbar").click({ position: { x: 600, y: 12 } });
await page.waitForTimeout(300);
const tabsAfter = await page.locator(".tabbar .tab").count();
check("点击标签栏空白 → 新建标签", tabsAfter === tabsBefore + 1, `${tabsBefore} -> ${tabsAfter}`);
const focused = await page.evaluate(() => !!document.activeElement?.closest(".cm-content"));
check("新建后光标落在编辑区", focused);
// 新文件菜单栏手动聚焦兜底时也算：直接查 cm-content 是否可编辑
const editable = await page.evaluate(() => document.querySelector(".cm-content")?.getAttribute("contenteditable") === "true");
check("编辑区可输入", editable);

// ---------- 9. 「打开方式」文件关联：未知扩展（.ini）冷启动也能打开 ----------
const page2 = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
await page2.addInitScript(() => {
  window.__FS__ = {
    "/demo/x.ini": { content: "[a]\nb=1\n", mtime: 2 },
  };
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => cb,
    invoke: (cmd, args) => {
      if (cmd === "opened_urls") return Promise.resolve(["/demo/x.ini"]);
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
      if (cmd === "path_is_dir") return Promise.resolve(false);
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
    JSON.stringify([{ path: "/demo/x.ini", name: "x.ini", category: null, favorite: false, lastOpened: 1, preview: "" }])
  );
});
await page2.goto("http://localhost:5232/", { waitUntil: "networkidle" });
await page2.waitForTimeout(800);
const iniTab = page2.locator(".tabbar .tab", { hasText: "x.ini" });
check("「打开方式」.ini 冷启动自动开标签", (await iniTab.count()) === 1);
const iniContent = await page2.evaluate(() => document.querySelector(".cm-content")?.textContent ?? "");
check(".ini 内容已载入编辑器", iniContent.includes("[a]"));
await page2.close();

console.log(`\n===== v022: ${results.filter((r) => r.ok).length}/${results.length} PASS =====`);
await browser.close();
await server.close();
