/**
 * v0.15.0 验证：
 *  1. 系统打开路径（文件关联冷启动兜底）：启动时自动打开 opened_urls 里的文件
 *  2. 打开文件夹后侧栏目录树正常
 *  3. 右键空白处：新建文件 / 新建文件夹 / 全部打开 / 切换文件夹 / 在系统中显示
 *  4. 新建文件（md 模板）并自动打开
 *  5. 新建文件夹并刷新树
 *  6. 节点右键：重命名（树同步）、删除（关闭对应标签）
 *  7. 全部打开：递归收集文本文件并批量开标签
 */
import { chromium } from "/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs";
import { createServer } from "vite";

const results = [];
const check = (name, cond, extra = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) process.exitCode = 1;
};

const server = await createServer({ root: "/workspace/notepp", server: { port: 5215 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 940 } })).newPage();

await page.addInitScript(() => {
  window.__DIRS__ = {
    "/demo": [
      { name: "src", path: "/demo/src", is_dir: true },
      { name: "a.txt", path: "/demo/a.txt", is_dir: false },
    ],
    "/demo/src": [
      { name: "inner.md", path: "/demo/src/inner.md", is_dir: false },
    ],
  };
  window.__FS__ = {
    "/demo/a.txt": { content: "AAA\n", mtime: 1 },
    "/demo/src/inner.md": { content: "INNER\n", mtime: 2 },
    "/demo/extra.txt": { content: "EXTRA\n", mtime: 3 },
  };
  // 文件关联冷启动兜底：启动时应自动打开 extra.txt
  window.__OPENED__ = ["/demo/extra.txt"];
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => cb,
    invoke: (cmd, args) => {
      if (cmd === "opened_urls") {
        const out = window.__OPENED__;
        window.__OPENED__ = [];
        return Promise.resolve(out);
      }
      if (cmd === "plugin:dialog|open" && (args?.options?.directory === true || args?.directory === true)) {
        return Promise.resolve("/demo");
      }
      if (cmd === "path_is_dir") return Promise.resolve(!!window.__DIRS__[args.path]);
      if (cmd === "list_dir") {
        const es = window.__DIRS__[args.path];
        return es ? Promise.resolve(es) : Promise.reject("no dir");
      }
      if (cmd === "make_dir") {
        window.__DIRS__[args.path] = [];
        const parent = args.path.slice(0, args.path.lastIndexOf("/"));
        const name = args.path.slice(args.path.lastIndexOf("/") + 1);
        if (window.__DIRS__[parent] && !window.__DIRS__[parent].some((e) => e.path === args.path)) {
          window.__DIRS__[parent].push({ name, path: args.path, is_dir: true });
        }
        return Promise.resolve(null);
      }
      if (cmd === "rename_path") {
        const { from, to } = args;
        const parent = from.slice(0, from.lastIndexOf("/"));
        const name = to.slice(to.lastIndexOf("/") + 1);
        window.__DIRS__[parent] = window.__DIRS__[parent].map((e) =>
          e.path === from ? { ...e, path: to, name } : e
        );
        if (window.__DIRS__[from]) {
          window.__DIRS__[to] = window.__DIRS__[from];
          delete window.__DIRS__[from];
        }
        if (window.__FS__[from]) {
          window.__FS__[to] = window.__FS__[from];
          delete window.__FS__[from];
        }
        return Promise.resolve(null);
      }
      if (cmd === "delete_path") {
        const parent = args.path.slice(0, args.path.lastIndexOf("/"));
        window.__DIRS__[parent] = window.__DIRS__[parent].filter((e) => e.path !== args.path);
        delete window.__FS__[args.path];
        return Promise.resolve(null);
      }
      if (cmd === "write_text_file") {
        window.__FS__[args.req.path] = { content: args.req.content, mtime: Date.now() };
        const parent = args.req.path.slice(0, args.req.path.lastIndexOf("/"));
        const name = args.req.path.slice(args.req.path.lastIndexOf("/") + 1);
        if (window.__DIRS__[parent] && !window.__DIRS__[parent].some((e) => e.path === args.req.path)) {
          window.__DIRS__[parent].push({ name, path: args.req.path, is_dir: false });
        }
        return Promise.resolve(null);
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
});

const treeItems = async () =>
  (await page.locator(".tree-item .side-label-text").allInnerTexts()).map((s) => s.trim());

const ctxMenuItems = async () =>
  (await page.locator(".folder-context-menu button").allInnerTexts()).map((s) => s.trim());

/** 在文件夹节区底部空白处右键（避开树节点） */
const blankRightClick = async () => {
  const box = await page.locator(".folder-section").boundingBox();
  await page.mouse.click(box.x + 30, box.y + box.height - 14, { button: "right" });
  await page.waitForSelector(".folder-context-menu");
};

const tabNames = async () =>
  (await page.locator(".tabbar .tab").allInnerTexts()).map((s) => s.trim());

await page.goto("http://localhost:5215/", { waitUntil: "networkidle" });
await page.waitForSelector(".cm-content");

// ---------- 1. 冷启动：系统传入的 extra.txt 自动打开 ----------
await page.waitForTimeout(500);
check("冷启动自动打开系统传入文件", (await tabNames()).some((n) => n.includes("extra.txt")), JSON.stringify(await tabNames()));

// ---------- 2. 打开文件夹 ----------
await page.locator(".folder-title .mini", { hasText: "打开" }).click();
await page.waitForTimeout(400);
const items = await treeItems();
check("目录树显示子目录与文件", items.includes("src") && items.includes("a.txt"), JSON.stringify(items));

// ---------- 3. 右键空白处 → 根目录菜单 ----------
await blankRightClick();
let menu = await ctxMenuItems();
for (const m of ["新建文件", "新建文件夹", "全部打开", "切换文件夹…", "在系统中显示"]) {
  check(`空白右键含「${m}」`, menu.includes(m), JSON.stringify(menu));
}
await page.keyboard.press("Escape");
await page.waitForTimeout(150);

// ---------- 4. 新建文件（md 模板）并自动打开 ----------
await blankRightClick();
page.once("dialog", (d) => d.accept("b.md"));
await page.locator(".folder-context-menu button", { hasText: "新建文件" }).first().click();
await page.waitForTimeout(500);
check("write_text_file 已调用（b.md 已创建）", !!(await page.evaluate(() => window.__FS__["/demo/b.md"])));
const mdTab = await page.locator(".cm-content").innerText();
check("新建 md 自动打开且含模板标题", mdTab.includes("# b"), `head=${mdTab.slice(0, 40)}`);
check("目录树刷新后含 b.md", (await treeItems()).includes("b.md"));

// ---------- 5. 新建文件夹 ----------
await blankRightClick();
page.once("dialog", (d) => d.accept("docs"));
await page.locator(".folder-context-menu button", { hasText: "新建文件夹" }).first().click();
await page.waitForTimeout(400);
check("目录树刷新后含 docs", (await treeItems()).includes("docs"));

// ---------- 6. 节点右键 a.txt → 重命名 ----------
await page.locator(".tree-item", { hasText: "a.txt" }).click({ button: "right" });
await page.waitForSelector(".folder-context-menu");
menu = await ctxMenuItems();
for (const m of ["打开", "在系统中显示", "重命名", "删除"]) {
  check(`文件右键含「${m}」`, menu.includes(m), JSON.stringify(menu));
}
page.once("dialog", (d) => d.accept("b2.txt"));
await page.locator(".folder-context-menu button", { hasText: "重命名" }).first().click();
await page.waitForTimeout(400);
check("重命名后目录树含 b2.txt", (await treeItems()).includes("b2.txt"));

// ---------- 7. 打开并删除 b2.txt，验证标签同步关闭 ----------
await page.locator(".tree-item", { hasText: "b2.txt" }).click();
await page.waitForTimeout(350);
const openedBefore = await page.locator(".tabbar .tab").count();
await page.locator(".tree-item", { hasText: "b2.txt" }).click({ button: "right" });
await page.waitForSelector(".folder-context-menu");
page.once("dialog", (d) => d.accept());
await page.locator(".folder-context-menu button", { hasText: "删除" }).first().click();
await page.waitForTimeout(500);
check("删除后文件移除", !(await page.evaluate(() => window.__FS__["/demo/b2.txt"])));
const openedAfter = await page.locator(".tabbar .tab").count();
check("删除后对应标签关闭", openedAfter < openedBefore, `before=${openedBefore}, after=${openedAfter}`);

// ---------- 8. 全部打开（递归收集）----------
await blankRightClick();
await page.locator(".folder-context-menu button", { hasText: "全部打开" }).first().click();
await page.waitForTimeout(700);
const names1 = (await tabNames()).join("|");
check("全部打开递归打开文本文件", names1.includes("a.txt") && names1.includes("inner.md"), names1);

await browser.close();
await server.close();
const pass = results.filter((r) => r.ok).length;
console.log(`\n==== ${pass}/${results.length} 通过 ====`);
if (pass !== results.length) process.exit(1);
