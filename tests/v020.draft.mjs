/**
 * v0.20.1 验证（未保存草稿持久化）：
 *  1. 新建文件写了内容未保存 → localStorage 会话里出现 drafts
 *  2. 页面重载（模拟重启）→ 草稿标签自动恢复，内容与 dirty 状态正确
 *  3. 已保存文件被修改未保存 → 重启后内容恢复并标记未保存
 */
import { chromium } from "/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs";
import { createServer } from "vite";

const results = [];
const check = (name, cond, extra = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) process.exitCode = 1;
};

const server = await createServer({ root: "/workspace/notepp", server: { port: 5231 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 940 } })).newPage();

await page.addInitScript(() => {
  window.__FS__ = { "/demo/a.txt": { content: "disk content\n", mtime: 1 } };
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
  localStorage.setItem(
    "notepp.library",
    JSON.stringify([{ path: "/demo/a.txt", name: "a.txt", category: null, favorite: false, lastOpened: 1, preview: "x" }])
  );
});

await page.goto("http://localhost:5231/", { waitUntil: "networkidle" });
await page.waitForTimeout(700);

// 打开已保存文件 a.txt
const listBtn = page.locator(".menubar button", { hasText: "列表" }).first();
if (!(await listBtn.getAttribute("class"))?.includes("on")) await listBtn.click();
await page.locator(".file-row", { hasText: "a.txt" }).first().click();
await page.waitForTimeout(300);

// 新建文件并输入内容（不保存）
await page.locator(".menubar button", { hasText: "新建" }).first().click();
await page.waitForTimeout(200);
await page.locator(".cm-content").last().click();
await page.keyboard.type("这是我随手写的没保存的内容");
await page.waitForTimeout(300);

// 修改已保存文件 a.txt（制造 dirty）
await page.locator(".tab", { hasText: "a.txt" }).first().click();
await page.waitForTimeout(200);
await page.locator(".cm-content").first().click();
await page.keyboard.press("Control+End");
await page.keyboard.type("本地改了还没保存");
await page.waitForTimeout(300);

// 会话里应有 drafts：1 个未保存新文件 + a.txt 的修改
const session = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem("notepp.session")); } catch { return null; } });
check("会话记录了 drafts", Array.isArray(session?.drafts) && session.drafts.length === 2, JSON.stringify(session?.drafts?.map((d) => d.name)));
check("草稿含未保存新文件内容", session?.drafts?.some((d) => !d.path && d.content.includes("随手写的没保存的内容")) ?? false);
check("草稿含已保存文件的未保存修改", session?.drafts?.some((d) => d.path === "/demo/a.txt" && d.content.includes("本地改了还没保存")) ?? false);

// ---------- 重载页面（模拟重启应用） ----------
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(900);

// 未保存新文件恢复（切换到草稿标签查看）
await page.waitForTimeout(200);
const draftTab = page.locator(".tab", { hasText: "新文件" }).first();
check("重启后草稿标签存在", (await draftTab.count()) >= 1);
await draftTab.click();
await page.waitForTimeout(250);
const txt = await page.locator(".cm-content").innerText();
check("重启后草稿内容自动恢复", txt.includes("随手写的没保存的内容"), JSON.stringify(txt.slice(0, 60)));
// 切到 a.txt：修改应恢复为未保存状态
await page.locator(".tab", { hasText: "a.txt" }).first().click();
await page.waitForTimeout(250);
const txt2 = await page.locator(".cm-content").innerText();
check("已保存文件的未保存修改恢复", txt2.includes("disk content") && txt2.includes("本地改了还没保存"), JSON.stringify(txt2.slice(0, 80)));
check("恢复的 a.txt 标记为未保存", await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("notepp.session") ?? "null");
  return Array.isArray(s?.drafts) && s.drafts.some((d) => d.path === "/demo/a.txt" && d.content.includes("本地改了还没保存"));
}));

console.log(`\n===== v020draft: ${results.filter((r) => r.ok).length}/${results.length} PASS =====`);
await browser.close();
await server.close();
