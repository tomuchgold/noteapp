/**
 * v0.10 查找替换测试：
 *  A. 纯逻辑（findAll / replaceAll / nextIndex / 全字 / 正则 / 大小写保留）
 *  B. 界面（查找栏、计数、跳转、替换、全部替换、跨文件夹结果列表）
 */
import { chromium } from "/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs";
import { createServer } from "vite";


const results = [];
const check = (name, cond, extra = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) process.exitCode = 1;
};

// ---------- A. 纯逻辑 ----------

// vite 的 ts 模块用 node 直接 import 会失败 → 用 esbuild 预编译
import { build } from "esbuild";
await build({
  entryPoints: ["src/lib/search.ts"],
  bundle: true,
  format: "esm",
  outfile: "/tmp/search.mjs",
  logLevel: "silent",
});
const S = await import("/tmp/search.mjs?" + Date.now());

const opt = (o = {}) => ({ ...S.DEFAULT_OPTIONS, ...o });

let m = S.findAll("Hello hello HELLO", "hello", opt());
check("不区分大小写找到 3 处", m.length === 3);

m = S.findAll("Hello hello HELLO", "hello", opt({ caseSensitive: true }));
check("区分大小写只 1 处", m.length === 1);

m = S.findAll("cat concat cat_ cat", "cat", opt({ wholeWord: true }));
check("全字匹配排除 concat（下划线算单词字符）→ 2 处", m.length === 2, `实际 ${m.length}`);

m = S.findAll("你好吗 你好", "你好", opt({ wholeWord: true }));
check("中文全字匹配只命中独立的「你好」", m.length === 1);

m = S.findAll("a1 b22 c333", "\\d+", opt({ regex: true }));
check("正则 \\d+ 找到 3 处", m.length === 3);

m = S.findAll("x [unclosed", "[", opt({ regex: true }));
check("非法正则返回空（不抛异常）", m.length === 0);
check("非法正则被 isValidPattern 识别", S.isValidPattern("[", opt({ regex: true })) === false);

m = S.findAll("a.b axb", "a.b", opt());
check("非正则模式下 . 按字面量匹配 → 1 处", m.length === 1);

const r1 = S.replaceAll("foo FOO Foo", "foo", "bar", opt());
check("全部替换保留大小写", r1.count === 3 && r1.text === "bar BAR Bar", r1.text);

const r2 = S.replaceAll("id=12 id=34", "id=(\\d+)", "id[$1]", opt({ regex: true }));
check("正则替换支持 $1", r2.count === 2 && r2.text === "id[12] id[34]", r2.text);

const ms = S.findAll("abc abc abc", "abc", opt());
check("nextIndex 向后循环", S.nextIndex(ms, ms[0].from, 1) === 1);
check("nextIndex 到末尾回到第一处", S.nextIndex(ms, ms[2].from, 1) === 0);
check("nextIndex 向前循环", S.nextIndex(ms, ms[0].from, -1) === 2);

