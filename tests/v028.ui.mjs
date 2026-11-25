/**
 * v0.28.0 验证：
 *  1. 变换菜单新增「去除空行」「增加空行」
 *  2. 文件夹树媒体右键「打开媒体（系统默认程序）」+ 悬停小预览（图片缩略图）
 *  3. AI 记住文件与位置：AI 动作/生图期间切换文件，结果写回原文件原位置
 *  4. 预览右侧贴边实时面板：编辑即刷新、全屏、打印归入预览
 */
import { chromium } from "/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs";
import { createServer } from "vite";

const results = [];
const check = (name, cond, extra = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) process.exitCode = 1;
};

const server = await createServer({ root: "/workspace/notepp", server: { port: 5248 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 940 } })).newPage();

await page.addInitScript(() => {
  window.__FS__ = {
    "/demo/a.txt": { content: "第一行\n第二行\n", mtime: 1 },
    "/demo/b.txt": { content: "乙文件内容\n", mtime: 1 },
    "/demo/media/pic.png": { content: "PNGDATA", mtime: 1 },
    "/demo/media/a.mp3": { content: "MP3DATA", mtime: 1 },
  };
  window.__openCalls = [];
  window.__AI_MODE__ = "ok";
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => cb,
    convertFileSrc: (p) => "asset://localhost/" + encodeURIComponent(p),
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
      if (cmd === "write_text_file") {
        const f = window.__FS__[args.path];
        if (f) f.content = args.req.content;
        return Promise.resolve(null);
      }
      if (cmd === "list_dir") {
        if (args.path === "/demo") return Promise.resolve([
          { name: "a.txt", path: "/demo/a.txt", is_dir: false },
          { name: "b.txt", path: "/demo/b.txt", is_dir: false },
          { name: "media", path: "/demo/media", is_dir: true },
        ]);
        if (args.path === "/demo/media") return Promise.resolve([
          { name: "pic.png", path: "/demo/media/pic.png", is_dir: false },
          { name: "a.mp3", path: "/demo/media/a.mp3", is_dir: false },
        ]);
        return Promise.resolve([]);
      }
      if (cmd === "path_is_dir") return Promise.resolve(args.path === "/demo" || args.path === "/demo/media");
      if (cmd === "open_path_default") { window.__openCalls.push(args.path); return Promise.resolve(null); }
      if (cmd === "ai_image") {
        return new Promise((res) => setTimeout(() => res({ urls: ["data:image/png;base64,AA"], model: "img-x" }), 600));
      }
      if (cmd === "save_image_b64") return Promise.resolve("media/ai-1.png");
      if (cmd === "plugin:event|listen") {
        window.__EV__ = window.__EV__ ?? {};
        (window.__EV__[args.event] ??= []).push(args.handler);
        return Promise.resolve(1);
      }
      if (cmd === "ai_chat_stream") {
        const id = args.id;
        return new Promise((res) => setTimeout(() => {
          for (const h of (window.__EV__ ?? {})["ai://chunk"] ?? []) h({ event: "ai://chunk", id: 0, payload: { id, delta: "润色后的第一行" } });
          for (const h of (window.__EV__ ?? {})["ai://done"] ?? []) h({ event: "ai://done", id: 0, payload: { id, model: "mock-m", tokens: 5 } });
          res(null);
        }, 900));
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
  localStorage.setItem("notepp.folder", "/demo");
  localStorage.setItem(
    "notepp.library",
    JSON.stringify([
      { path: "/demo/a.txt", name: "a.txt", category: null, favorite: false, lastOpened: 2, preview: "" },
      { path: "/demo/b.txt", name: "b.txt", category: null, favorite: false, lastOpened: 1, preview: "" },
    ])
  );
  localStorage.setItem(
    "notepp.ai",
    JSON.stringify({ active: "deepseek", providers: { deepseek: { apiKey: "sk-t", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", imgModel: "img-x" } } })
  );
});

const editorText = async () => await page.locator(".cm-content").innerText();

await page.goto("http://localhost:5248/", { waitUntil: "networkidle" });
await page.waitForTimeout(900);

// 打开 a.txt
const listBtn = page.locator(".menubar button", { hasText: "列表" }).first();
if (!(await listBtn.getAttribute("class"))?.includes("on")) await listBtn.click();
await page.waitForTimeout(200);
await page.locator(".file-row", { hasText: "a.txt" }).first().click();
await page.waitForTimeout(400);

// ---------- 1. 变换：去除空行 / 增加空行 ----------
await page.locator(".cm-content").click({ position: { x: 120, y: 20 } });
await page.keyboard.press("Control+A");
await page.keyboard.type("一\n\n二\n三\n");
await page.waitForTimeout(200);
// 去除空行
await page.locator(".menubar button", { hasText: "变换" }).first().click();
await page.waitForTimeout(200);
await page.locator(".transform-menu button", { hasText: "去除空行" }).click();
await page.waitForTimeout(250);
let t = await editorText();
check("去除空行生效", t.replace(/\n/g, "|") === "一|二|三", t.replace(/\n/g, "|"));
// 增加空行
await page.locator(".menubar button", { hasText: "变换" }).first().click();
await page.waitForTimeout(200);
await page.locator(".transform-menu button", { hasText: "增加空行" }).click();
await page.waitForTimeout(250);
t = await editorText();
check("增加空行生效（每行间一空行）", t.replace(/\n/g, "|") === "一|||二|||三", t.replace(/\n/g, "|"));
// 已有空行不重复加
await page.locator(".menubar button", { hasText: "变换" }).first().click();
await page.waitForTimeout(200);
await page.locator(".transform-menu button", { hasText: "增加空行" }).click();
await page.waitForTimeout(250);
t = await editorText();
check("已有空行不重复追加", t.replace(/\n/g, "|") === "一|||二|||三", t.replace(/\n/g, "|"));
// 还原内容
await page.locator(".cm-content").click({ position: { x: 120, y: 20 } });
await page.keyboard.press("Control+A");
await page.keyboard.type("第一行\n第二行\n");
await page.waitForTimeout(200);

// ---------- 2. 预览贴边实时 + 全屏 + 打印归入 ----------
check("菜单栏已无独立打印项", (await page.locator(".menubar button", { hasText: "打印" }).count()) === 0);
await page.locator(".menubar button", { hasText: "预览" }).first().click();
await page.waitForTimeout(400);
check("预览为右侧贴边面板", (await page.locator("aside.preview-side").count()) === 1);
check("预览含打印按钮", (await page.locator(".preview-side .preview-actions button", { hasText: "打印" }).count()) === 1);
check("预览含全屏按钮", (await page.locator(".preview-side .preview-actions button", { hasText: "全屏" }).count()) === 1);
// 实时刷新（预览面板贴边，编辑器点左侧区域）
await page.locator(".cm-content").click({ position: { x: 120, y: 20 } });
await page.keyboard.press("Control+End");
await page.keyboard.type("\n## 实时新增标题");
await page.waitForTimeout(500);
check("编辑后预览实时刷新", (await page.locator(".preview-side .markdown-body h2", { hasText: "实时新增标题" }).count()) === 1);
await page.locator(".preview-side .preview-actions button", { hasText: "全屏" }).click();
await page.waitForTimeout(200);
check("全屏类生效", (await page.locator("aside.preview-side.full").count()) === 1);
await page.locator(".preview-side .preview-actions button", { hasText: "还原" }).click();
await page.waitForTimeout(200);
check("退出全屏", (await page.locator("aside.preview-side.full").count()) === 0);
await page.locator(".preview-side .preview-actions button", { hasText: "关闭" }).click();
await page.waitForTimeout(200);
check("预览可关闭", (await page.locator(".preview-side").count()) === 0);

// ---------- 3. 文件夹树：媒体右键打开 + 悬停预览 ----------
await page.locator(".tree-item", { hasText: "media" }).first().click();
await page.waitForTimeout(500);
const treeItem = page.locator(".tree-item", { hasText: "pic.png" }).first();
check("media 目录展开后可见 pic.png", (await treeItem.count()) === 1);
await treeItem.click({ button: "right" });
await page.waitForTimeout(300);
const openMediaBtn = page.locator(".folder-context-menu button", { hasText: "打开媒体" });
check("媒体文件右键有打开媒体项", (await openMediaBtn.count()) === 1);
await openMediaBtn.click();
await page.waitForTimeout(300);
const opens = await page.evaluate(() => window.__openCalls);
check("点击后调 open_path_default", (opens ?? []).includes("/demo/media/pic.png"), JSON.stringify(opens));
// 悬停小预览（图片缩略图）
await treeItem.hover();
await page.waitForTimeout(600);
const pv = page.locator(".tree-hover-preview");
check("悬停出现小预览", (await pv.count()) === 1);
if ((await pv.count()) === 1) {
  const src = await pv.locator("img").getAttribute("src");
  check("预览为图片缩略图", !!src && decodeURIComponent(src).includes("/demo/media/pic.png"), `src=${src}`);
  const name = await pv.locator(".hp-name").innerText();
  check("预览显示文件名", name === "pic.png", name);
}
await page.mouse.move(700, 500);
await page.waitForTimeout(200);

// ---------- 4. 生图：期间切换文件，图片插回原文件原位置 ----------
await page.locator(".cm-content").click({ position: { x: 120, y: 20 } });
await page.keyboard.press("Control+End");
await page.waitForTimeout(150);
await page.locator(".menubar button", { hasText: "生图" }).first().click();
await page.waitForTimeout(300);
await page.locator(".modal.img-dialog textarea").fill("测试图片");
await page.locator(".img-dialog button", { hasText: "后台运行" }).click();
await page.waitForTimeout(150);
// 生成中切到 b.txt
await page.locator(".tree-item", { hasText: "b.txt" }).first().click();
await page.waitForTimeout(1200);
check("生成完成后自动切回 a.txt", (await page.locator(".tab.active .tab-name").innerText()) === "a.txt");
const aText = await editorText();
const imgWidget = page.locator(".cm-content .cm-media-img img").first();
const imgAlt = (await imgWidget.count()) === 1 ? (await imgWidget.getAttribute("alt") ?? "") : "";
check("图片插回 a.txt 末尾（原位置）", imgAlt.startsWith("ai-image-") && (await imgWidget.count()) === 1, `alt=${imgAlt} text=${aText.replace(/\n/g, "|").slice(-30)}`);
check("b.txt 未被污染", !(await page.evaluate(() => window.__FS__["/demo/b.txt"].content)).includes("ai-image"));
await page.waitForFunction(() => !document.querySelector(".statusbar .ai-pill"), null, { timeout: 9000 });
// 重新打开 a.txt（切回）再做 AI 替换测试
await page.locator(".tab", { hasText: "a.txt" }).first().click();
await page.waitForTimeout(400);

// ---------- 5. AI 动作：期间切换文件，替换回原文件原选区 ----------
// 在 a.txt 选中第一行
await page.locator(".cm-content").click({ position: { x: 120, y: 20 } });
await page.keyboard.press("Control+Home");
await page.keyboard.press("Shift+End");
await page.waitForTimeout(150);
await page.locator(".cm-content").click({ button: "right", position: { x: 120, y: 20 } });
await page.waitForTimeout(300);
await page.locator(".ai-menu button", { hasText: "润色改写" }).click();
await page.waitForTimeout(300);
check("AI 浮窗出现", (await page.locator(".modal.ai-result").count()) === 1);
await page.locator(".ai-result .icon-btn[title*='收起到后台']").click();
await page.waitForTimeout(200);
// 运行中切到 b.txt
await page.locator(".tree-item", { hasText: "b.txt" }).first().click();
await page.waitForTimeout(1100);
check("结果就绪 pill 出现", (await page.locator(".statusbar .ai-pill", { hasText: "结果就绪" }).count()) === 1);
await page.locator(".statusbar .ai-pill", { hasText: "结果就绪" }).click();
await page.waitForTimeout(300);
await page.locator(".modal.ai-result .modal-foot button", { hasText: "替换选中" }).click();
await page.waitForTimeout(500);
check("替换后自动切回 a.txt", (await page.locator(".tab.active .tab-name").innerText()) === "a.txt");
t = await editorText();
check("写回 a.txt 原第一行位置", t.startsWith("润色") && t.includes("第二行"), t.replace(/\n/g, "|"));
check("b.txt 未被污染（AI）", !(await page.evaluate(() => window.__FS__["/demo/b.txt"].content)).includes("润色"));

console.log(`\n===== v028: ${results.filter((r) => r.ok).length}/${results.length} PASS =====`);
await browser.close();
await server.close();
