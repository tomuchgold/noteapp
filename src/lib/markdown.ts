/**
 * Markdown 渲染（v0.11.2）：marked + GFM，增强三件套——
 *  1. 代码块语法高亮（highlight.js，按语言染色，未知语言自动检测）
 *  2. 数学公式（KaTeX 同步渲染：$$...$$ 块级、$...$ 行内；代码块内的 $ 不处理）
 *  3. Mermaid 图表（```mermaid 代码块 → 占位节点，mount 后 enhanceMarkdownDom 异步画图）
 *
 * 同步出口 markdownToHtml() 供预览/对比预览/导出 HTML/打印 PDF 共用；
 * 公式与代码高亮在同步阶段完成，mermaid 在 DOM 挂载后异步渲染。
 */
import { marked } from "marked";
import hljs from "highlight.js/lib/common";
import katex from "katex";
import { resolveMediaSrc } from "./mediaView";

marked.setOptions({ gfm: true, breaks: false });

/** 代码块 / 数学占位外的区域才做公式替换 */
function splitFences(src: string): Array<{ text: string; isCode: boolean }> {
  const parts: Array<{ text: string; isCode: boolean }> = [];
  const fenceRe = /(^|\n)(```|~~~)[^\n]*\n[\s\S]*?\n\2(?=\n|$)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(src)) !== null) {
    const start = m.index + m[1].length;
    if (start > last) parts.push({ text: src.slice(last, start), isCode: false });
    parts.push({ text: src.slice(start, fenceRe.lastIndex), isCode: true });
    last = fenceRe.lastIndex;
  }
  if (last < src.length) parts.push({ text: src.slice(last), isCode: false });
  return parts;
}

/** 块级公式 $$...$$ → KaTeX display HTML */
function renderDisplayMath(seg: string): string {
  return seg.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex: string) => {
    try {
      return katex.renderToString(tex.trim(), { displayMode: true, throwOnError: false });
    } catch {
      return _;
    }
  });
}

/** 行内公式 $...$ → KaTeX inline HTML（跳过 \$ 转义与纯数字金额） */
function renderInlineMath(seg: string): string {
  return seg.replace(/(^|[^\\$])\$([^$\n]+?)\$(?!\d)/g, (whole, pre: string, tex: string) => {
    const t = tex.trim();
    if (!t || /^[\d.,\s]+$/.test(t)) return whole; // 像 "价格 $5，数量 $6" 不当公式
    try {
      return pre + katex.renderToString(t, { displayMode: false, throwOnError: false });
    } catch {
      return whole;
    }
  });
}

/** 公式预处理（非代码段） */
function preprocessMath(src: string): string {
  return splitFences(src)
    .map((p) => (p.isCode ? p.text : renderInlineMath(renderDisplayMath(p.text))))
    .join("");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const MEDIA_SRC_RE = /(<(?:img|audio|video|source)\b[^>]*?\bsrc\s*=\s*)("(?:[^"]*)"|'(?:[^']*)')/gi;
const ABS_SRC_RE = /^(https?|data|blob|asset):/i;

/**
 * 把渲染结果里的相对媒体引用（img/audio/video/source 的 src）
 * 按文档所在目录解析为可加载的 src（v0.27：修复预览里相对路径图片不显示——
 * WebView 下 <img src="media/x.png"> 会指向应用内部地址而非文档目录）。
 */
function resolveMediaSrcs(html: string, mediaDir: string | null | undefined): string {
  if (!mediaDir) return html;
  return html.replace(MEDIA_SRC_RE, (whole, lead: string, quoted: string) => {
    const quote = quoted[0];
    const ref = quoted.slice(1, -1);
    if (!ref || ABS_SRC_RE.test(ref)) return whole;
    try {
      return `${lead}${quote}${resolveMediaSrc(ref, mediaDir)}${quote}`;
    } catch {
      return whole;
    }
  });
}

const renderer = {
  /** 代码块：mermaid → 占位节点；其余 → highlight.js 染色 */
  code({ text, lang }: { text: string; lang?: string }) {
    const language = (lang || "").trim().split(/\s+/)[0];
    if (language === "mermaid") {
      return `<pre class="mermaid">${escapeHtml(text)}</pre>`;
    }
    let html: string;
    try {
      html =
        language && hljs.getLanguage(language)
          ? hljs.highlight(text, { language }).value
          : hljs.highlightAuto(text).value;
    } catch {
      html = escapeHtml(text);
    }
    return `<pre><code class="hljs language-${escapeHtml(language || "")}">${html}</code></pre>`;
  },
};

marked.use({ renderer: renderer as never });

export function markdownToHtml(source: string, opts?: { mediaDir?: string | null }): string {
  const html = marked.parse(preprocessMath(source), { async: false }) as string;
  return resolveMediaSrcs(html, opts?.mediaDir);
}

/**
 * DOM 挂载后的异步增强：目前只有 mermaid（公式与代码高亮已同步完成）。
 * PreviewDialog / DiffView 渲染预览模式在 innerHTML 写入后调用。
 */
export async function enhanceMarkdownDom(container: HTMLElement): Promise<void> {
  const nodes = container.querySelectorAll("pre.mermaid");
  if (nodes.length === 0) return;
  try {
    const mermaid = (await import("mermaid")).default;
    mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "strict" });
    await mermaid.run({ nodes: Array.from(nodes) as HTMLElement[] });
  } catch {
    // 图表语法错误等：保留源码展示
  }
}

/** 导出 HTML 文档头附加的 CDN 引用（公式已内联为 KaTeX HTML，仅需样式；mermaid 需脚本） */
export const EXPORT_EXTRAS_HEAD = `
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
<script type="module">
  import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs";
  mermaid.initialize({ startOnLoad: true, theme: "neutral", securityLevel: "strict" });
</script>`;
