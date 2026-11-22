/**
 * v0.18.0 验证：
 *  1. 编辑器内渲染图片缩略图 / 音频播放控件 / 视频播放控件（光标所在行显示原文）
 *  2. 菜单栏「🖼️ 媒体」按钮：选文件后按归档策略插入引用
 *  3. 右键编辑区（无选区）出现「插入媒体/附件…」入口
 *  4. 设置出现「媒体归档」选择（自动归档/相对引用）与「内嵌媒体渲染」开关；
 *     切到相对引用后插入不再复制文件，引用为相对路径
 */
import { chromium } from "/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs";
import { createServer } from "vite";

const results = [];
const check = (name, cond, extra = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) process.exitCode = 1;
};

const server = await createServer({ root: "/workspace/notepp", server: { port: 5219 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 940 } })).newPage();

await page.addInitScript(() => {
  window.__invoked = [];
  window.__copied = [];
  window.__FS__ = {
    "/demo/note.md": {
      content: "![pic](media/pic.png)\n[audio](media/song.mp3)\n<video controls width=\"480\" src=\"media/clip.mp4\"></video>\nend\n",
      mtime: 1,
    },
  };
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => cb,
    convertFileSrc: (p) => "http://asset.localhost/" + encodeURIComponent(p),
    invoke: (cmd, args) => {
      window.__invoked.push(cmd + ":" + JSON.stringify(args ?? {}));
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
      if (cmd === "copy_media_file") {
        const name = (args.src || "").split(/[\\/]/).pop() || "file";
        window.__copied.push(args.src);
        return Promise.resolve("media/" + name);
      }
      if (cmd === "plugin:dialog|open") {
        return Promise.resolve(window.__dialogResult ?? null);
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
    JSON.stringify([{ path: "/demo/note.md", name: "note.md", category: null, favorite: false, lastOpened: 1, preview: "media" }])
  );
});

const editorText = async () => await page.locator(".cm-content").innerText();

await page.goto("http://localhost:5219/", { waitUntil: "networkidle" });
await page.waitForTimeout(700);

// 打开 note.md（列表可能默认已开，确保处于打开状态）
const listBtn = page.locator(".menubar button", { hasText: "列表" }).first();
if (!(await listBtn.getAttribute("class"))?.includes("on")) await listBtn.click();
await page.waitForTimeout(300);
await page.locator(".file-row", { hasText: "note.md" }).first().click();
await page.waitForTimeout(400);
check("note.md 已打开", (await page.locator(".cm-content").count()) === 1);

// ---------- 1. 内嵌媒体渲染 ----------
// 光标默认在第 1 行（图片行按设计显示原文），先移到文档末尾再断言渲染
await page.locator(".cm-content").click();
await page.keyboard.press("Control+End");
await page.waitForTimeout(200);
const imgs = page.locator(".cm-content .cm-media-img img");
check("图片引用渲染为缩略图", (await imgs.count()) === 1);
check("缩略图经 asset 协议解析", ((await imgs.first().getAttribute("src")) || "").includes("asset.localhost"));
check("音频引用渲染为播放控件", (await page.locator(".cm-content .cm-media-audio audio").count()) === 1);
check("video 标签渲染为播放控件", (await page.locator(".cm-content .cm-media-video video").count()) === 1);
const raw = await editorText();
check("渲染后原文被替换", !raw.includes("![pic]") && !raw.includes("<video"), "");

// 光标进入图片行 → 恢复原文显示
await page.locator(".cm-content").click();
await page.keyboard.press("Control+Home");
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(150);
check("音频行光标进入后显示原文", (await editorText()).includes("[audio](media/song.mp3)"));
check("光标行音频控件消失", (await page.locator(".cm-content .cm-media-audio audio").count()) === 0);

// ---------- 2. 菜单栏「媒体」插入（自动归档模式） ----------
await page.keyboard.press("Control+End");
await page.evaluate(() => {
  window.__copied = [];
  window.__dialogResult = ["/media/photo1.png"];
});
await page.locator(".menubar button", { hasText: "媒体" }).first().click();
await page.waitForTimeout(400);
const copied = await page.evaluate(() => window.__copied);
check("自动归档模式复制了媒体文件", (await page.evaluate(() => window.__copied.length)) === 1, JSON.stringify(copied));
const txt1 = await editorText();
check("插入图片引用 ![]", txt1.includes("![photo1](media/photo1.png)"), "");

// ---------- 3. 右键插入入口 ----------
await page.evaluate(() => {
  window.__dialogResult = ["/media/clip2.mp4"];
});
const box = await page.locator(".cm-content").boundingBox();
await page.mouse.click(box.x + 60, box.y + 10, { button: "right" });
await page.waitForTimeout(200);
const menuVisible = await page.locator(".ai-menu").isVisible().catch(() => false);
check("无选区右键弹出插入菜单", menuVisible);
check("插入菜单含「插入媒体」", (await page.locator(".ai-menu button", { hasText: "插入媒体" }).count()) === 1);
await page.locator(".ai-menu button", { hasText: "插入媒体" }).click();
await page.waitForTimeout(400);
// 插入的视频引用在光标行之外会渲染为播放控件 → video 控件应有 2 个（原有 clip.mp4 + 新插入 clip2.mp4）
check("右键插入视频引用（渲染为第 2 个播放控件）", (await page.locator(".cm-content .cm-media-video video").count()) === 2);

// ---------- 4. 设置：媒体归档 + 内嵌渲染 ----------
await page.locator(".menubar button", { hasText: "设置" }).first().click();
await page.waitForSelector(".modal.settings");
const settingText = await page.locator(".modal.settings").innerText();
check("设置含「媒体归档」行", settingText.includes("媒体归档"));
check("设置含「内嵌媒体渲染」行", settingText.includes("内嵌媒体渲染"));
const mediaSelect = page.locator(".modal.settings .setting-row", { hasText: "媒体归档" }).locator("select");
await mediaSelect.selectOption("relative");
await page.waitForTimeout(150);
check("相对引用已持久化", await page.evaluate(() => {
  try { return JSON.parse(localStorage.getItem("notepp.editor-settings")).mediaMode === "relative"; } catch { return false; }
}));
// 关闭设置，再插入一次：不应复制，引用为相对路径
await page.locator(".modal.settings .modal-actions button.primary").click();
await page.waitForTimeout(200);
await page.evaluate(() => {
  window.__copied = [];
  window.__dialogResult = ["/media/photo2.png"];
});
await page.locator(".menubar button", { hasText: "媒体" }).first().click();
await page.waitForTimeout(400);
check("相对引用模式不再复制文件", (await page.evaluate(() => window.__copied.length)) === 0);
const txt3 = await editorText();
check("相对引用插入 ../ 路径", txt3.includes("![photo2](../media/photo2.png)"), "");

// 关闭内嵌渲染 → 全部显示原文
await page.locator(".menubar button", { hasText: "设置" }).first().click();
await page.waitForSelector(".modal.settings");
await page.locator(".modal.settings .setting-row", { hasText: "内嵌媒体渲染" }).locator("input[type=checkbox]").uncheck();
await page.waitForTimeout(150);
await page.locator(".modal.settings .modal-actions button.primary").click();
await page.waitForTimeout(250);
check("关闭渲染后图片显示原文", (await page.locator(".cm-content .cm-media-img").count()) === 0 && (await editorText()).includes("![pic](media/pic.png)"));

console.log(`\n===== v018: ${results.filter((r) => r.ok).length}/${results.length} PASS =====`);
await browser.close();
await server.close();
