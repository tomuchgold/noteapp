/**
 * v0.11.3 光标行高亮颜色自定义验证：
 *  1. 设置颜色 → CSS 变量生效
 *  2. 切换主题后自定义色保留
 *  3. 「跟随主题」恢复
 */
import { chromium } from "/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs";
import { createServer } from "vite";

const results = [];
const check = (name, cond, extra = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) process.exitCode = 1;
};

const server = await createServer({ root: "/workspace/notepp", server: { port: 5202 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();

await page.addInitScript(() => {
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => cb,
    invoke: (cmd) => {
      if (cmd === "read_text_file")
        return Promise.resolve({ content: "line one\nline two\n", encoding: "UTF-8", bom: false, eol: "LF", size: 20 });
      if (cmd === "file_info") return Promise.resolve({ size: 20, mtime: 100 });
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
await page.goto("http://localhost:5202/", { waitUntil: "networkidle" });
await page.waitForSelector(".cm-content");

const getVar = () =>
  page.evaluate(() => document.querySelector(".editor-host")?.style.getPropertyValue("--np-para") || "");

// 打开设置
await page.locator('.menubar button[title="编辑器样式设置"]').click();
await page.waitForSelector(".modal");
check("设置弹窗打开", (await page.locator(".modal").count()) === 1);
const dim0 = await page.locator(".setting-row", { hasText: "高亮颜色" }).innerText();
check("默认跟随主题", dim0.includes("跟随主题"), dim0.replace(/\n/g, " "));
const themeColor = await getVar();
check("默认高亮为强调色淡染（非面板底色）", themeColor.startsWith("rgba(") && !themeColor.includes("NaN"), themeColor);
const barColor = await page.evaluate(() => document.querySelector(".editor-host")?.style.getPropertyValue("--np-linebar") || "");
check("左竖条颜色已注入", barColor.startsWith("#"), barColor);

// 设置自定义颜色
await page.locator('.modal input[type="color"]').fill("#ff2e88");
await page.waitForTimeout(200);
check("自定义色生效", (await getVar()) === "#ff2e88", await getVar());
check("状态显示自定义", (await page.locator(".setting-row", { hasText: "高亮颜色" }).innerText()).includes("自定义"));

// 关闭弹窗 → 光标行装饰应用该颜色
await page.locator(".modal-actions button", { hasText: "完成" }).click();
await page.locator(".cm-content").click();
await page.waitForTimeout(200);
const lineBg = await page.evaluate(() => {
  const el = document.querySelector(".cm-line.cm-para-line") || document.querySelector(".cm-activeLine");
  return el ? getComputedStyle(el).backgroundColor : "";
});
check("光标行背景为自定义色", lineBg === "rgb(255, 46, 136)", lineBg);

// 重开设置，切换主题 → 自定义色保留
await page.locator('.menubar button[title="编辑器样式设置"]').click();
await page.waitForSelector(".modal");
await page.locator(".modal .theme-swatch").nth(3).click();
await page.waitForTimeout(200);
check("切主题后自定义色保留", (await getVar()) === "#ff2e88", await getVar());

// 跟随主题恢复
await page.locator('.modal button[title*="恢复"], .modal button', { hasText: "跟随主题" }).first().click();
await page.waitForTimeout(200);
const back = await getVar();
const barAfter = await page.evaluate(() => document.querySelector(".editor-host")?.style.getPropertyValue("--np-linebar") || "");
check("恢复跟随主题", back.startsWith("rgba(") && barAfter.startsWith("#"), `${back} / ${barAfter}`);

await browser.close();
await server.close();
const pass = results.filter((r) => r.ok).length;
console.log(`\n${pass}/${results.length} 通过`);
