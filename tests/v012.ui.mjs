/**
 * v0.12.0 UI 验证：
 *  1. 切换主题 → 整个界面（菜单栏/面板等）CSS 变量跟随变化
 *  2. 界面字号可调（设置滑块 + Ctrl+] 快捷键），body computed font-size 变化
 *  3. 查找框字号可调（A+/A− 按钮），findbar computed font-size 变化且持久化
 *  4. 查找浮窗可拖出窗口外（left 允许为负）
 *  5. 列编辑模式：中文/宽字符多行拖拽产生多个选区（按列对齐，不错位）
 */
import { chromium } from "/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs";
import { createServer } from "vite";

const results = [];
const check = (name, cond, extra = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) process.exitCode = 1;
};

const server = await createServer({ root: "/workspace/notepp", server: { port: 5207 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();

const CN_TEXT = "中文列编辑测试\n甲公司乙丙丁\nhello 世界\n";
await page.addInitScript((cn) => {
  window.__FS__ = { "/demo/cn.txt": { content: cn, mtime: 100 } };
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => cb,
    invoke: (cmd, args) => {
      if (cmd === "plugin:dialog|open") return Promise.resolve(["/demo/cn.txt"]);
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
}, CN_TEXT);
await page.goto("http://localhost:5207/", { waitUntil: "networkidle" });
await page.waitForSelector(".cm-content");

// 打开中文文件
await page.keyboard.press("Control+o");
await page.waitForTimeout(300);
check("中文文件已打开", (await page.locator(".cm-content").innerText()).includes("中文列编辑测试"));

// ---------- 1. 主题注入整体界面 ----------
const before = await page.evaluate(() => ({
  uiBg: getComputedStyle(document.documentElement).getPropertyValue("--ui-bg").trim(),
  menubarBg: getComputedStyle(document.querySelector(".menubar")).backgroundColor,
}));
await page.locator(".menubar button", { hasText: "设置" }).click();
await page.waitForSelector(".modal.settings");
// 点击「亮色」主题色块
await page.locator(".theme-swatch", { hasText: "亮色" }).first().click();
await page.waitForTimeout(200);
const afterTheme = await page.evaluate(() => ({
  uiBg: getComputedStyle(document.documentElement).getPropertyValue("--ui-bg").trim(),
  menubarBg: getComputedStyle(document.querySelector(".menubar")).backgroundColor,
  dataset: document.documentElement.dataset.theme,
}));
check("切换主题改变 --ui-bg 变量", before.uiBg !== afterTheme.uiBg, `${before.uiBg} → ${afterTheme.uiBg}`);
check("切换主题改变菜单栏背景（整体界面跟随）", before.menubarBg !== afterTheme.menubarBg, `${before.menubarBg} → ${afterTheme.menubarBg}`);
check("亮色主题 dataset=light", afterTheme.dataset === "light", afterTheme.dataset);

// ---------- 2. 界面字号缩放 ----------
await page.locator(".modal.settings .setting-row", { hasText: "界面字号" }).locator('input[type="range"]').fill("150");
await page.waitForTimeout(200);
const bodyFs150 = await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
const baseFs = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ui-scale")) * 13);
check("界面字号滑块改变 body 字号", bodyFs150 > 18, `body font-size=${bodyFs150}px`);
check("--ui-scale 变量已更新", Math.abs(bodyFs150 - baseFs) < 1.5, `scale base=${baseFs}`);

// Ctrl+] 快捷键
await page.locator(".modal.settings .modal-actions button.primary", { hasText: "完成" }).click();
await page.waitForTimeout(150);
const bodyFsBeforeKey = await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
await page.keyboard.press("Control+]");
await page.waitForTimeout(150);
const bodyFsAfterKey = await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
check("Ctrl+] 放大界面字号", bodyFsAfterKey > bodyFsBeforeKey, `${bodyFsBeforeKey} → ${bodyFsAfterKey}`);

// ---------- 3. 查找框字号 ----------
await page.keyboard.press("Control+f");
await page.waitForSelector(".findbar");
const findFsBefore = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".findbar-input")).fontSize));
await page.locator(".findbar-fontbtn", { hasText: "A+" }).click();
await page.locator(".findbar-fontbtn", { hasText: "A+" }).click();
await page.waitForTimeout(150);
const findFsAfter = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".findbar-input")).fontSize));
check("查找框字号 A+ 放大生效", findFsAfter > findFsBefore, `${findFsBefore} → ${findFsAfter}`);
const findScaleStored = await page.evaluate(() => JSON.parse(localStorage.getItem("notepp.editor-settings") || "{}").findScale);
check("查找框字号已持久化", findScaleStored >= 110, `findScale=${findScaleStored}`);

// ---------- 4. 查找框拖出窗口外 ----------
const dragHandle = page.locator(".findbar-drag");
const hb = await dragHandle.boundingBox();
await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
await page.mouse.down();
// 往左上拖，越过窗口边界
await page.mouse.move(hb.x + hb.width / 2 - 800, hb.y + hb.height / 2 - 400, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(120);
const draggedPos = await page.evaluate(() => {
  const el = document.querySelector(".findbar");
  return { x: parseInt(el.style.left), y: parseInt(el.style.top) };
});
check("查找框可拖出窗口外（left 为负）", draggedPos.x < 0, JSON.stringify(draggedPos));
// 拖回窗口内以便后续交互
await page.evaluate(() => {
  const el = document.querySelector(".findbar");
  el.style.left = "400px";
  el.style.top = "120px";
});

// ---------- 5. 列编辑：宽字符按列对齐 ----------
await page.keyboard.press("Escape");
await page.locator(".menubar button", { hasText: "列选" }).click();
await page.waitForTimeout(150);
check("列选模式已开启", await page.locator('.menubar button:has-text("列选")').evaluate((b) => b.classList.contains("on")));
const content = page.locator(".cm-content");
const cb = await content.boundingBox();
// 从第 1 行拖到第 3 行，模拟矩形选区（覆盖中文/宽字符）
await page.mouse.move(cb.x + 60, cb.y + 12);
await page.mouse.down();
await page.mouse.move(cb.x + 160, cb.y + 12 + 3 * 24, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(200);
// 读取 CodeMirror 真实选区数量（多光标）
const cmRanges = await page.evaluate(async () => {
  const cm = document.querySelector(".cm-content");
  const mod = await import("/node_modules/.vite/deps/@codemirror_view.js");
  const view = mod.EditorView.findFromDOM(cm);
  return view ? view.state.selection.ranges.length : 0;
});
check("列编辑产生多光标矩形选区", cmRanges >= 3, `选区数=${cmRanges}`);
// 多光标同步输入：打字后多行同时出现字符
await page.keyboard.type("Z");
await page.waitForTimeout(150);
const colText = await content.innerText();
const zCount = (colText.match(/Z/g) || []).length;
check("列编辑多光标同步输入（中文不错位）", zCount >= 3, `Z 出现 ${zCount} 次:\n${colText}`);

await browser.close();
await server.close();
const pass = results.filter((r) => r.ok).length;
console.log(`\n${pass}/${results.length} 通过`);
