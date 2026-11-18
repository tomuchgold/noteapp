/**
 * v0.11.3 保存数据丢失 bug 复现/验证：
 *  场景：打开文件 → 等基线节拍 → 编辑 → 保存 → 立即再编辑 → 等监听节拍
 *  bug：保存后磁盘基线未更新，监听把「自己的保存」误判为外部修改，
 *       弹「重新加载（放弃我的修改）」→ 第二轮编辑丢失
 */
import { chromium } from "/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs";
import { createServer } from "vite";

const results = [];
const check = (name, cond, extra = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) process.exitCode = 1;
};

const server = await createServer({ root: "/workspace/notepp", server: { port: 5201 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();

await page.addInitScript(() => {
  window.__FS__ = {
    "/demo/a.txt": { content: "hello world\n", mtime: 100, size: 12 },
  };
  window.__mtime__ = 100;
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => cb,
    invoke: (cmd, args) => {
      if (cmd === "read_text_file") {
        const f = window.__FS__[args.path];
        if (!f) return Promise.reject("not found");
        return Promise.resolve({ content: f.content, encoding: "UTF-8", bom: false, eol: "LF", size: f.content.length });
      }
      if (cmd === "write_text_file") {
        const f = window.__FS__[args.req.path] ?? (window.__FS__[args.req.path] = {});
        f.content = args.req.content;
        f.size = f.content.length;
        f.mtime = ++window.__mtime__;
        return Promise.resolve(null);
      }
      if (cmd === "file_info") {
        const f = window.__FS__[args.path];
        if (!f) return Promise.reject("not found");
        return Promise.resolve({ size: f.size, mtime: f.mtime });
      }
      if (cmd === "plugin:dialog|open") return Promise.resolve(["/demo/a.txt"]);
      if (cmd === "list_dir") return Promise.resolve([]);
      return Promise.resolve(null);
    },
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
    unregisterListener: () => {},
    registerListener: () => {},
  };
  window.matchMedia =
    window.matchMedia ||
    (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
});
await page.goto("http://localhost:5201/", { waitUntil: "networkidle" });
await page.waitForSelector(".cm-content");

// ---------- 1. 打开文件，等一个节拍建立磁盘基线 ----------
await page.keyboard.press("Control+o");
await page.waitForTimeout(400);
check("文件已打开", (await page.locator(".tabbar .tab-name").allInnerTexts()).join("").includes("a.txt"));
await page.waitForTimeout(3400); // 基线 tick：/demo/a.txt → "12:100"

// ---------- 2. 编辑并保存 ----------
await page.locator(".cm-content").click();
await page.keyboard.press("Control+End");
await page.keyboard.type("FIRST-EDIT\n");
await page.waitForTimeout(200);
await page.locator(".menubar button", { hasText: "保存" }).first().click();
await page.waitForTimeout(400);
const afterSave1 = await page.evaluate(() => window.__FS__["/demo/a.txt"].content);
check("保存后磁盘含第一轮修改", afterSave1.includes("FIRST-EDIT"), JSON.stringify(afterSave1.slice(0, 60)));

// ---------- 3. 关键竞态：保存后立刻再编辑，等节拍 ----------
await page.locator(".cm-content").click();
await page.keyboard.press("Control+End");
await page.keyboard.type("SECOND-EDIT\n");
await page.waitForTimeout(3400); // 监听 tick
const promptShown = (await page.locator(".modal-mask").count()) > 0;
check("第二轮编辑不误判外部修改", !promptShown);
const stillThere = (await page.locator(".cm-content").innerText()).includes("SECOND-EDIT");
check("第二轮编辑仍在编辑器中", stillThere);

// 若弹了窗，模拟用户点「重新加载（放弃我的修改）」→ 复现丢数据
if (promptShown) {
  await page.locator(".modal-actions button", { hasText: "重新加载" }).click();
  await page.waitForTimeout(300);
  const lost = !(await page.locator(".cm-content").innerText()).includes("SECOND-EDIT");
  check("（bug 分支）重载后第二轮编辑丢失=已复现", lost);
}

// ---------- 4. 保存第二轮 → 关闭标签 → 重开 → 内容一致 ----------
await page.locator(".menubar button", { hasText: "保存" }).first().click();
await page.waitForTimeout(400);
const afterSave2 = await page.evaluate(() => window.__FS__["/demo/a.txt"].content);
check("二次保存磁盘含 SECOND-EDIT", afterSave2.includes("SECOND-EDIT"), JSON.stringify(afterSave2.slice(0, 80)));

await page.keyboard.press("Control+w");
await page.waitForTimeout(300);
await page.keyboard.press("Control+o");
await page.waitForTimeout(400);
check("重开文件内容为已保存版本", (await page.locator(".cm-content").innerText()).includes("SECOND-EDIT"));


// ---------- 5. 真·外部修改仍能检测（反向验证） ----------
await page.evaluate(() => {
  const f = window.__FS__["/demo/a.txt"];
  f.content = f.content.replace("hello", "HELLO-BY-OTHERS") + "external line\n";
  f.size = f.content.length;
  f.mtime = ++window.__mtime__;
});
// 让标签处于脏状态
await page.locator(".cm-content").click();
await page.keyboard.press("Control+End");
await page.keyboard.type("dirty-mark\n");
await page.waitForTimeout(3400);
check("真外部修改仍弹出提示", (await page.locator(".modal-mask").count()) === 1);
check("保留按钮为主按钮", await page.evaluate(() => {
  const b = document.querySelector(".modal-actions button");
  return !!b && b.className.includes("primary") && (b.textContent || "").includes("保留");
}));
await page.locator(".modal-actions button", { hasText: "保留我的版本" }).click();
await page.waitForTimeout(200);
check("保留后编辑内容未被覆盖", (await page.locator(".cm-content").innerText()).includes("dirty-mark"));

await browser.close();
await server.close();
const pass = results.filter((r) => r.ok).length;
console.log(`\n${pass}/${results.length} 通过`);
