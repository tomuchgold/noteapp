/**
 * v0.17.0 验证：
 *  1. 选中文本后 Ctrl+F，查找框自动填入选中文字
 *  2. 标注面板有显眼「关闭」按钮，点击后面板消失
 *  3. 标注面板每条有 朗读/复制/粘贴 按钮；粘贴会把文本插入光标处
 *  4. 设置里出现「朗读引擎 / 试听」TTS 配置项
 */
import { chromium } from "/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs";
import { createServer } from "vite";

const results = [];
const check = (name, cond, extra = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) process.exitCode = 1;
};

const server = await createServer({ root: "/workspace/notepp", server: { port: 5218 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 940 } })).newPage();

await page.addInitScript(() => {
  window.__FS__ = { "/demo/a.txt": { content: "hello world\nsecond line\n", mtime: 1 } };
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
  // 预置文件库 + 一条标注
  localStorage.setItem(
    "notepp.library",
    JSON.stringify([{ path: "/demo/a.txt", name: "a.txt", category: null, favorite: false, lastOpened: 1, preview: "hello" }])
  );
  localStorage.setItem(
    "notepp.ann:/demo/a.txt",
    JSON.stringify([{ id: "ann1", from: 0, to: 5, text: "hello", kind: "highlight", note: "重点" }])
  );
});

const editorText = async () => await page.locator(".cm-content").innerText();

await page.goto("http://localhost:5218/", { waitUntil: "networkidle" });
await page.waitForTimeout(700);

// 打开 a.txt
await page.locator(".menubar button", { hasText: "列表" }).first().click();
const listBtn = page.locator(".menubar button", { hasText: "列表" }).first();
if (!(await listBtn.getAttribute("class"))?.includes("on")) await listBtn.click();
await page.waitForTimeout(200);
await page.locator(".file-row", { hasText: "a.txt" }).first().click();
await page.waitForTimeout(300);
check("a.txt 已打开", (await editorText()).includes("hello world"));

// ---------- 1. 选中文字后 Ctrl+F 自动带入 ----------
const cm = page.locator(".cm-content");
const box = await cm.boundingBox();
await page.mouse.move(box.x + 8, box.y + 10);
await page.mouse.down();
await page.mouse.move(box.x + 45, box.y + 10);
await page.mouse.up();
await page.waitForTimeout(120);
await page.keyboard.press("Control+f");
await page.waitForTimeout(250);
const findOpen = await page.locator(".findbar").isVisible().catch(() => false);
check("Ctrl+F 打开查找浮窗", findOpen);
const qval = await page.locator(".findbar input[type=text], .findbar input").first().inputValue().catch(() => "");
check("查找词自动带入选中文本", qval.trim() === "hello", `q="${qval}"`);
await page.keyboard.press("Escape");

// ---------- 2/3. 标注面板 ----------
await page.locator(".menubar button", { hasText: "标注" }).first().click();
await page.waitForTimeout(200);
check("标注面板打开", await page.locator(".anno-panel").isVisible());
check("标注面板有显眼关闭按钮", (await page.locator(".anno-panel-close", { hasText: "关闭" }).count()) === 1);
const item = page.locator(".anno-item", { hasText: "hello" }).first();
check("标注条目有朗读按钮", (await item.locator(".anno-op[title*=朗读]").count()) === 1);
check("标注条目有复制按钮", (await item.locator(".anno-op[title*=复制]").count()) === 1);
check("标注条目有粘贴按钮", (await item.locator(".anno-op[title*=插入]").count()) === 1);
// 粘贴：光标在文档末尾，点击粘贴 → 文档包含标注文本第二次出现
await page.locator(".cm-content").click();
await page.keyboard.press("Control+End");
await item.locator(".anno-op[title*=插入]").click();
await page.waitForTimeout(150);
const txt = await editorText();
check("粘贴把标注文本插入光标处", txt.includes("hello world\nsecond line\nhello"), JSON.stringify(txt.slice(-30)));

// 关闭面板
await page.locator(".anno-panel-close").click();
await page.waitForTimeout(150);
check("点击关闭按钮后面板消失", !(await page.locator(".anno-panel").isVisible().catch(() => false)));

// ---------- 4. 设置里的 TTS ----------
await page.locator(".menubar button", { hasText: "设置" }).first().click();
await page.waitForSelector(".modal.settings");
check("设置含朗读引擎选择", (await page.locator(".modal.settings select").count()) >= 1);
const settingText = await page.locator(".modal.settings").innerText();
check("设置含朗读引擎行", settingText.includes("朗读引擎"));
check("设置含试听与停止", settingText.includes("试听") && settingText.includes("停止"));
// 切换到 OpenAI 引擎应出现接口地址/Key 输入
await page.locator(".modal.settings .setting-row", { hasText: "朗读引擎" }).locator("select").selectOption("openai");
await page.waitForTimeout(150);
check("OpenAI 引擎出现接口配置", (await page.locator(".modal.settings input[type=password]").count()) >= 1);
check("TTS 配置已持久化", await page.evaluate(() => { try { return JSON.parse(localStorage.getItem("notepp.tts")).engine === "openai"; } catch { return false; } }));

console.log(`\n===== v017: ${results.filter((r) => r.ok).length}/${results.length} PASS =====`);
await browser.close();
await server.close();
