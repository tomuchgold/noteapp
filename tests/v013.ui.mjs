/**
 * v0.13.0 验证：
 *  1. 设置菜单 emoji + 悬停提示（title）
 *  2. 搜索结果面板增强（默认高度更大、字号更大、标题醒目）
 *  3. 宏管理：录制 → 保存为命名宏 → 回放 → 重命名 → 导出 → 导入 → 删除
 *  4. 列编辑：短行/空行自动补空格成直线（矩形选区右端对齐）
 *  5. 功能手册静态网页存在且关键内容齐全
 */
import { chromium } from "/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs";
import { createServer } from "vite";
import { readFileSync, existsSync } from "node:fs";

const results = [];
const check = (name, cond, extra = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) process.exitCode = 1;
};

const server = await createServer({ root: "/workspace/notepp", server: { port: 5209 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();

const TEXT = "short\n这是一行明显更长的内容文本\n\nend";
await page.addInitScript((txt) => {
  window.__FS__ = { "/demo/c.txt": { content: txt, mtime: 100 } };
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => cb,
    invoke: (cmd, args) => {
      if (cmd === "plugin:dialog|open") return Promise.resolve(["/demo/c.txt"]);
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
}, TEXT);
await page.goto("http://localhost:5209/", { waitUntil: "networkidle" });
await page.waitForSelector(".cm-content");
await page.keyboard.press("Control+o");
await page.waitForTimeout(300);
check("测试文件已打开", (await page.locator(".cm-content").innerText()).includes("short"));

// ---------- 1. 设置菜单 emoji + tooltip ----------
await page.locator(".menubar button", { hasText: "设置" }).click();
await page.waitForSelector(".modal.settings");
const emojiRows = await page.locator(".modal.settings .setting-row label .setting-emoji").count();
check("设置项含 emoji 图标", emojiRows >= 10, `emoji 数=${emojiRows}`);
const titledLabels = await page.locator('.modal.settings .setting-row label[title]').count();
check("设置项 label 含悬停提示(title)", titledLabels >= 10, `带 title 数=${titledLabels}`);
const firstTip = await page.locator('.modal.settings .setting-row label[title]').first().getAttribute("title");
check("悬停提示内容非空", !!firstTip && firstTip.length > 6, `tip="${firstTip}"`);
await page.locator(".modal.settings .modal-actions button.primary", { hasText: "完成" }).click();
await page.waitForTimeout(100);

// ---------- 2. 搜索结果面板增强 ----------
await page.keyboard.press("Control+f");
await page.waitForTimeout(200);
await page.locator('.findbar-input[data-role="query"]').fill("行");
await page.waitForTimeout(200);
// 打开结果面板（若未开）
const toggle = page.locator('.findbar button[title*="结果面板"]').first();
if (await toggle.count()) await toggle.click();
await page.waitForTimeout(200);
const rp = await page.evaluate(() => {
  const el = document.querySelector(".search-results");
  if (!el) return null;
  const cs = getComputedStyle(el);
  const list = getComputedStyle(document.querySelector(".search-results-list"));
  const head = getComputedStyle(document.querySelector(".search-results-head"));
  return { height: parseFloat(cs.height), listFs: parseFloat(list.fontSize), headFs: parseFloat(head.fontSize), headWeight: head.fontWeight };
});
check("结果面板默认高度 ≥ 240px", rp && rp.height >= 240, `height=${rp?.height}px`);
check("结果列表字号 ≥ 14px", rp && rp.listFs >= 14, `listFs=${rp?.listFs}px`);
check("结果面板标题加粗", rp && (rp.headWeight === "600" || rp.headWeight === "700"), `weight=${rp?.headWeight}`);
await page.keyboard.press("Escape");
await page.waitForTimeout(100);

// ---------- 3. 宏：录制 → 保存 → 回放 → 重命名 → 导出 → 导入 → 删除 ----------
await page.evaluate(() => localStorage.removeItem("notepp.saved-macros"));
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".cm-content");
await page.keyboard.press("Control+o");
await page.waitForTimeout(250);

// 录制：输入 "ABC" 然后停止
await page.locator(".menubar button", { hasText: "录制宏" }).click();
await page.waitForTimeout(80);
await page.locator(".cm-content").click();
await page.keyboard.type("ABC");
await page.locator(".menubar button", { hasText: "停止录制" }).click();
await page.waitForTimeout(100);

// 打开宏管理
await page.locator(".menubar button", { hasText: "宏管理" }).click();
await page.waitForSelector(".macro-modal");
await page.locator(".macro-save-row input").fill("测试宏A");
await page.locator(".macro-save-row button.primary").click();
await page.waitForTimeout(150);
check("宏已保存并出现在列表", (await page.locator(".macro-item-name", { hasText: "测试宏A" }).count()) >= 1);
const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem("notepp.saved-macros") || "[]"));
check("宏持久化到 localStorage", persisted.length === 1 && persisted[0].items.length >= 3, `items=${persisted[0]?.items?.length}`);

// 重命名
// v0.14 起宏项第一个按钮是「设置快捷键」，第二个才是重命名
await page.locator(".macro-item", { hasText: "测试宏A" }).locator(".macro-item-btns button").nth(1).click();
await page.waitForTimeout(80);
await page.locator(".macro-rename-input").fill("测试宏B");
await page.locator(".macro-rename-input").press("Enter");
await page.waitForTimeout(120);
check("宏重命名成功", (await page.locator(".macro-item-name", { hasText: "测试宏B" }).count()) >= 1);

// 导出（拦截下载）
const [download] = await Promise.all([
  page.waitForEvent("download"),
  page.locator(".macro-ops button", { hasText: "导出" }).click(),
]);
const dlPath = await download.path();
const exported = readFileSync(dlPath, "utf-8");
check("导出 JSON 含宏数据", exported.includes("测试宏B") && exported.includes("notepp-macros"), `len=${exported.length}`);

// 删除
// v0.14：⌨️ / ✏️ / 🗑️，删除是第三个按钮
await page.locator(".macro-item", { hasText: "测试宏B" }).locator(".macro-item-btns button").nth(2).click();
await page.waitForTimeout(120);
check("宏删除成功", (await page.locator(".macro-empty").count()) >= 1);

// 导入（用导出的内容）
await page.evaluate((json) => {
  const dt = new DataTransfer();
  dt.items.add(new File([json], "macros.json", { type: "application/json" }));
  const input = document.querySelector('.macro-modal input[type="file"]');
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}, exported);
await page.waitForTimeout(200);
check("宏从 JSON 导入成功", (await page.locator(".macro-item-name", { hasText: "测试宏B" }).count()) >= 1);

// 回放（验证能把动作写回编辑器）
await page.locator(".macro-modal .modal-actions button.primary", { hasText: "完成" }).click();
await page.waitForTimeout(100);
await page.locator(".cm-content").click();
const docBefore = await page.locator(".cm-content").innerText();
await page.locator(".menubar button", { hasText: "宏管理" }).click();
await page.waitForSelector(".macro-modal");
await page.locator(".macro-item-name", { hasText: "测试宏B" }).click();
await page.waitForTimeout(200);
await page.locator(".macro-modal .modal-actions button.primary", { hasText: "完成" }).click();
await page.waitForTimeout(100);
const docAfter = await page.locator(".cm-content").innerText();
check("回放宏把文本写回编辑器", docAfter.length > docBefore.length && docAfter.includes("ABC"), `${docBefore.length} → ${docAfter.length}`);

// ---------- 4. 列编辑：短行/空行补空格成直线 ----------
await page.evaluate(() => localStorage.removeItem("notepp.saved-macros"));
// v0.20.1 起草稿会随会话恢复（预期行为），此处清掉会话以回到磁盘干净状态
await page.evaluate(() => localStorage.removeItem("notepp.session"));
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".cm-content");
await page.keyboard.press("Control+o");
await page.waitForTimeout(250);
await page.locator(".menubar button", { hasText: "列选" }).click();
await page.waitForTimeout(100);

