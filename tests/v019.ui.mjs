/**
 * v0.19.0 验证：
 *  1. AI 设置出现「生图模型」字段（含 agnes 预设）
 *  2. 菜单栏「🎨 生图」按钮：未配置时提示并打开设置；配置后输入描述 → 调 ai_image → 光标处插入 ![描述](url)
 *  3. 未配置生图模型时不调用接口
 */
import { chromium } from "/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs";
import { createServer } from "vite";

const results = [];
const check = (name, cond, extra = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) process.exitCode = 1;
};

const server = await createServer({ root: "/workspace/notepp", server: { port: 5226 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 940 } })).newPage();

await page.addInitScript(() => {
  window.__FS__ = { "/demo/a.txt": { content: "hello\n", mtime: 1 } };
  window.__imageCalls = [];
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
      if (cmd === "ai_image") {
        window.__imageCalls.push(args.req);
        return Promise.resolve({ urls: ["https://img.example.com/cat.png"], model: args.req.model });
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
    JSON.stringify([{ path: "/demo/a.txt", name: "a.txt", category: null, favorite: false, lastOpened: 1, preview: "hello" }])
  );
});

const editorText = async () => await page.locator(".cm-content").innerText();

await page.goto("http://localhost:5226/", { waitUntil: "networkidle" });
await page.waitForTimeout(700);

// 打开 a.txt
const listBtn = page.locator(".menubar button", { hasText: "列表" }).first();
if (!(await listBtn.getAttribute("class"))?.includes("on")) await listBtn.click();
await page.waitForTimeout(200);
await page.locator(".file-row", { hasText: "a.txt" }).first().click();
await page.waitForTimeout(300);
check("a.txt 已打开", (await editorText()).includes("hello"));

// ---------- 2a. 未配置生图 → 提示并打开 AI 设置 ----------
let dialogMsg = "";
page.on("dialog", async (d) => {
  dialogMsg = d.message();
  await d.dismiss();
});
await page.locator(".menubar button", { hasText: "生图" }).first().click();
await page.waitForTimeout(300);
check("未配置时给出提示", dialogMsg.includes("尚未配置 AI 生图"), JSON.stringify(dialogMsg.slice(0, 40)));
check("提示后自动打开 AI 设置", await page.locator(".modal.ai-settings").isVisible().catch(() => false));

// ---------- 1. AI 设置含生图模型字段 ----------
const settingsText = await page.locator(".modal.ai-settings").innerText();
check("AI 设置含生图模型字段", settingsText.includes("生图模型"));
// 切到 Agnes 后应有预设 agnes-image-2.5-flash
await page.locator(".modal.ai-settings select").first().selectOption("agnes");
await page.waitForTimeout(150);
const imgModelVal = await page.locator(".modal.ai-settings input[list='ai-img-model-options']").inputValue();
check("Agnes 预设生图模型", imgModelVal === "agnes-image-2.5-flash", `v="${imgModelVal}"`);
// 填 Key 保存（修改草稿后确认）
await page.locator(".modal.ai-settings input[type=password]").fill("sk-test");
await page.locator(".modal.ai-settings .modal-foot button.primary, .modal.ai-settings button:has-text('保存')").first().click().catch(() => {});
await page.waitForTimeout(200);
check("AI 配置已保存", await page.evaluate(() => {
  try {
    const c = JSON.parse(localStorage.getItem("notepp.ai"));
    return c.active === "agnes" && (c.providers.agnes?.apiKey ?? "") === "sk-test";
  } catch { return false; }
}));
await page.keyboard.press("Escape");
await page.locator(".modal.ai-settings .icon-btn").click().catch(() => {});
await page.waitForTimeout(200);

// ---------- 2b. 配置后生图 → 对话框输入提示词 → 调 ai_image 并插入引用 ----------
await page.evaluate(() => { window.__imageCalls = []; });
await page.locator(".menubar button", { hasText: "生图" }).first().click();
await page.waitForTimeout(300);
check("生图弹出对话框（不再用 window.prompt）", await page.locator(".modal.img-dialog").isVisible().catch(() => false));
await page.locator(".modal.img-dialog textarea").fill("一只戴眼镜的小猫");
await page.locator(".modal.img-dialog button", { hasText: "后台运行" }).click();
await page.waitForTimeout(600);
const calls = await page.evaluate(() => window.__imageCalls);
check("已调用 ai_image", (await page.evaluate(() => window.__imageCalls.length)) === 1, JSON.stringify(calls));
check("生图模型正确传参", (await page.evaluate(() => window.__imageCalls[0]?.model)) === "agnes-image-2.5-flash");
check("提示词正确传参", (await page.evaluate(() => window.__imageCalls[0]?.prompt)) === "一只戴眼镜的小猫");
// 插入后引用被渲染为缩略图（光标不在该行）；先聚焦编辑区，再把光标移到图片行看原文
// 注意：打开文件时光标在文档开头，图片插入在光标处（第 2 行），Ctrl+End 后需上移两行
await page.locator(".cm-content").click();
await page.keyboard.press("Control+End");
await page.keyboard.press("ArrowUp");
await page.keyboard.press("ArrowUp");
await page.waitForTimeout(200);
const txt = await editorText();
check("光标处插入图片引用（原文可见）", txt.includes("![ai-image-") && txt.includes("](https://img.example.com/cat.png)"), JSON.stringify(txt.slice(-70)));

// ---------- 3. 光标移开后该行渲染为缩略图 ----------
await page.keyboard.press("Control+End");
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(250);
check("远程图片渲染为缩略图", (await page.locator(".cm-content .cm-media-img img[src*='img.example.com']").count()) === 1);

// 取消 prompt（输入空）不调用接口
await page.evaluate(() => {
  window.__imageCalls = [];
  window.prompt = () => "";
});
await page.locator(".menubar button", { hasText: "生图" }).first().click();
await page.waitForTimeout(300);
check("空描述不调用接口", (await page.evaluate(() => window.__imageCalls.length)) === 0);

console.log(`\n===== v019: ${results.filter((r) => r.ok).length}/${results.length} PASS =====`);
await browser.close();
await server.close();
