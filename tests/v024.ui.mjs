/**
 * v0.24.0 验证（AI 体验三连修）：
 *  1. AI 设置可视化模型列表：预设可见、点选即用、手动添加、拉取后持久化
 *  2. 生图对话框：弹窗输入提示词（替代 WebView 不支持的 window.prompt）、空提示词报错、生成插入
 *  3. 友好报错：404 model not found → 人话提示（含解决办法）
 */
import { chromium } from "/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs";
import { createServer } from "vite";

const results = [];
const check = (name, cond, extra = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) process.exitCode = 1;
};

const server = await createServer({ root: "/workspace/notepp", server: { port: 5241 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 940 } })).newPage();

await page.addInitScript(() => {
  window.__FS__ = { "/demo/a.txt": { content: "写作者的日常\n第二行内容\n", mtime: 1 } };
  window.__imageCalls = [];
  window.__aiCalls = [];
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
      if (cmd === "ai_models") {
        return Promise.resolve(["model-alpha", "model-beta", "model-gamma", "model-delta"]);
      }
      if (cmd === "ai_image") {
        window.__imageCalls.push(args.req);
        return Promise.resolve({ urls: ["https://img.example.com/x.png"], model: args.req.model });
      }
      if (cmd === "ai_chat_stream") {
        window.__aiCalls.push(args.req);
        return Promise.reject("AI 调用失败：HTTP 404 {\"error\":{\"message\":\"model is not found\",\"type\":\"not_found_error\",\"code\":\"5\"}}");
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
    JSON.stringify([{ path: "/demo/a.txt", name: "a.txt", category: null, favorite: false, lastOpened: 1, preview: "" }])
  );
});

const editorText = async () => await page.locator(".cm-content").innerText();

await page.goto("http://localhost:5241/", { waitUntil: "networkidle" });
await page.waitForTimeout(700);

// 打开 a.txt
const listBtn = page.locator(".menubar button", { hasText: "列表" }).first();
if (!(await listBtn.getAttribute("class"))?.includes("on")) await listBtn.click();
await page.waitForTimeout(200);
await page.locator(".file-row", { hasText: "a.txt" }).first().click();
await page.waitForTimeout(300);

// ---------- 1. AI 设置可视化模型列表 ----------
await page.locator(".menubar button", { hasText: "AI" }).first().click();
await page.waitForTimeout(300);
const dlg = page.locator(".modal.ai-settings");
check("AI 设置打开", await dlg.isVisible().catch(() => false));
check("模型列表区块出现", (await page.locator(".modal.ai-settings .model-list").count()) === 1);
const presetChips = await page.locator(".modal.ai-settings .model-chip .model-pick").allTextContents();
check("预设模型以 chip 列出（deepseek-chat 等）", presetChips.some((t) => t.includes("deepseek-chat")), JSON.stringify(presetChips));
check("当前模型有 💬 标记", presetChips.some((t) => t.trim().startsWith("💬")), JSON.stringify(presetChips));

// 点选 chip → 输入框更新
await page.locator(".modal.ai-settings .model-chip .model-pick", { hasText: "deepseek-reasoner" }).click();
await page.waitForTimeout(150);
const mv = await page.locator(".modal.ai-settings input[list='ai-model-options']").inputValue();
check("点选 chip 后模型输入框更新", mv === "deepseek-reasoner", `v="${mv}"`);

// 拉取模型列表 → 可视化更新 + 持久化
await page.locator(".modal.ai-settings button", { hasText: "拉取模型列表" }).click();
await page.waitForTimeout(400);
const chipsAfter = await page.locator(".modal.ai-settings .model-chip .model-pick").allTextContents();
check("拉取后列表含新模型 model-alpha", chipsAfter.some((t) => t.includes("model-alpha")), JSON.stringify(chipsAfter));
await page.locator(".modal.ai-settings .model-chip .model-pick", { hasText: "model-beta" }).click();
await page.locator(".modal.ai-settings button", { hasText: "保存" }).first().click();
await page.waitForTimeout(250);
const saved = await page.evaluate(() => {
  try {
    return JSON.parse(localStorage.getItem("notepp.ai")).providers.deepseek;
  } catch { return null; }
});
check("拉取结果持久化到配置", (saved?.fetchedModels ?? []).includes("model-beta"), JSON.stringify(saved?.fetchedModels));
check("选用模型已保存", saved?.model === "model-beta", `v="${saved?.model}"`);

