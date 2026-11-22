/**
 * v0.20.0 验证（文件夹树刷新增强）：
 *  1. 展开子文件夹后，树刷新（另存为到根目录）不再折叠，子文件夹内容同步刷新
 *  2. 新增「⟳ 刷新」按钮：外部新增文件后点击即可看到，展开状态保留
 *  3. 保存（另存为）到文件夹树目录内 → 自动刷新树
 */
import { chromium } from "/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs";
import { createServer } from "vite";

const results = [];
const check = (name, cond, extra = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) process.exitCode = 1;
};

const server = await createServer({ root: "/workspace/notepp", server: { port: 5229 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 940 } })).newPage();

await page.addInitScript(() => {
  window.__DIRS__ = {
    "/proj": [
      { name: "sub", path: "/proj/sub", is_dir: true },
      { name: "a.txt", path: "/proj/a.txt", is_dir: false },
    ],
    "/proj/sub": [{ name: "b.md", path: "/proj/sub/b.md", is_dir: false }],
  };
  window.__FS__ = { "/proj/a.txt": { content: "aaa\n", mtime: 1 } };
  window.__savedPaths = [];
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => cb,
    invoke: (cmd, args) => {
      if (cmd === "opened_urls") return Promise.resolve([]);
      if (cmd === "list_dir") {
        const d = window.__DIRS__[args.path];
        return d ? Promise.resolve(d) : Promise.reject("not found");
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
      if (cmd === "write_text_file") {
        window.__savedPaths.push(args.req.path);
        window.__FS__[args.req.path] = { content: args.req.content, mtime: 2 };
        // 同步父目录列表（模拟真实磁盘）
        const p = args.req.path;
        const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
        const dir = i > 0 ? p.slice(0, i) : "/";
        const name = p.slice(i + 1);
        if (window.__DIRS__[dir] && !window.__DIRS__[dir].some((e) => e.path === p)) {
          window.__DIRS__[dir] = [...window.__DIRS__[dir], { name, path: p, is_dir: false }];
        }
        return Promise.resolve(null);
      }
      if (cmd === "plugin:dialog|save") return Promise.resolve("/proj/新文档.md");
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
  // 预置文件夹树根目录
  localStorage.setItem("notepp.folder", "/proj");
});

await page.goto("http://localhost:5229/", { waitUntil: "networkidle" });
await page.waitForTimeout(700);

// 树已显示根目录内容
check("文件夹树显示根目录", (await page.locator(".tree-item", { hasText: "a.txt" }).count()) === 1);

// ---------- 1. 展开子文件夹 ----------
await page.locator(".tree-item", { hasText: "sub" }).first().click();
await page.waitForTimeout(300);
check("子文件夹展开显示 b.md", (await page.locator(".tree-item", { hasText: "b.md" }).count()) === 1);

// ---------- 3. 新建空白文档并另存为到 /proj → 树自动刷新且不折叠 ----------
await page.locator(".menubar button", { hasText: "新建" }).first().click();
await page.waitForTimeout(200);
await page.evaluate(() => {
  // 写入一些内容以便保存
  const cm = document.querySelector(".cm-content");
  if (cm) cm.focus();
});
await page.keyboard.type("saved content");
await page.locator(".menubar button", { hasText: "保存" }).first().click();
await page.waitForTimeout(500);
check("另存为已写入 /proj/新文档.md", (await page.evaluate(() => window.__savedPaths)).includes("/proj/新文档.md"));
check("保存后树自动刷新出新文档", (await page.locator(".tree-item", { hasText: "新文档.md" }).count()) === 1);
check("刷新后子文件夹仍展开", (await page.locator(".tree-item", { hasText: "b.md" }).count()) === 1);

// ---------- 2. 外部新增文件 → ⟳ 手动刷新可见且展开保留 ----------
await page.evaluate(() => {
  window.__DIRS__["/proj"] = [
    { name: "sub", path: "/proj/sub", is_dir: true },
    { name: "a.txt", path: "/proj/a.txt", is_dir: false },
    { name: "外部新增.txt", path: "/proj/外部新增.txt", is_dir: false },
  ];
});
check("刷新前看不到外部新增文件", (await page.locator(".tree-item", { hasText: "外部新增.txt" }).count()) === 0);
await page.locator(".folder-actions .mini[title*='刷新']").click();
await page.waitForTimeout(400);
check("⟳ 刷新后外部新增文件出现", (await page.locator(".tree-item", { hasText: "外部新增.txt" }).count()) === 1);
check("⟳ 刷新后子文件夹仍展开", (await page.locator(".tree-item", { hasText: "b.md" }).count()) === 1);

console.log(`\n===== v020: ${results.filter((r) => r.ok).length}/${results.length} PASS =====`);
await browser.close();
await server.close();
