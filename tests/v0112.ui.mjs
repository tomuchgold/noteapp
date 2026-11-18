import { chromium } from "/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs";
import { createServer } from "vite";

const server = await createServer({ root: "/workspace/notepp", server: { port: 5207 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
await page.addInitScript(() => {
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => cb,
    invoke: (cmd, args) => {

      if (cmd === "read_text_file") {
        const content = [
          "# Markdown 增强",
          "",
          "行内公式 $E=mc^2$，块级公式：",
          "",
          "$$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$",
          "",
          "```js",
          "const greet = (name) => `hello ${name}`;",
          "```",
          "",
          "```mermaid",
          "graph LR;",
          "  A[需求] --> B{评审};",
          "  B -->|通过| C[开发];",
          "  B -->|驳回| A;",
          "```",
        ].join("\n");
        return Promise.resolve({ content, encoding: "UTF-8", bom: false, eol: "LF", size: 500 });
      }
      if (cmd === "plugin:dialog|open") return Promise.resolve(["/demo/markdown-demo.md"]);
      if (cmd === "file_info") return Promise.resolve({ size: 500, mtime: 100 });
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
const results = [];
function check(name, cond, extra = "") {
  results.push(cond);
  console.log(`${cond ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) process.exitCode = 1;
}

await page.goto("http://localhost:5207/", { waitUntil: "networkidle" });
await page.waitForSelector(".cm-content");

// 通过 Ctrl+O 打开桩中的 demo.md
await page.keyboard.press("Control+o");
await page.waitForTimeout(500);
console.log("tab:", (await page.locator(".tabbar .tab-name").allInnerTexts()).join(","));

// 打开预览
await page.locator(".menubar button", { hasText: "预览" }).first().click();
await page.waitForSelector(".markdown-body");
await page.waitForTimeout(1500); // mermaid 异步画图
const katexCnt = await page.locator(".markdown-body .katex").count();
const svgCnt = await page.locator(".markdown-body pre.mermaid svg, .markdown-body svg[id^=mermaid]").count();
const hljsCnt = await page.locator(".markdown-body .hljs-keyword, .markdown-body .hljs-string, .markdown-body .hljs-title").count();
console.log("katex:", katexCnt, "mermaid-svg:", svgCnt, "hljs-tokens:", hljsCnt);
check("KaTeX 渲染", katexCnt >= 2, `实际 ${katexCnt}`);
check("Mermaid 画成 SVG", svgCnt >= 1, `实际 ${svgCnt}`);
check("代码高亮染色", hljsCnt >= 3, `实际 ${hljsCnt}`);
await page.screenshot({ path: "/workspace/notepp/docs/markdown-enhanced.png" });

await browser.close();
await server.close();
const pass = results.filter(Boolean).length;
console.log(`\n==== ${pass}/${results.length} 项通过 ====`);
process.exit(process.exitCode || 0);