// 手动添加模型
await page.locator(".menubar button", { hasText: "AI" }).first().click();
await page.waitForTimeout(300);
await page.locator(".modal.ai-settings .model-add input").fill("my-custom-model-9b");
await page.locator(".modal.ai-settings .model-add button", { hasText: "添加并选用" }).click();
await page.waitForTimeout(200);
const chipsAdd = await page.locator(".modal.ai-settings .model-chip").allTextContents();
check("手动添加的模型出现在列表", chipsAdd.some((t) => t.includes("my-custom-model-9b")), JSON.stringify(chipsAdd));
const mv2 = await page.locator(".modal.ai-settings input[list='ai-model-options']").inputValue();
check("手动添加后自动选用", mv2 === "my-custom-model-9b", `v="${mv2}"`);
// 删除自定义模型
await page.locator(".modal.ai-settings .model-chip", { hasText: "my-custom-model-9b" }).locator(".model-del").click();
await page.waitForTimeout(150);
const chipsDel = await page.locator(".modal.ai-settings .model-chip").allTextContents();
check("删除自定义模型生效", !chipsDel.some((t) => t.includes("my-custom-model-9b")));
await page.locator(".modal.ai-settings .icon-btn").click();
await page.waitForTimeout(200);

// ---------- 2. 生图对话框 ----------
// 先配置生图模型（未配置时按钮走「提示+打开设置」分支）
await page.locator(".menubar button", { hasText: "AI" }).first().click();
await page.waitForTimeout(300);
await page.locator(".modal.ai-settings input[type=password]").first().fill("sk-test");
await page.locator(".modal.ai-settings input[list='ai-img-model-options']").fill("test-image-model");
await page.locator(".modal.ai-settings button", { hasText: "保存" }).first().click();
await page.waitForTimeout(250);
await page.evaluate(() => { window.__imageCalls = []; });
await page.locator(".menubar button", { hasText: "生图" }).first().click();
await page.waitForTimeout(300);
check("生图弹出对话框", await page.locator(".modal.img-dialog").isVisible().catch(() => false));
check("对话框含提示词输入框", (await page.locator(".modal.img-dialog textarea").count()) === 1);
check("对话框显示生图模型", (await page.locator(".modal.img-dialog .hint").innerText()).includes("生图模型"));
// 空提示词 → 按钮禁用（本身就是校验）
check("空提示词时生成按钮禁用", await page.locator(".modal.img-dialog button.primary").isDisabled());
// 填提示词生成
await page.locator(".modal.img-dialog textarea").fill("测试生图描述词");
await page.locator(".modal.img-dialog button", { hasText: "后台运行" }).click();
await page.waitForTimeout(600);
check("ai_image 已调用", (await page.evaluate(() => window.__imageCalls.length)) === 1);
check("生成后对话框关闭", !(await page.locator(".modal.img-dialog").isVisible().catch(() => false)));
// 插入发生在原光标处（文档开头）：第 1 行为空、第 2 行是图片引用
await page.locator(".cm-line").first().click();
await page.keyboard.press("Control+Home");
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(250);
check("图片引用插入（光标移到该行显示原文）", (await editorText()).includes("![ai-image-") && (await editorText()).includes("](https://img.example.com/x.png)"));

// ---------- 3. 友好报错（404 model not found） ----------
// 选中文本 → 右键 → AI 润色（选第 3 行正文，避开图片组件行）
await page.keyboard.press("Control+Home");
await page.keyboard.press("ArrowDown");
await page.keyboard.press("ArrowDown");
await page.keyboard.press("Shift+End");
await page.waitForTimeout(150);
await page.locator(".cm-line").nth(2).click({ button: "right" });
await page.waitForTimeout(250);
const polishBtn = page.locator("button", { hasText: "润色" }).first();
check("右键菜单含润色项", (await polishBtn.count()) >= 1);
await polishBtn.click();
await page.waitForTimeout(700);
const errText = await page.locator(".ai-panel .msg.err, .ai-job .error, [class*='ai'] .err").first().innerText().catch(() => "");
const anyErr = errText || (await page.locator(".modal, .panel, .drawer").filter({ hasText: "润色" }).first().innerText().catch(() => ""));
check("404 错误被翻译成人话", /不存在|拉取模型列表|解决办法/.test(anyErr), JSON.stringify(String(anyErr).slice(0, 120)));

console.log(`\n===== v024: ${results.filter((r) => r.ok).length}/${results.length} PASS =====`);
await browser.close();
await server.close();
