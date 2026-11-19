/**
 * v0.11.4 手机端设置弹窗修复验证：
 *  窄视口下设置弹窗可滚动、「高亮颜色」行可见可操作、版本号显示
 */
import { chromium } from "/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs";
import { createServer } from "vite";

const results = [];
const check = (name, cond, extra = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) process.exitCode = 1;
};

const server = await createServer({ root: "/workspace/notepp", server: { port: 5203 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
// 手机视口（NotePP 安卓常见 393×851）
const page = await (await browser.newContext({ viewport: { width: 393, height: 851 } })).newPage();

await page.addInitScript(() => {
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => cb,
    invoke: () => Promise.resolve(null),
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
    unregisterListener: () => {},
    registerListener: () => {},
  };
  window.matchMedia =
    window.matchMedia ||
    (() => ({ matches: true, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
});
await page.goto("http://localhost:5203/", { waitUntil: "networkidle" });
await page.waitForSelector(".cm-content");

await page.locator('.menubar button[title="编辑器样式设置"]').click();
await page.waitForSelector(".modal");

// 弹窗不超出视口
const box = await page.locator(".modal").boundingBox();
check("弹窗未超出屏幕", box && box.y >= 0 && box.y + box.height <= 851, JSON.stringify(box));

// 「高亮颜色」行可见（在视口内）且色板可操作
const colorRow = page.locator('.modal input[type="color"]');
await colorRow.scrollIntoViewIfNeeded();
const cbox = await colorRow.boundingBox();
check("高亮颜色色板在视口内", cbox && cbox.y >= 0 && cbox.y + cbox.height <= 851, JSON.stringify(cbox));
await colorRow.fill("#00ff88");
await page.waitForTimeout(200);
const applied = await page.evaluate(
  () => document.querySelector(".editor-host")?.style.getPropertyValue("--np-para") || ""
);
check("手机上改色生效", applied === "#00ff88", applied);

// 版本号显示
const title = await page.locator(".modal h3").innerText();
check("设置标题显示版本号", title.includes("0.11.4"), title);

await page.screenshot({ path: "/workspace/notepp/docs/settings-mobile.png" });
await browser.close();
await server.close();
const pass = results.filter((r) => r.ok).length;
console.log(`\n${pass}/${results.length} 通过`);
