import { chromium } from "/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs";
import { createServer } from "vite";

const server = await createServer({ root: "/workspace/notepp", server: { port: 5203 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.addInitScript(() => {
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => cb,
    invoke: (cmd) => {
      if (cmd === "read_text_file")
        return Promise.resolve({ content: "", encoding: "UTF-8", bom: false, eol: "LF", size: 0 });
      if (cmd === "file_info") return Promise.resolve({ size: 10, mtime: 100 });
      if (cmd === "list_dir") return Promise.resolve([]);
      if (cmd === "search_in_folder") return Promise.resolve([]);
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
await page.goto("http://localhost:5203/", { waitUntil: "networkidle" });
await page.waitForSelector(".cm-content");

// 输入一段带结构的 Markdown，方便对照
await page.locator(".cm-content").click();
await page.keyboard.type(
  "# 项目周报\n\n## 本周进展\n- 完成查找替换功能，支持正则与全字匹配\n- 新增搜索结果面板，可点击跳转到对应行\n- 修复右键标注时选区丢失的问题\n\n## 下周计划\n- 分屏对照与标注导航\n- 打印 / 导出 PDF\n\n## 风险\n- 安卓端软键盘遮挡输入区，需要适配\n- 外部文件被修改时可能发生覆盖"
);

// 搜索 "搜索"
await page.keyboard.press("Control+f");
await page.waitForSelector(".findbar");
await page.locator(".findbar-input").first().fill("搜索");
await page.waitForTimeout(400);
await page.locator(".findbar-tabs button", { hasText: "结果面板" }).click();
await page.waitForSelector(".search-results");
await page.waitForTimeout(300);
await page.screenshot({ path: "/workspace/notepp/docs/search-results.png" });

// 标注：选中一行加高亮
await page.keyboard.press("Escape");
await page.locator(".cm-content .cm-line").nth(4).click();
await page.keyboard.press("Home");
for (let i = 0; i < 12; i++) await page.keyboard.press("Shift+ArrowRight");
const box = await page.locator(".cm-content .cm-line").nth(4).boundingBox();
await page.mouse.click(box.x + 40, box.y + box.height / 2, { button: "right" });
await page.waitForSelector(".ann-color");
await page.locator(".ann-color").nth(1).click();
await page.waitForTimeout(300);
// 再加一条划线
await page.locator(".cm-content .cm-line").nth(8).click();
await page.keyboard.press("Home");
for (let i = 0; i < 10; i++) await page.keyboard.press("Shift+ArrowRight");
const box2 = await page.locator(".cm-content .cm-line").nth(8).boundingBox();
await page.mouse.click(box2.x + 40, box2.y + box2.height / 2, { button: "right" });
await page.waitForSelector(".ann-menu-item");
await page.locator('.ann-menu-item[title*="下划线"]').click();
await page.waitForTimeout(300);

// 打开标注面板
await page.locator(".menubar button", { hasText: "标注" }).first().click();
await page.waitForSelector(".anno-panel");
await page.waitForTimeout(300);
await page.screenshot({ path: "/workspace/notepp/docs/anno-panel.png" });

// 关面板，开分屏
await page.locator(".anno-panel-head button", { hasText: "×" }).click();
await page.locator(".menubar button", { hasText: "新建" }).first().click();
await page.waitForTimeout(300);
await page.locator(".cm-content").click();
await page.keyboard.type("左侧文件写正文，右侧文件放参考资料，\n两栏同屏对照，不用来回切标签。\n\n- 支持各自独立编辑\n- 语法高亮同步生效");
await page.waitForTimeout(200);
await page.locator(".menubar button", { hasText: "分屏" }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: "/workspace/notepp/docs/split-view.png" });

await browser.close();
await server.close();
console.log("shots done");
