/**
 * v0.25.0 验证：
 *  1. 模型列表角色分工：💬 点选=对话模型、🖼 设为生图模型，互不干扰、保存持久化
 *  2. 生图提示词预填选中文字
 *  3. 生图 b64 落盘：data URL → save_image_b64 → media/ 相对引用插入；未保存文档给出提示
 */
import { chromium } from "/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs";
import { createServer } from "vite";

const results = [];
const check = (name, cond, extra = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) process.exitCode = 1;
};

const server = await createServer({ root: "/workspace/notepp", server: { port: 5245 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 940 } })).newPage();

await page.addInitScript(() => {
  window.__FS__ = { "/demo/a.txt": { content: "写作者的日常\n第二行内容\n", mtime: 1 } };
  window.__imageCalls = [];
  window.__saveB64Calls = [];
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
      if (cmd === "ai_models") return Promise.resolve(["chat-pro", "chat-lite", "vision-img", "img-xl"]);
      if (cmd === "ai_image") {
        window.__imageCalls.push(args.req);
        return Promise.resolve({ urls: ["data:image/png;base64,AAECAwQF"], model: args.req.model });
      }
      if (cmd === "save_image_b64") {
        window.__saveB64Calls.push(args);
        return Promise.resolve("media/ai-1763900000000.png");
      }
      if (cmd === "write_text_file") return Promise.resolve(null);
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

await page.goto("http://localhost:5245/", { waitUntil: "networkidle" });
await page.waitForTimeout(700);

// 打开 a.txt
const listBtn = page.locator(".menubar button", { hasText: "列表" }).first();
if (!(await listBtn.getAttribute("class"))?.includes("on")) await listBtn.click();
await page.waitForTimeout(200);
await page.locator(".file-row", { hasText: "a.txt" }).first().click();
await page.waitForTimeout(300);

// ---------- 1. 模型列表角色分工 ----------
await page.locator(".menubar button", { hasText: "AI" }).first().click();
await page.waitForTimeout(300);
await page.locator(".modal.ai-settings input[type=password]").first().fill("sk-test");
await page.locator(".modal.ai-settings button", { hasText: "拉取模型列表" }).click();
await page.waitForTimeout(400);
// 点选 chat-pro 为对话模型、img-xl 设为生图模型
await page.locator(".modal.ai-settings .model-chip .model-pick", { hasText: "chat-pro" }).click();
await page.locator(".modal.ai-settings .model-chip", { hasText: "img-xl" }).locator(".model-img").click();
await page.waitForTimeout(200);
const pickTxt = await page.locator(".modal.ai-settings .model-chip", { hasText: "img-xl" }).locator(".model-pick").innerText();
check("生图模型带 🖼 标记", pickTxt.includes("🖼"), pickTxt.trim());
await page.locator(".modal.ai-settings button", { hasText: "保存" }).first().click();
await page.waitForTimeout(250);
const saved = await page.evaluate(() => {
  try { return JSON.parse(localStorage.getItem("notepp.ai")).providers.deepseek; } catch { return null; }
});
check("对话模型=chat-pro", saved?.model === "chat-pro", `v="${saved?.model}"`);
check("生图模型=img-xl（同一家不同角色）", saved?.imgModel === "img-xl", `v="${saved?.imgModel}"`);

// ---------- 2. 生图提示词预填选中文字 ----------
// 选中文本第一行
await page.locator(".cm-line").first().click();
await page.keyboard.press("Control+Home");
await page.keyboard.press("Shift+End");
await page.waitForTimeout(150);
await page.locator(".menubar button", { hasText: "生图" }).first().click();
await page.waitForTimeout(300);
check("生图对话框打开", await page.locator(".modal.img-dialog").isVisible().catch(() => false));
const prefill = await page.locator(".modal.img-dialog textarea").inputValue();
check("提示词预填选中的文字", prefill === "写作者的日常", `v="${prefill}"`);

// ---------- 3. b64 落盘：data URL → media/ 相对引用 ----------
await page.evaluate(() => { window.__imageCalls = []; window.__saveB64Calls = []; });
await page.locator(".modal.img-dialog button", { hasText: "生成并插入" }).click();
await page.waitForTimeout(700);
check("ai_image 已调用", (await page.evaluate(() => window.__imageCalls.length)) === 1);
const saveCalls = await page.evaluate(() => window.__saveB64Calls);
check("b64 已落盘（save_image_b64 调用）", saveCalls.length === 1, JSON.stringify(saveCalls));
check("落盘扩展名为 png", saveCalls[0]?.ext === "png", `ext=${saveCalls[0]?.ext}`);
check("b64 已剥离 dataURL 前缀", saveCalls[0]?.b64 === "AAECAwQF", `b64=${saveCalls[0]?.b64}`);
check("对话框关闭", !(await page.locator(".modal.img-dialog").isVisible().catch(() => false)));
await page.locator(".cm-line").first().click();
await page.keyboard.press("Control+Home");
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(250);
check("插入相对引用 media/ai-xxx.png", (await editorText()).includes("![写作者的日常](media/ai-1763900000000.png)"));

// ---------- 4. 未保存文档：提示先保存而不是塞 base64 ----------
await page.locator(".menubar button", { hasText: "新建" }).first().click();
await page.waitForTimeout(300);
await page.evaluate(() => { window.__imageCalls = []; window.__saveB64Calls = []; });
await page.locator(".menubar button", { hasText: "生图" }).first().click();
await page.waitForTimeout(300);
await page.locator(".modal.img-dialog textarea").fill("测试未保存");
await page.locator(".modal.img-dialog button", { hasText: "生成并插入" }).click();
await page.waitForTimeout(600);
check("未保存时给出提示", (await page.locator(".modal.img-dialog .msg.err").innerText().catch(() => "")).includes("尚未保存"));
check("未保存时未落盘", (await page.evaluate(() => window.__saveB64Calls.length)) === 0);
check("未保存时未插入", !(await editorText()).includes("data:image"));

console.log(`\n===== v025: ${results.filter((r) => r.ok).length}/${results.length} PASS =====`);
await browser.close();
await server.close();
