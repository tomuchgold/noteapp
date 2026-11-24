/**
 * v0.23.0 验证（写作三件套）：
 *  1. 大纲/目录面板：解析 Markdown 标题（含跳过代码块伪标题），点击跳转对应行
 *  2. 光标位置记忆：光标移到某行 → 重启（reload 会话恢复）→ 光标回到该行
 *  3. 状态栏字数统计：字数（中文按字/英文按词）+ 字符数
 */
import { readFileSync, existsSync } from "node:fs";
import { chromium } from "/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs";
import { createServer } from "vite";

const results = [];
const check = (name, cond, extra = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) process.exitCode = 1;
};

const DOC = [
  "# 第一章 开端",
  "",
  "这是第一段文字。",
  "",
  "## 第一节 背景",
  "",
  "```python",
  "# 这不是标题（代码块）",
  "print('hi')",
  "```",
  "",
  "## 第二节 方法",
  "",
  "### 小节 细节",
  "",
  "正文完。",
].join("\n");

const server = await createServer({ root: "/workspace/notepp", server: { port: 5234 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 940 } });
const page = await ctx.newPage();

await page.addInitScript(() => {
  const doc = [
    "# 第一章 开端",
    "",
    "这是第一段文字。",
    "",
    "## 第一节 背景",
    "",
    "```python",
    "# 这不是标题（代码块）",
    "print('hi')",
    "```",
    "",
    "## 第二节 方法",
    "",
    "### 小节 细节",
    "",
    "正文完。",
  ].join("\n");
  window.__FS__ = { "/demo/book.md": { content: doc, mtime: 1 } };
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
    JSON.stringify([{ path: "/demo/book.md", name: "book.md", category: null, favorite: false, lastOpened: 1, preview: "" }])
  );
  localStorage.setItem(
    "notepp.session",
    JSON.stringify({ paths: ["/demo/book.md"], activePath: "/demo/book.md", drafts: [] })
  );
});

await page.goto("http://localhost:5234/", { waitUntil: "networkidle" });
await page.waitForTimeout(800);

// ---------- 1. 大纲/目录面板 ----------
await page.locator(".menubar button", { hasText: "目录" }).first().click();
await page.waitForTimeout(300);
const panel = page.locator(".outline-panel");
check("目录面板已打开", (await panel.count()) === 1);
const items = page.locator(".outline-item");
check("标题解析出 4 节（跳过代码块伪标题）", (await items.count()) === 4, `count=${await items.count()}`);
const texts = await items.allTextContents();
check("含 H1「第一章 开端」", texts.some((t) => t.includes("第一章 开端")));
check("不含代码块内的「这不是标题」", !texts.some((t) => t.includes("这不是标题")));
// 点击「第二节 方法」（第 12 行）→ 状态栏 行 12
await page.locator(".outline-item", { hasText: "第二节 方法" }).click();
await page.waitForTimeout(400);
const line1 = await page.locator(".statusbar .status-item", { hasText: "行 " }).first().textContent();
check("点击目录跳转到第 12 行", line1?.includes("行 12"), line1 ?? "");

// ---------- 2. 光标位置记忆 ----------
// 光标已在第 11 行（上面跳转过），把光标移到第 3 行再记录
await page.locator(".cm-content").click();
await page.keyboard.press("Control+Home");
await page.keyboard.press("ArrowDown");
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(300);
// reload → 会话恢复同一文件，光标应回到第 3 行
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1200);
const line2 = await page.locator(".statusbar .status-item", { hasText: "行 " }).first().textContent();
check("重启后光标回到上次所在行（行 3）", line2?.includes("行 3,") || /行 3\b/.test(line2 ?? ""), line2 ?? "");

