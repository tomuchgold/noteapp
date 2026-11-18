/**
 * v0.11.2 Markdown 增强纯逻辑测试：KaTeX 公式、代码高亮、mermaid 占位、金额不误判
 */
import { strict as assert } from "node:assert";
import { markdownToHtml, EXPORT_EXTRAS_HEAD } from "/tmp/markdown.bundle.mjs";

let passed = 0;
function t(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

t("行内公式 $E=mc^2$ 渲染为 KaTeX", () => {
  const html = markdownToHtml("质能方程 $E=mc^2$ 很有名。");
  assert.ok(html.includes("katex"), html);
  assert.ok(!html.includes("$E="), html);
});

t("块级公式 $$...$$ 渲染为 display 模式", () => {
  const html = markdownToHtml("$$\\int_0^1 x^2 dx$$");
  assert.ok(html.includes("katex-display"), html);
});

t("代码块内的 $ 不当公式处理", () => {
  const html = markdownToHtml("```\nprice = $5\n```");
  assert.ok(!html.includes("katex"), html);
  assert.ok(html.includes("$5"), html);
});

t("行内代码内的 $ 不当公式处理", () => {
  const html = markdownToHtml("成本是 `$100 和 $200` 左右");
  assert.ok(!html.includes("katex"), html);
  assert.ok(html.includes("$100"), html);
});

t("美元金额不误判为公式（$ 后跟纯数字）", () => {
  const html = markdownToHtml("价格 $5，总计 $12 都不算公式");
  assert.ok(!html.includes("katex"), html);
});

t("代码块按语言高亮（javascript → hljs span）", () => {
  const html = markdownToHtml("```js\nconst x = 1;\n```");
  assert.ok(html.includes("hljs"), html);
  assert.ok(html.includes("language-js"), html);
});

t("mermaid 代码块输出占位节点 pre.mermaid", () => {
  const html = markdownToHtml("```mermaid\ngraph TD; A-->B;\n```");
  assert.ok(html.includes('class="mermaid"'), html);
  assert.ok(html.includes("A--&gt;B"), html);
});

t("GFM 表格仍然正常", () => {
  const html = markdownToHtml("| a | b |\n|---|---|\n| 1 | 2 |");
  assert.ok(html.includes("<table>"), html);
});

t("任务列表仍然正常", () => {
  const html = markdownToHtml("- [x] done\n- [ ] todo");
  assert.ok(html.includes('type="checkbox"'), html);
});

t("导出头包含 KaTeX 样式与 mermaid 脚本", () => {
  assert.ok(EXPORT_EXTRAS_HEAD.includes("katex.min.css"));
  assert.ok(EXPORT_EXTRAS_HEAD.includes("mermaid"));
});

t("混合文档：标题 + 公式 + 代码 + 表格一次渲染", () => {
  const src = "# 标题\n\n$\\alpha$ 公式\n\n```python\nprint(1)\n```\n\n| x | y |\n|---|---|\n| 1 | 2 |";
  const html = markdownToHtml(src);
  assert.ok(html.includes("<h1>"), html);
  assert.ok(html.includes("katex"), html);
  assert.ok(html.includes("hljs"), html);
  assert.ok(html.includes("<table>"), html);
});

console.log(`\n${passed}/11 markdown-enhance tests passed`);