// 探测 EditorView，拖拽覆盖短行/长行/空行，松手后检查各行选区右端（to）字符列一致
const { EditorView } = await import("/workspace/notepp/node_modules/@codemirror/view/dist/index.js").catch(() => ({}));
const cb = await page.locator(".cm-content").boundingBox();
// 从第一行开头拖到大约第 12 个字符宽度处（超过短行 "short" 的长度）
const startX = cb.x + 6;
const startY = cb.y + 10;
const endX = cb.x + 6 + 12 * 9;
const endY = cb.y + 10 + 3 * 24;
await page.mouse.move(startX, startY);
await page.mouse.down();
await page.mouse.move(endX, endY, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(250);

const colInfo = await page.evaluate(async () => {
  const mod = await import("/node_modules/.vite/deps/@codemirror_view.js").catch(() => null);
  const dom = document.querySelector(".cm-editor");
  let view = null;
  if (mod && mod.EditorView && mod.EditorView.findFromDOM) view = mod.EditorView.findFromDOM(dom);
  if (!view) {
    // fallback: 遍历 DOM 找 cmView
    view = dom?.cmView?.view || dom?.view || null;
  }
  const doc = document.querySelector(".cm-content")?.innerText || "";
  return { hasView: !!view, doc };
});
// 用文档内容直接验证：短行 "short"/"end" 与空行都被补上了尾部空格（选区成直线）
const docText = await page.evaluate(() => {
  const v = document.querySelector(".cm-content");
  return v ? v.innerText.replace(/\u00a0/g, " ") : "";
});
const padLines = docText.split("\n");
const emptyPadded = padLines.some((l) => l.trim() === "" && l.length > 0);
const shortPadded = padLines.some((l) => /^short\s+$/.test(l));
const endPadded = padLines.some((l) => /^end\s+$/.test(l));
check("列编辑为空行补空格（成直线）", emptyPadded, JSON.stringify(padLines));
check("列编辑为短行补空格（成直线）", shortPadded && endPadded);

// ---------- 5. 功能手册静态网页 ----------
const manualPath = "/workspace/site/manual.html";
check("功能手册网页存在", existsSync(manualPath));
if (existsSync(manualPath)) {
  const html = readFileSync(manualPath, "utf-8");
  check("手册含版本 v0.24.0", html.includes("v0.24.0"));
  check("手册覆盖全部功能章节", ["文件与标签", "编辑体验", "主题外观", "查找替换", "Markdown", "对比与预览", "标注", "宏", "AI 辅助", "快捷键"].every((k) => html.includes(k)));
  check("手册含宏保存与导入导出说明", html.includes("宏管理") && html.includes("导入") && html.includes("导出"));
  check("首页有功能手册入口", readFileSync("/workspace/site/index.html", "utf-8").includes("manual.html"));
}

await browser.close();
await server.close();
const pass = results.filter((r) => r.ok).length;
console.log(`\n==== ${pass}/${results.length} 通过 ====`);
