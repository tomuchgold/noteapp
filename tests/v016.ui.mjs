/**
 * v0.16.0 验证：
 *  1. 菜单栏「变换」下拉：7 个变换项，转大写对选区生效
 *  2. 未打开文件夹时右键空白：只出现「打开文件夹…」（不出现「在系统中显示」，修复 null 报错）
 *  3. 打开文件夹后文件节点右键含「打开所在文件夹」
 *  4. 标签右键含「打开所在文件夹 / 在系统中显示」，打开所在文件夹会切目录树根
 *  5. 文件列表右键含「打开所在文件夹 / 在系统中显示」
 */
import { chromium } from "/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs";
import { createServer } from "vite";

const results = [];
const check = (name, cond, extra = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) process.exitCode = 1;
};

const server = await createServer({ root: "/workspace/notepp", server: { port: 5217 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 940 } })).newPage();

await page.addInitScript(() => {
  window.__DIRS__ = {
    "/demo": [{ name: "a.txt", path: "/demo/a.txt", is_dir: false }],
    "/other": [{ name: "b.txt", path: "/other/b.txt", is_dir: false }],
  };
  window.__FS__ = {
    "/demo/a.txt": { content: "hello world\n", mtime: 1 },
    "/other/b.txt": { content: "B\n", mtime: 2 },
  };
  window.__REVEALED__ = [];
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => cb,
    invoke: (cmd, args) => {
      if (cmd === "opened_urls") return Promise.resolve([]);
      if (cmd === "plugin:dialog|open" && (args?.options?.directory === true || args?.directory === true)) {
        return Promise.resolve("/demo");
      }
      if (cmd === "reveal_in_os") {
        window.__REVEALED__.push(args.path);
        return Promise.resolve(null);
      }
      if (cmd === "path_is_dir") return Promise.resolve(!!window.__DIRS__[args.path]);
      if (cmd === "list_dir") {
        const es = window.__DIRS__[args.path];
        return es ? Promise.resolve(es) : Promise.reject("no dir");
      }
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
  // 预置文件列表（库）：一条 /demo/a.txt
  localStorage.setItem(
    "notepp.library",
    JSON.stringify([{ path: "/demo/a.txt", name: "a.txt", category: null, favorite: false, lastOpened: 1, preview: "hello" }])
  );
});

const editorText = async () => await page.locator(".cm-content").innerText();

await page.goto("http://localhost:5217/", { waitUntil: "networkidle" });
await page.waitForTimeout(700);

// ---------- 1. 变换下拉 ----------
check("菜单栏有变换按钮", (await page.locator(".menubar button", { hasText: "变换" }).count()) > 0);
await page.locator(".menubar button", { hasText: "变换" }).click();
await page.waitForTimeout(120);
const tmItems = (await page.locator(".transform-menu button").allInnerTexts()).map((s) => s.trim());
check("变换菜单含 7 个功能项", tmItems.length === 7, JSON.stringify(tmItems));

// 选区转大写
await page.locator(".menubar button", { hasText: "打开" }).first().click();
await page.waitForTimeout(250);
// 从最近文件打开 a.txt（打开对话框被桩拦截不弹窗，用列表/库打开）
// 从库列表打开 a.txt（文件列表可能默认已开启，仅当未开启时点击）
const listBtn = page.locator(".menubar button", { hasText: "列表" }).first();
if (!(await listBtn.getAttribute("class"))?.includes("on")) await listBtn.click();
await page.waitForTimeout(200);
await page.locator(".file-row", { hasText: "a.txt" }).first().click();
await page.waitForTimeout(300);
check("a.txt 已打开", (await page.locator(".tab").count()) > 0 && (await editorText()).includes("hello world"));

const cm = page.locator(".cm-content");
const box = await cm.boundingBox();
// 选中第一行前 5 个字符（拖选）
await page.mouse.move(box.x + 8, box.y + 10);
await page.mouse.down();
await page.mouse.move(box.x + 45, box.y + 10);
await page.mouse.up();
await page.locator(".menubar button", { hasText: "变换" }).click();
await page.locator(".transform-menu button", { hasText: "转为大写" }).click();
await page.waitForTimeout(150);
const afterUpper = await editorText();
check("选区转大写生效", afterUpper.includes("HELLO"), JSON.stringify(afterUpper.slice(0, 30)));

// 行排序/去重在全文生效
await page.locator(".menubar button", { hasText: "变换" }).click();
await page.locator(".transform-menu button", { hasText: "转为小写" }).click();
await page.waitForTimeout(150);
check("无选中转小写作用于当前行", (await editorText()).includes("hello"), (await editorText()).slice(0, 30));

// ---------- 2. 未打开文件夹时右键空白 ----------
const hint = await page.locator(".folder-section .side-hint").first().boundingBox();
await page.mouse.click(hint.x + hint.width / 2, hint.y + hint.height / 2, { button: "right" });
await page.waitForTimeout(150);
const noRootItems = (await page.locator(".folder-context-menu button").allInnerTexts()).map((s) => s.trim());
check("未打开文件夹时菜单只有打开文件夹", noRootItems.length === 1 && noRootItems[0].includes("打开文件夹"), JSON.stringify(noRootItems));
await page.keyboard.press("Escape");

// ---------- 3. 打开文件夹后节点右键 ----------
await page.locator(".folder-section .folder-actions button", { hasText: "打开" }).click();
await page.waitForTimeout(400);
await page.locator(".tree-item", { hasText: "a.txt" }).click({ button: "right" });
await page.waitForTimeout(150);
const fileMenu = (await page.locator(".folder-context-menu button").allInnerTexts()).map((s) => s.trim());
check("文件节点右键含打开所在文件夹", fileMenu.some((s) => s.includes("打开所在文件夹")), JSON.stringify(fileMenu));
check("文件节点右键含在系统中显示", fileMenu.some((s) => s.includes("在系统中显示")));
await page.keyboard.press("Escape");

// ---------- 4. 标签右键 ----------
await page.locator(".tab", { hasText: "a.txt" }).click({ button: "right" });
await page.waitForTimeout(150);
const tabMenu = (await page.locator("#tab-context-menu button").allInnerTexts()).map((s) => s.trim());
check("标签右键含打开所在文件夹", tabMenu.some((s) => s.includes("打开所在文件夹")), JSON.stringify(tabMenu));
check("标签右键含在系统中显示", tabMenu.some((s) => s.includes("在系统中显示")));
// 点「打开所在文件夹」→ 目录树根切到 /demo（已是 /demo，验证不报错即可）
await page.locator("#tab-context-menu button", { hasText: "打开所在文件夹" }).click();
await page.waitForTimeout(300);
check("打开所在文件夹后目录树正常", (await page.locator(".tree-item", { hasText: "a.txt" }).count()) > 0);

// 在系统中显示（走 reveal_in_os 桩）
await page.locator(".tab", { hasText: "a.txt" }).click({ button: "right" });
await page.locator("#tab-context-menu button", { hasText: "在系统中显示" }).click();
await page.waitForTimeout(200);
const revealed = await page.evaluate(() => window.__REVEALED__);
check("在系统中显示调用 reveal_in_os", Array.isArray(revealed) && revealed.includes("/demo/a.txt"), JSON.stringify(revealed));

// ---------- 5. 文件列表右键 ----------
await page.locator(".file-row", { hasText: "a.txt" }).first().click({ button: "right" });
await page.waitForTimeout(150);
const flMenu = (await page.locator(".ctx-menu .ctx-item").allInnerTexts()).map((s) => s.trim());
check("文件列表右键含打开所在文件夹", flMenu.some((s) => s.includes("打开所在文件夹")), JSON.stringify(flMenu));
check("文件列表右键含在系统中显示", flMenu.some((s) => s.includes("在系统中显示")));
await page.locator(".ctx-menu .ctx-item", { hasText: "在系统中显示" }).click();
await page.waitForTimeout(150);
const revealed2 = await page.evaluate(() => window.__REVEALED__);
check("文件列表在系统中显示生效", revealed2.filter((p) => p === "/demo/a.txt").length >= 2);

console.log(`\n===== v016: ${results.filter((r) => r.ok).length}/${results.length} PASS =====`);
await browser.close();
await server.close();
