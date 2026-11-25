/**
 * v0.26.0 验证：
 *  1. 文件列表可关闭（× 按钮 → 隐藏 + 布局持久化）
 *  2. 侧栏文件库/文件夹树上下拖拽调高度（分割条 + 持久化 + 双击复位）
 *  3. txt 扩展名同样渲染图片/音频引用（按内容渲染，不看扩展名）
 *  4. 生图偏好 chips：一键追加「纯物品透明背景」等提示词
 */
import { chromium } from "/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs";
import { createServer } from "vite";

const results = [];
const check = (name, cond, extra = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) process.exitCode = 1;
};

const server = await createServer({ root: "/workspace/notepp", server: { port: 5246 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 940 } })).newPage();

await page.addInitScript(() => {
  window.__FS__ = {
    "/demo/note.txt": { content: "正文第一行\n![示意图](media/pic.png)\n<audio controls src=\"media/a.mp3\"></audio>\n", mtime: 1 },
    "/demo/media/pic.png": { content: "PNGDATA", mtime: 1 },
    "/demo/media/a.mp3": { content: "MP3DATA", mtime: 1 },
  };
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
      if (cmd === "list_dir") {
        if (args.path === "/demo") return Promise.resolve([{ name: "note.txt", path: "/demo/note.txt", is_dir: false }, { name: "media", path: "/demo/media", is_dir: true }]);
        if (args.path === "/demo/media") return Promise.resolve([{ name: "pic.png", path: "/demo/media/pic.png", is_dir: false }, { name: "a.mp3", path: "/demo/media/a.mp3", is_dir: false }]);
        return Promise.resolve([]);
      }
      if (cmd === "path_is_dir") return Promise.resolve(args.path === "/demo" || args.path === "/demo/media");
      if (cmd === "ai_image") return Promise.resolve({ urls: ["data:image/png;base64,AA"], model: "m" });
      if (cmd === "save_image_b64") return Promise.resolve("media/ai-1.png");
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
    JSON.stringify([{ path: "/demo/note.txt", name: "note.txt", category: null, favorite: false, lastOpened: 1, preview: "" }])
  );
  localStorage.setItem("notepp.folder-root", JSON.stringify("/demo"));
  localStorage.setItem("notepp.ai", JSON.stringify({ active: "deepseek", providers: { deepseek: { apiKey: "sk-t", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", imgModel: "img-x" } } }));
});

const editorText = async () => await page.locator(".cm-content").innerText();

await page.goto("http://localhost:5246/", { waitUntil: "networkidle" });
await page.waitForTimeout(900);

// 打开 note.txt（从文件夹树或列表）
const listBtn = page.locator(".menubar button", { hasText: "列表" }).first();
if (!(await listBtn.getAttribute("class"))?.includes("on")) await listBtn.click();
await page.waitForTimeout(200);
await page.locator(".file-row", { hasText: "note.txt" }).first().click();
await page.waitForTimeout(300);

// ---------- 1. 文件列表关闭按钮 ----------
check("文件列表关闭按钮存在", (await page.locator(".filelist-head .icon-btn[title='关闭文件列表']").count()) === 1);
await page.locator(".filelist-head .icon-btn[title='关闭文件列表']").click();
await page.waitForTimeout(300);
check("点击后文件列表隐藏", (await page.locator(".filelist").count()) === 0);
const lay = await page.evaluate(() => {
  try { return JSON.parse(localStorage.getItem("notepp.layout")); } catch { return null; }
});
check("关闭状态已持久化", lay?.filelistOpen === false, JSON.stringify(lay));
// 重新打开供后续测试
await listBtn.click();
await page.waitForTimeout(200);

// ---------- 2. 侧栏上下分割条 ----------
check("侧栏分割条存在", (await page.locator(".sidebar .vsplitter").count()) === 1);
const before = await page.locator(".sidebar-lib").evaluate((el) => el.offsetHeight);
// 模拟拖拽：mousedown → mousemove +150 → mouseup
const box = await page.locator(".sidebar .vsplitter").boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 150, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(300);
const after = await page.locator(".sidebar-lib").evaluate((el) => el.offsetHeight);
check("拖拽后文件库区变高", after > before + 100, `${before} -> ${after}`);
const lay2 = await page.evaluate(() => {
  try { return JSON.parse(localStorage.getItem("notepp.layout")); } catch { return null; }
});
check("高度已持久化", (lay2?.sidebarLibH ?? 0) >= 100, `v=${lay2?.sidebarLibH}`);
// 双击复位
await page.locator(".sidebar .vsplitter").dblclick();
await page.waitForTimeout(300);
const reset = await page.evaluate(() => {
  try { return JSON.parse(localStorage.getItem("notepp.layout")).sidebarLibH; } catch { return 0; }
});
check("双击复位为自适应", reset === 0, `v=${reset}`);

// ---------- 3. txt 也渲染媒体（光标停在第一行，图片/音频行自动渲染） ----------
await page.locator(".cm-line").first().click();
await page.keyboard.press("Control+Home");
await page.waitForTimeout(300);
check("txt 内图片引用渲染为缩略图", (await page.locator(".cm-media-img").count()) >= 1);
check("txt 内音频引用渲染为播放器", (await page.locator(".cm-media-audio").count()) >= 1);
// 光标移到图片行 → 该行显示原文便于编辑（光标所在行不替换是设计行为）
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(250);
check("光标移到图片行显示原文", (await editorText()).includes("![示意图](media/pic.png)"));

// ---------- 4. 生图偏好 chips ----------
await page.locator(".menubar button", { hasText: "生图" }).first().click();
await page.waitForTimeout(300);
check("生图偏好 chips 出现", (await page.locator(".img-pref-chip").count()) === 4);
await page.locator(".img-pref-chip", { hasText: "透明物品" }).click();
await page.waitForTimeout(150);
const pt = await page.locator(".modal.img-dialog textarea").inputValue();
check("点击 chip 追加透明背景提示词", pt.includes("纯物品，透明背景"), `v="${pt}"`);
await page.locator(".modal.img-dialog .icon-btn[title=\"关闭\"]").click();

console.log(`\n===== v026: ${results.filter((r) => r.ok).length}/${results.length} PASS =====`);
await browser.close();
await server.close();