// ---------- 2.5 切换标签各自记忆光标（多文件固有行为） ----------
// 新开一个干净上下文：预置两个文件与光标记录，模拟真实多文件切换
const page3 = await (await browser.newContext({ viewport: { width: 1600, height: 940 } })).newPage();
await page3.addInitScript(() => {
  window.__FS__ = {
    "/demo/book.md": { content: ["# A", "", "x", "", "## B", "", "```py", "# t", "p(1)", "```", "", "## C", "", "### D", "", "end"].join("\n"), mtime: 1 },
    "/demo/b.md": { content: "l1\nl2\nl3\nl4\nl5\nl6\n", mtime: 3 },
  };
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => cb,
    invoke: (cmd, args) => {
      if (cmd === "opened_urls") return Promise.resolve([]);
      if (cmd === "read_text_file") { const f = window.__FS__[args.path]; return f ? Promise.resolve({ content: f.content, encoding: "UTF-8", bom: false, eol: "LF", size: f.content.length }) : Promise.reject("nf"); }
      if (cmd === "file_info") { const f = window.__FS__[args.path]; return f ? Promise.resolve({ size: f.content.length, mtime: f.mtime }) : Promise.reject("nf"); }
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
  localStorage.setItem("notepp.cursor-pos", JSON.stringify({ "/demo/book.md": { line: 3, col: 1 }, "/demo/b.md": { line: 5, col: 1 } }));
  localStorage.setItem("notepp.session", JSON.stringify({ paths: ["/demo/book.md", "/demo/b.md"], activePath: "/demo/b.md", drafts: [] }));
});
await page3.goto("http://localhost:5234/", { waitUntil: "networkidle" });
await page3.waitForTimeout(1200);
const t0 = await page3.locator(".statusbar .status-item", { hasText: "行 " }).first().textContent();
check("初始 b.md → 恢复到行 5", /行 5\b/.test(t0 ?? ""), t0 ?? "");
await page3.locator(".tabbar .tab", { hasText: "book.md" }).click();
await page3.waitForTimeout(500);
const lineBook = await page3.locator(".statusbar .status-item", { hasText: "行 " }).first().textContent();
check("切回 book.md → 恢复到行 3", /行 3\b/.test(lineBook ?? ""), lineBook ?? "");
await page3.locator(".tabbar .tab", { hasText: "b.md" }).click();
await page3.waitForTimeout(500);
const lineB = await page3.locator(".statusbar .status-item", { hasText: "行 " }).first().textContent();
check("再切回 b.md → 恢复到行 5", /行 5\b/.test(lineB ?? ""), lineB ?? "");
await page3.close();

// ---------- 2.7 未保存草稿也记住光标（新建文件无路径场景） ----------
const page4 = await (await browser.newContext({ viewport: { width: 1600, height: 940 } })).newPage();
await page4.addInitScript(() => {
  window.__FS__ = {};
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => cb,
    invoke: (cmd) => (cmd === "opened_urls" ? Promise.resolve([]) : Promise.resolve(null)),
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
    unregisterListener: () => {},
    registerListener: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  window.matchMedia =
    window.matchMedia ||
    (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  // 两个未保存草稿（path=null），各带光标记录：草稿A 行 3，草稿B 行 5
  // 注意：addInitScript 在 reload 时会重跑，用标记防止把已持久化的 session 覆盖回去
  if (!localStorage.getItem("notepp.seeded-v237")) {
    const lines = (n) => Array.from({ length: n }, (_, i) => `line${i + 1}`).join("\n");
    localStorage.setItem("notepp.seeded-v237", "1");
    localStorage.setItem(
      "notepp.session",
      JSON.stringify({
        paths: [],
        activePath: null,
        drafts: [
          { path: null, name: "草稿A.md", content: lines(8), cursor: { line: 3, col: 1 } },
          { path: null, name: "草稿B.md", content: lines(9), cursor: { line: 5, col: 1 } },
        ],
      })
    );
  }
});
await page4.goto("http://localhost:5234/", { waitUntil: "networkidle" });
await page4.waitForTimeout(1200);
// 初始激活第一个草稿 → 应恢复到行 3
const d0 = await page4.locator(".statusbar .status-item", { hasText: "行 " }).first().textContent();
check("重启后草稿A → 恢复到行 3", /行 3\b/.test(d0 ?? ""), d0 ?? "");
// 切到草稿B → 恢复到行 5
await page4.locator(".tabbar .tab", { hasText: "草稿B" }).click();
await page4.waitForTimeout(500);
const d5 = await page4.locator(".statusbar .status-item", { hasText: "行 " }).first().textContent();
check("切到草稿B → 恢复到行 5", /行 5\b/.test(d5 ?? ""), d5 ?? "");
// 在草稿B 把光标移到第 8 行 → 切走再切回，应停在第 8 行（会话内实时记录）
await page4.locator(".cm-content").click();
await page4.keyboard.press("Control+Home");
for (let i = 0; i < 7; i++) await page4.keyboard.press("ArrowDown");
await page4.waitForTimeout(300);
await page4.locator(".tabbar .tab", { hasText: "草稿A" }).click();
await page4.waitForTimeout(400);
await page4.locator(".tabbar .tab", { hasText: "草稿B" }).click();
await page4.waitForTimeout(500);
const d8 = await page4.locator(".statusbar .status-item", { hasText: "行 " }).first().textContent();
check("草稿B 移动后切回 → 停在新位置行 8", /行 8\b/.test(d8 ?? ""), d8 ?? "");
// 重启验证：草稿B 的光标已随会话持久化到行 8
await page4.reload({ waitUntil: "networkidle" });
await page4.waitForTimeout(1200);
// 激活的是草稿A；切到草稿B 应恢复到行 8
await page4.locator(".tabbar .tab", { hasText: "草稿B" }).click();
await page4.waitForTimeout(600);
const d8r = await page4.locator(".statusbar .status-item", { hasText: "行 " }).first().textContent();
check("重启后草稿B → 恢复到持久化的行 8", /行 8\b/.test(d8r ?? ""), d8r ?? "");
await page4.close();

// ---------- 3. 状态栏字数统计 ----------
const stats = await page.locator(".statusbar .status-item", { hasText: "字 · " }).first().textContent().catch(() => "");
const docChars = DOC.length;
check("状态栏显示字符数", stats.includes(`${docChars} 字符`), `${stats} (期望 ${docChars})`);
// 中文正文：约 40+ 字
const wordNum = parseInt((stats ?? "").match(/^(\d+)/)?.[1] ?? "0", 10);
check("字数统计合理（>30 字）", wordNum > 30, `words=${wordNum}`);

// ---------- 4. 手册 ----------
const manualPath = "/workspace/site/manual.html";
check("手册更新（含大纲目录章节）", existsSync(manualPath) && readFileSync(manualPath, "utf-8").includes("大纲目录"));

console.log(`\n===== v023: ${results.filter((r) => r.ok).length}/${results.length} PASS =====`);
await browser.close();
await server.close();
