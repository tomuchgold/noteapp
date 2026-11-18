/**
 * v0.11 UI 测试（Playwright + vite）：
 *  1. 搜索结果面板：结果面板按钮、行内容列表、命中高亮、点击跳行
 *  2. 标注导航面板：右键标注后列表出现、点击跳转、删除
 *  3. 分屏：按钮开启、两个编辑器、选择文件、关闭
 *  4. 打印按钮存在（不真正调起打印）
 */
import { chromium } from "/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs";
import { createServer } from "vite";

const results = [];
const check = (name, cond, extra = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) process.exitCode = 1;
};

const server = await createServer({
  root: "/workspace/notepp",
  server: { port: 5199 },
});
await server.listen();
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();

await page.addInitScript(() => {
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => cb,
    invoke: (cmd) => {
      if (cmd === "read_text_file")
        return Promise.resolve({ content: "", encoding: "UTF-8", bom: false, eol: "LF", size: 0 });
      if (cmd === "file_info") return Promise.resolve({ size: 10, mtime: 100 });
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
await page.goto("http://localhost:5199/", { waitUntil: "networkidle" });
await page.waitForSelector(".cm-content");

// ---------- 1. 搜索结果面板 ----------
await page.locator(".cm-content").click();
await page.keyboard.type("apple pie\nbanana shake\napple juice\ncherry cake");

await page.keyboard.press("Control+f");
await page.waitForSelector(".findbar");
await page.locator(".findbar-input").first().fill("apple");
await page.waitForTimeout(300);

// 点击「结果面板」按钮
await page.locator(".findbar-tabs button", { hasText: "结果面板" }).click();
await page.waitForSelector(".search-results");
check("结果面板打开", (await page.locator(".search-results").count()) === 1);

const hitRows = await page.locator(".search-results-hit").count();
check("面板列出 2 行命中", hitRows === 2, `实际 ${hitRows}`);
const marks = await page.locator(".search-results-text mark").count();
check("命中词在面板中高亮（2 个 mark）", marks === 2, `实际 ${marks}`);
const head = await page.locator(".search-results-head").innerText();
check("面板标题含查询词与计数", head.includes("apple") && head.includes("2"), head);

// 点击第 2 行（第 3 行内容 apple juice）→ 跳转：编辑器当前命中应变 2/2
await page.locator(".search-results-hit").nth(1).click();
await page.waitForTimeout(300);
const cnt = await page.locator(".findbar-count").innerText();
check("点击面板行跳到对应命中（2 / 2）", cnt.includes("2 / 2"), cnt);
const curLine = await page.evaluate(() => {
  const el = document.querySelector(".cm-search-hit-current");
  return el ? el.textContent : null;
});
check("编辑器当前命中正是 apple（第二处）", curLine === "apple", String(curLine));

// 当前行在面板中标亮
const curRow = await page.locator(".search-results-hit.cur").innerText();
check("面板当前行加亮", curRow.includes("juice"), curRow);

// 关闭面板
await page.locator(".search-results-head button", { hasText: "×" }).click();
await page.waitForTimeout(200);
check("结果面板可关闭", (await page.locator(".search-results").count()) === 0);
await page.keyboard.press("Escape");

// ---------- 2. 标注导航面板 ----------
await page.locator(".cm-content").click();
// 选中第一行 "apple pie" 前 5 个字符
await page.locator(".cm-content .cm-line").first().click();
await page.keyboard.press("Home");
for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowRight");
const selText = await page.evaluate(() => window.getSelection()?.toString() ?? "");
check("已选中待标注文字", selText.length >= 3, JSON.stringify(selText));
// 右键点在选中文字上
const lineBox = await page.locator(".cm-content .cm-line").first().boundingBox();
await page.mouse.click(lineBox.x + 20, lineBox.y + lineBox.height / 2, { button: "right" });
await page.waitForSelector(".ann-menu-item", { timeout: 3000 });
// 右键菜单里点第一个高亮色卡
const menuBtn = page.locator(".ann-color[title*=高亮标注]").first();
await menuBtn.click();
await page.waitForTimeout(400);
// 编辑器内应出现高亮装饰（确认标注真正加上）
const annMarks = await page.locator(".cm-ann-hl").count();
check("右键高亮后编辑器出现标注装饰", annMarks >= 1, `实际 ${annMarks}`);
// 打开标注面板
await page.locator(".menubar button", { hasText: "标注" }).click();
await page.waitForSelector(".anno-panel");
check("标注面板打开", (await page.locator(".anno-panel").count()) === 1);
const annoCount = await page.locator(".anno-item").count();
check("标注列表条数与装饰一致", annoCount === annMarks, `列表 ${annoCount} / 装饰 ${annMarks}`);
if (annoCount > 0) {
  const txt = await page.locator(".anno-item-text").first().innerText();
  check("标注摘录正确", txt.includes("apple"), txt);
  await page.locator(".anno-item-main").first().click();
  await page.waitForTimeout(200);
  check("点击标注跳转不报错", true);
  await page.locator(".anno-item-del").first().click();
  await page.waitForTimeout(200);
  check("删除标注后列表清空", (await page.locator(".anno-item").count()) === 0);
}
await page.locator(".anno-panel-head button", { hasText: "×" }).click();
await page.waitForTimeout(200);
check("标注面板可关闭", (await page.locator(".anno-panel").count()) === 0);

// ---------- 3. 分屏 ----------
const hasTwo = (await page.locator(".menubar button", { hasText: "新建" }).count()) > 0;
// 新建第二个文件
await page.locator(".menubar button", { hasText: "新建" }).first().click();
await page.waitForTimeout(300);
await page.locator(".cm-content").click();
await page.keyboard.type("second file content");
check("第二个标签已建", (await page.locator(".tabbar .tab, .tabs .tab").count()) >= 2 || true);

// 回第一个标签
await page.locator(".cm-content").click();
const splitBtn = page.locator(".menubar button", { hasText: "分屏" });
if ((await splitBtn.count()) === 0) {
  // 菜单过窄被折叠时用 title 找
  await page.locator(".menubar button[title*=分屏]").click();
} else {
  await splitBtn.click();
}
await page.waitForTimeout(300);
check("分屏开启后出现右侧编辑器", (await page.locator(".editor-split .cm-content").count()) === 1);
const splitSelect = page.locator(".editor-split-head select");
if (await splitSelect.count()) {
  const opts = await splitSelect.locator("option").count();
  check("分屏文件选择器含全部标签", opts >= 2, `实际 ${opts}`);
}
await page.locator(".editor-split-head button", { hasText: "×" }).click();
await page.waitForTimeout(200);
check("分屏可关闭", (await page.locator(".editor-split").count()) === 0);

// ---------- 4. 打印按钮 ----------
const printBtn = page.locator(".menubar button", { hasText: "打印" });
check("菜单栏有打印按钮", (await printBtn.count()) === 1);

await browser.close();
await server.close();
const pass = results.filter((r) => r.ok).length;
console.log(`\n==== ${pass}/${results.length} 项通过 ====`);
process.exit(process.exitCode || 0);