// ---------- B. 界面 ----------
const server = await createServer({ root: process.cwd(), server: { port: 5197 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();

await page.addInitScript(() => {
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => cb,
    invoke: (cmd) => {
      if (cmd === "read_text_file")
        return Promise.resolve({ content: "", encoding: "UTF-8", bom: false, eol: "LF", size: 0 });
      if (cmd === "file_info") return Promise.resolve({ size: 10 });
      if (cmd === "list_dir") return Promise.resolve([]);
      if (cmd === "search_in_folder")
        return Promise.resolve([
          { path: "/demo/a.md", line: 3, text: "这里包含关键词 keyword", col: 6 },
          { path: "/demo/a.md", line: 9, text: "keyword 又一次", col: 1 },
          { path: "/demo/b.md", line: 1, text: "# keyword 标题", col: 3 },
        ]);
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
await page.goto("http://localhost:5197/", { waitUntil: "networkidle" });
await page.waitForSelector(".cm-content");

// 输入测试文本
await page.locator(".cm-content").click();
await page.keyboard.type("cat dog cat cat\nCAT 也在这里\nconcat 不该被全字匹配");

// Ctrl+F 打开查找栏
await page.keyboard.press("Control+f");
await page.waitForSelector(".findbar");
check("Ctrl+F 打开查找栏", true);
check("内置英文面板已隐藏", (await page.locator(".cm-panel.cm-search:visible").count()) === 0);

await page.locator(".findbar-input").first().fill("cat");
await page.waitForTimeout(300);
const countText = await page.locator(".findbar-count").innerText();
check("计数显示（不区分大小写 5 处）", countText.includes("/ 5"), countText);
check("编辑器内高亮全部命中", (await page.locator(".cm-search-hit").count()) === 5);
check("当前命中单独标色", (await page.locator(".cm-search-hit-current").count()) === 1);

// 下一处
await page.locator(".findbar-input").first().focus();
await page.keyboard.press("Enter");
await page.waitForTimeout(250);
const after = await page.locator(".findbar-count").innerText();
check("回车跳到下一处（1 → 2）", after.includes("2 / 5"), after);
await page.locator('.findbar-btn[title*="下一处"]').click();
await page.waitForTimeout(250);
const after2 = await page.locator(".findbar-count").innerText();
check("↓ 按钮继续下一处（2 → 3）", after2.includes("3 / 5"), after2);

// 区分大小写
await page.locator(".findbar-toggles button", { hasText: "Aa" }).click();
await page.waitForTimeout(200);
const cs = await page.locator(".findbar-count").innerText();
check("区分大小写后变 4 处", cs.includes("/ 4"), cs);

// 全字匹配
await page.locator(".findbar-toggles button", { hasText: "ab" }).click();
await page.waitForTimeout(200);
const ww = await page.locator(".findbar-count").innerText();
check("全字匹配排除 concat → 3 处", ww.includes("/ 3"), ww);

// 关闭全字、大小写，做替换
await page.locator(".findbar-toggles button", { hasText: "ab" }).click();
await page.locator(".findbar-toggles button", { hasText: "Aa" }).click();
await page.waitForTimeout(200);

const inputs = page.locator(".findbar-input");
await inputs.nth(1).fill("bird");
await page.locator(".findbar-btn", { hasText: "全部替换" }).click();
await page.waitForTimeout(300);
const docText = await page.locator(".cm-content").innerText();
check("全部替换生效", !docText.includes("cat") && docText.includes("bird"), docText.replace(/\n/g, " | "));

// 无结果标红
await inputs.first().fill("zzzz-not-exist");
await page.waitForTimeout(200);
check("无结果显示文案", (await page.locator(".findbar-count").innerText()).includes("无结果"));

// 非法正则提示
await page.locator(".findbar-toggles button", { hasText: ".*" }).click();
await inputs.first().fill("[abc");
await page.waitForTimeout(200);
check("非法正则提示", (await page.locator(".findbar-count").innerText()).includes("正则无效"));
await page.locator(".findbar-toggles button", { hasText: ".*" }).click();

// 跨文件夹页签（无文件夹时禁用）
const folderBtn = page.locator(".findbar-tabs button", { hasText: "在文件夹中" });
check("未选文件夹时跨文件夹页签禁用", await folderBtn.isDisabled());

// 模拟已选文件夹：设置 localStorage 后重载
await page.evaluate(() => {
  const k = Object.keys(localStorage).find((x) => x.includes("folder"));
  localStorage.setItem(k ?? "notepp.folder", JSON.stringify("/demo"));
  localStorage.setItem("notepp.folder", "/demo");
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".cm-content");
await page.keyboard.press("Control+f");
await page.waitForSelector(".findbar");
await page.locator(".findbar-input").first().fill("keyword");
const folderTab = page.locator(".findbar-tabs button", { hasText: "在文件夹中" });
const folderEnabled = !(await folderTab.isDisabled());
check("选文件夹后跨文件夹页签可用", folderEnabled);
if (folderEnabled) {
  await folderTab.click();
  await page.waitForTimeout(400);
  const head = await page.locator(".findbar-results-head").innerText();
  const groups = await page.locator(".findbar-group").count();
  const hits = await page.locator(".findbar-hit").count();
  check("跨文件夹结果显示条数", hits === 3, `命中 ${hits}`);
  check("跨文件夹结果按文件分组", groups === 2, `分组 ${groups}`);
  check("跨文件夹结果摘要正确", head.includes("3"), head);
}

// Esc 关闭
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
check("Esc 关闭查找栏", (await page.locator(".findbar").count()) === 0);

await browser.close();
await server.close();
const pass = results.filter((r) => r.ok).length;
console.log(`\n==== ${pass}/${results.length} 项通过 ====`);
process.exit(process.exitCode || 0);
