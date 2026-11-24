/**
 * v0.27.0 验证：
 *  1. Markdown 预览解析相对路径媒体（此前 <img src="media/x.png"> 在 WebView 里指向应用内部地址而裂图）
 *  2. 侧栏「我的分类」右键重命名（与双击等效）
 *  3. AI 生图：方括号 alt 用英文 ai-image-时间戳；点生成立即关窗后台生成，状态栏显示进度/完成
 *  4. AI 结果面板非阻塞：▼ 收起到后台继续编辑，状态栏点击恢复；400 no available model instance 翻译成人话
 */
import { chromium } from "/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs";
import { createServer } from "vite";

const results = [];
const check = (name, cond, extra = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) process.exitCode = 1;
};

const server = await createServer({ root: "/workspace/notepp", server: { port: 5247 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 940 } })).newPage();

await page.addInitScript(() => {
  window.__FS__ = {
    "/demo/note.md": { content: "# 笔记\n\n![示意图](media/pic.png)\n\n正文内容写作者的日常。\n", mtime: 1 },
    "/demo/media/pic.png": { content: "PNGDATA", mtime: 1 },
  };
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
      if (cmd === "ai_image") {
        return new Promise((res) => setTimeout(() => res({ urls: ["data:image/png;base64,AA"], model: "img-x" }), 600));
      }
      if (cmd === "save_image_b64") return Promise.resolve("media/ai-1.png");
      if (cmd === "ai_chat_stream") {
        if (window.__AI_MODE__ === "fail400")
          return Promise.reject(
            'AI 调用失败：HTTP 400 {"error":{"message":"matched user group has no available model instance","type":"failed_precondition_error","code":"9"}}'
          );
        return new Promise((res) => setTimeout(() => res(null), 900));
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
    JSON.stringify([{ path: "/demo/note.md", name: "note.md", category: null, favorite: false, lastOpened: 1, preview: "" }])
  );
  localStorage.setItem(
    "notepp.ai",
    JSON.stringify({ active: "deepseek", providers: { deepseek: { apiKey: "sk-t", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", imgModel: "img-x" } } })
  );
});

const editorText = async () => await page.locator(".cm-content").innerText();

await page.goto("http://localhost:5247/", { waitUntil: "networkidle" });
await page.waitForTimeout(900);

// 打开 note.md
const listBtn = page.locator(".menubar button", { hasText: "列表" }).first();
if (!(await listBtn.getAttribute("class"))?.includes("on")) await listBtn.click();
await page.waitForTimeout(200);
await page.locator(".file-row", { hasText: "note.md" }).first().click();
await page.waitForTimeout(400);

// ---------- 1. 预览解析相对路径媒体 ----------
await page.locator(".menubar button", { hasText: "预览" }).first().click();
await page.waitForTimeout(500);
const imgSrc = await page.locator(".markdown-body img").first().getAttribute("src");
check("预览图片 src 经 convertFileSrc 解析", !!imgSrc && imgSrc.startsWith("asset://localhost/"), `src=${imgSrc}`);
check("预览图片 src 含文档目录+相对引用", !!imgSrc && decodeURIComponent(imgSrc).includes("/demo/media/pic.png"), `src=${decodeURIComponent(imgSrc ?? "")}`);
await page.locator(".preview-actions button", { hasText: "关闭" }).click();
await page.waitForTimeout(300);

// ---------- 2. 侧栏分类右键重命名 ----------
await page.locator(".sidebar-head .icon-btn").first().click();
await page.waitForTimeout(200);
await page.locator(".side-input").fill("工作");
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
check("新建分类成功", (await page.locator(".side-item", { hasText: "工作" }).count()) >= 1);
const catBtn = page.locator(".side-item", { hasText: "工作" }).first();
await catBtn.click({ button: "right" });
await page.waitForTimeout(300);
const renameInput = page.locator(".side-input-row .side-input");
check("右键分类进入重命名", (await renameInput.count()) === 1);
check("重命名输入框预填原名", (await renameInput.inputValue()) === "工作");
await renameInput.fill("工作笔记");
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
check("重命名生效", (await page.locator(".side-item", { hasText: "工作笔记" }).count()) >= 1);
const cats = await page.evaluate(() => {
  try { return JSON.parse(localStorage.getItem("notepp.categories")); } catch { return []; }
});
check("重命名已持久化", cats?.[0]?.name === "工作笔记", JSON.stringify(cats));

// ---------- 3. 生图：后台生成 + 英文 alt ----------
await page.keyboard.press("Control+End");
await page.locator(".menubar button", { hasText: "生图" }).first().click();
await page.waitForTimeout(300);
check("后台生成按钮出现", (await page.locator(".img-dialog button", { hasText: "后台运行" }).count()) === 1);
await page.locator(".modal.img-dialog textarea").fill("赛博朋克城市夜景");
await page.locator(".img-dialog button", { hasText: "后台运行" }).click();
await page.waitForTimeout(200);
check("点击生成后对话框立即关闭", (await page.locator(".modal.img-dialog").count()) === 0);
check("状态栏出现生图进度 pill", (await page.locator(".statusbar .ai-pill", { hasText: "生图生成中" }).count()) === 1);
await page.waitForTimeout(900);
// 插入行渲染为图片控件（innerText 不含原文），改断言控件 alt 为英文时间戳
const alts = await page.locator(".cm-media-img img").evaluateAll((els) => els.map((e) => e.getAttribute("alt") ?? ""));
check("生成完成插入英文 alt 引用", alts.some((a) => /^ai-image-\d{8}-\d{6}$/.test(a)), JSON.stringify(alts));
check("中文提示词不进入方括号", !alts.includes("赛博朋克城市夜景"));
check("完成 pill 提示已插入", (await page.locator(".statusbar .ai-pill", { hasText: "图片已插入" }).count()) === 1);
// 等「已插入」提示条消失（6s），避免它盖过后续 AI 状态 pill
await page.waitForFunction(() => !document.querySelector(".statusbar .ai-pill"), null, { timeout: 9000 });

// ---------- 4. AI 结果面板非阻塞 ----------
await page.locator(".cm-content").click();
await page.keyboard.press("Control+A");
await page.locator(".cm-content").click({ button: "right" });
await page.waitForTimeout(300);
await page.locator(".ai-menu button", { hasText: "解释这段内容" }).click();
await page.waitForTimeout(300);
check("AI 浮窗出现", (await page.locator(".modal.ai-result").count()) === 1);
const pe = await page.locator(".modal-mask.ai-float").evaluate((el) => getComputedStyle(el).pointerEvents);
check("浮窗遮罩不拦截点击（可继续编辑）", pe === "none", `pointer-events=${pe}`);
check("▼ 收起按钮存在", (await page.locator(".ai-result .icon-btn[title*='收起到后台']").count()) === 1);
await page.locator(".ai-result .icon-btn[title*='收起到后台']").click();
await page.waitForTimeout(200);
check("收起后浮窗隐藏", (await page.locator(".modal.ai-result").count()) === 0);
check("状态栏显示 AI 运行中", (await page.locator(".statusbar .ai-pill", { hasText: "运行中" }).count()) === 1);
// 收起期间继续编辑不受阻
await page.locator(".cm-content").click();
await page.keyboard.type("编辑不被阻塞");
await page.waitForTimeout(800);
check("状态栏变为结果就绪", (await page.locator(".statusbar .ai-pill", { hasText: "结果就绪" }).count()) === 1);
await page.locator(".statusbar .ai-pill", { hasText: "结果就绪" }).click();
await page.waitForTimeout(300);
check("点击 pill 恢复 AI 浮窗", (await page.locator(".modal.ai-result").count()) === 1);
await page.locator(".ai-result .icon-btn[title='关闭']").click();
await page.waitForTimeout(200);

// ---------- 5. 400 no available model instance 人话翻译 ----------
await page.evaluate(() => { window.__AI_MODE__ = "fail400"; });
await page.keyboard.press("Control+A");
await page.locator(".cm-content").click({ button: "right" });
await page.waitForTimeout(300);
await page.locator(".ai-menu button", { hasText: "提炼要点" }).click();
await page.waitForTimeout(500);
const errText = await page.locator(".modal.ai-result .msg.err").innerText().catch(() => "");
check("400 无可用模型实例翻译成人话", errText.includes("没有可用实例") && errText.includes("拉取模型列表"), errText.slice(0, 60));
await page.locator(".ai-result .icon-btn[title*='收起到后台']").click();
await page.waitForTimeout(200);
check("出错收起后状态栏显示出错", (await page.locator(".statusbar .ai-pill", { hasText: "出错" }).count()) === 1);
await page.locator(".statusbar .ai-pill", { hasText: "出错" }).click();
await page.waitForTimeout(200);
check("点击 pill 回到出错面板", (await page.locator(".modal.ai-result .msg.err").count()) === 1);

console.log(`\n===== v027: ${results.filter((r) => r.ok).length}/${results.length} PASS =====`);
await browser.close();
await server.close();
