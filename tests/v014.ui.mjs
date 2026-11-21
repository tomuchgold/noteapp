/**
 * v0.14.0 验证：
 *  1. 新入口：时间/注释/片段/快捷键，以及设置里的快捷键入口
 *  2. 片段：Tab 展开、添加、JSON 导出、快捷键绑定与冲突提示、快捷键插入
 *  3. 宏：绑定快捷键并回放
 *  4. 自定义内置快捷键：修改日期时间快捷键并生效
 *  5. 快捷插入：日期时间、注释、表格
 *  6. 全部替换：逐条预览、取消勾选后按勾选执行
 */
import { chromium } from "/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs";
import { createServer } from "vite";
import { readFileSync } from "node:fs";

const results = [];
const check = (name, cond, extra = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) process.exitCode = 1;
};

const TEXT = "apple\nApple\napples\nkeep\n";
const server = await createServer({ root: "/workspace/notepp", server: { port: 5214 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 940 } })).newPage();

await page.addInitScript((txt) => {
  window.__FS__ = { "/demo/v14.txt": { content: txt, mtime: 100 } };
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => cb,
    invoke: (cmd, args) => {
      if (cmd === "plugin:dialog|open") return Promise.resolve(["/demo/v14.txt"]);
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

const editorText = async () =>
  (await page.locator(".cm-content").innerText()).replace(/\u00a0/g, " ");

const openDemo = async () => {
  await page.keyboard.press("Control+o");
  await page.waitForTimeout(260);
};

await page.goto("http://localhost:5214/", { waitUntil: "networkidle" });
await page.waitForSelector(".cm-content");

// 预置片段与宏；setItem 在首次渲染后执行，再 reload 让 React 读取到
await page.evaluate(() => {
  localStorage.setItem("notepp.snippets.seeded", "1");
  localStorage.setItem("notepp.snippets", JSON.stringify([
    { id: "s_date", abbr: "sig", name: "日期签名", body: "SIG-${DATE}", createdAt: 1 },
  ]));
  localStorage.setItem("notepp.saved-macros", JSON.stringify([
    { id: "m_test", name: "测试宏", items: [{ type: "text", text: "MACRO!" }], createdAt: 1 },
  ]));
  localStorage.removeItem("notepp.session");
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".cm-content");
await openDemo();
check("测试文件已打开", (await editorText()).includes("apple"));

// ---------- 1. 新入口 ----------
const menuNames = await page.locator(".menubar button").allInnerTexts();
for (const name of ["时间", "注释", "片段", "快捷键"]) {
  check(`菜单栏含「${name}」入口`, menuNames.some((n) => n.includes(name)));
}

await page.locator(".menubar button", { hasText: "设置" }).click();
await page.waitForSelector(".modal.settings");
const settingShortcutRow = page.locator(".modal.settings .setting-row", { hasText: "快捷键" });
check("设置弹窗含快捷键入口", (await settingShortcutRow.count()) >= 1);
await settingShortcutRow.locator("button").click();
await page.waitForSelector(".keymap-modal");
check("从设置可打开快捷键弹窗", (await page.locator(".keymap-modal").count()) === 1);
await page.locator(".keymap-modal .modal-actions button.primary", { hasText: "完成" }).click();
await page.waitForTimeout(100);

// ---------- 2. 片段 ----------
await page.locator(".cm-content").click();
await page.keyboard.press("Control+End");
await page.keyboard.press("Enter");
await page.keyboard.type("sig");
await page.keyboard.press("Tab");
await page.waitForTimeout(150);
check("输入片段缩写 + Tab 展开（含日期占位符）", /SIG-\d{4}-\d{2}-\d{2}/.test(await editorText()));

await page.locator(".menubar button", { hasText: "片段" }).click();
await page.waitForSelector(".snippet-modal");
await page.locator('.snippet-editor input[placeholder*="todo"]').fill("hello");
await page.locator('.snippet-editor input[placeholder*="待办项"]').fill("问候");
await page.locator(".snippet-editor textarea").fill("HELLO-${TIME}");
await page.locator(".snippet-editor-actions button.primary", { hasText: "添加片段" }).click();
await page.waitForTimeout(150);
const snippetStore = await page.evaluate(() => JSON.parse(localStorage.getItem("notepp.snippets") || "[]"));
check("片段已添加到 localStorage", snippetStore.some((s) => s.abbr === "hello" && s.body === "HELLO-${TIME}"));

const [snippetDownload] = await Promise.all([
  page.waitForEvent("download"),
  page.locator(".snippet-modal .macro-ops button", { hasText: "导出" }).click(),
]);
const snippetJson = readFileSync(await snippetDownload.path(), "utf-8");
check("片段 JSON 导出正确", snippetJson.includes("notepp-snippets") && snippetJson.includes("hello"));

// 从片段项打开快捷键设置，先撞键再成功绑定
const helloItem = page.locator(".snippet-list .macro-item", { hasText: "hello" });
await helloItem.locator(".macro-item-btns button").first().click();
await page.waitForSelector(".keymap-modal");
check("从片段项可直接定位到快捷键录制", (await page.locator(".keymap-recording").count()) === 1);
await page.keyboard.press("Control+Alt+d");
await page.waitForTimeout(120);
const conflictMsg = await page.locator(".keymap-msg").innerText().catch(() => "");
check("片段快捷键冲突被拦截", conflictMsg.includes("占用"), `msg=${conflictMsg}`);
await page.keyboard.press("Control+Alt+h");
await page.waitForTimeout(150);
const snippetBindings = await page.evaluate(() => JSON.parse(localStorage.getItem("notepp.snippet-bindings") || "{}"));
const helloId = snippetStore.find((s) => s.abbr === "hello")?.id;
check("片段快捷键已保存", snippetBindings[`snippet:${helloId}`] === "Ctrl+Alt+H", JSON.stringify(snippetBindings));
await page.locator(".keymap-modal .modal-actions button.primary", { hasText: "完成" }).click();
await page.locator(".snippet-modal .modal-actions button.primary", { hasText: "完成" }).click();
await page.waitForTimeout(120);

await page.locator(".cm-content").click();
await page.keyboard.press("Control+Alt+h");
await page.waitForTimeout(150);
check("片段快捷键可插入内容", /HELLO-\d{2}:\d{2}:\d{2}/.test(await editorText()));

// ---------- 3. 宏快捷键 ----------
await page.locator(".menubar button", { hasText: "宏管理" }).click();
await page.waitForSelector(".macro-modal");
await page.locator(".macro-modal .macro-item", { hasText: "测试宏" }).locator(".macro-item-btns button").first().click();
await page.waitForSelector(".keymap-modal");
await page.keyboard.press("Control+Alt+m");
await page.waitForTimeout(150);
const macroBindings = await page.evaluate(() => JSON.parse(localStorage.getItem("notepp.keymap-bindings") || "{}"));
check("宏快捷键已保存", macroBindings["macro:m_test"] === "Ctrl+Alt+M", JSON.stringify(macroBindings));
await page.locator(".keymap-modal .modal-actions button.primary", { hasText: "完成" }).click();
await page.locator(".macro-modal .modal-actions button.primary", { hasText: "完成" }).click();
await page.waitForTimeout(100);
await page.locator(".cm-content").click();
await page.keyboard.press("Control+Alt+m");
await page.waitForTimeout(150);
check("宏快捷键可回放宏", (await editorText()).includes("MACRO!"));

// ---------- 4. 自定义内置快捷键 ----------
await page.locator(".menubar button", { hasText: "快捷键" }).click();
await page.waitForSelector(".keymap-modal");
await page.locator(".keymap-toolbar input").fill("插入当前日期时间");
const dateRow = page.locator(".keymap-row", { hasText: "插入当前日期时间" });
check("快捷键列表可搜索内置命令", (await dateRow.count()) === 1);
await dateRow.locator("button", { hasText: "设置" }).click();
await page.keyboard.press("Control+Alt+g");
await page.waitForTimeout(150);
const builtinBindings = await page.evaluate(() => JSON.parse(localStorage.getItem("notepp.keymap-bindings") || "{}"));
check("内置命令快捷键可自定义", builtinBindings["insert-datetime"] === "Ctrl+Alt+G", JSON.stringify(builtinBindings));
await page.locator(".keymap-modal .modal-actions button.primary", { hasText: "完成" }).click();
await page.waitForTimeout(100);
await page.locator(".cm-content").click();
const beforeDate = await editorText();
await page.keyboard.press("Control+Alt+g");
await page.waitForTimeout(150);
const afterDate = await editorText();
check("自定义快捷键生效", afterDate.length > beforeDate.length && /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(afterDate));

// ---------- 5. 快捷插入 ----------
await page.keyboard.press("Control+Alt+c");
await page.waitForTimeout(150);
check("注释快捷键按文件类型插入", (await editorText()).includes("<!-- 注释内容 -->"));
await page.keyboard.press("Control+Alt+t");
await page.waitForSelector(".table-rows-cols");
check("表格快捷键打开插入表格弹窗", (await page.locator(".table-rows-cols").count()) === 1);
await page.locator(".modal-actions button", { hasText: "取消" }).click();
await page.waitForTimeout(100);

// ---------- 6. 全部替换逐条预览 ----------
await page.evaluate(() => localStorage.removeItem("notepp.session"));
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".cm-content");
await openDemo();
check("替换测试文件已重新打开", (await editorText()).startsWith("apple"));

await page.keyboard.press("Control+f");
await page.waitForSelector(".findbar-input");
await page.locator('.findbar-input[data-role="query"]').fill("apple");
await page.waitForTimeout(180);
await page.locator('.findbar-input[data-role="replace"]').fill("ORANGE");
await page.locator('.findbar button[title*="逐条预览"]').click();
await page.waitForSelector(".replace-preview-modal");
check("全部替换打开逐条预览", (await page.locator(".rp-item").count()) === 3, `items=${await page.locator(".rp-item").count()}`);
await page.locator(".rp-item").nth(2).locator('input[type="checkbox"]').uncheck();
const confirmText = await page.locator(".replace-preview-modal .modal-actions button.primary").innerText();
check("预览按钮显示勾选数量", confirmText.includes("2"), `btn=${confirmText}`);
await page.locator(".replace-preview-modal .modal-actions button.primary").click();
await page.waitForTimeout(180);
const replaced = await editorText();
const orangeCount = (replaced.match(/ORANGE/g) || []).length;
const appleLeft = (replaced.match(/apple/gi) || []).length;
check("只执行勾选的替换项", orangeCount === 2 && appleLeft === 1, `ORANGE=${orangeCount}, apple=${appleLeft}`);

await browser.close();
await server.close();
const pass = results.filter((r) => r.ok).length;
console.log(`\n==== ${pass}/${results.length} 通过 ====`);
if (pass !== results.length) process.exit(1);
