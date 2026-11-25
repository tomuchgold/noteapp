import { useEffect, useMemo, useRef, useState } from "react";
import { markdownToHtml, enhanceMarkdownDom, EXPORT_EXTRAS_HEAD } from "../lib/markdown";

interface Props {
  /** 文档名（导出 HTML 默认文件名） */
  title: string;
  /** markdown 源文本（实时传入，编辑即刷新） */
  source: string;
  /** 正文字号 px（含缩放，导出大字打印用） */
  fontSize?: number;
  /** 文档所在目录：预览/导出时按它解析相对媒体引用（v0.27） */
  mediaDir?: string | null;
  /** 导出 HTML（Tauri 内走系统保存对话框；缺省用浏览器下载） */
  onExportHtml?: (html: string) => void;
  /** 打印 / 导出 PDF（v0.28：打印归入预览面板） */
  onPrint?: () => void;
  onClose: () => void;
}

/** 导出用的整页 HTML 模板（带样式，可直接浏览器打开 / 打印为 PDF） */
function buildHtmlDoc(bodyHtml: string, title: string, fontSize: number): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${title.replace(/[<>&"]/g, "")}</title>
${EXPORT_EXTRAS_HEAD}
<style>
  body { font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
         margin: 48px auto; max-width: 820px; line-height: 1.8; color: #24292f; font-size: ${fontSize}px; background: #fff; }
  h1,h2,h3,h4 { line-height: 1.4; margin: 1.2em 0 .5em; }
  code { background: #f3f4f6; padding: .15em .4em; border-radius: 4px; font-size: .92em; }
  pre { background: #f6f8fa; padding: 14px 16px; border-radius: 8px; overflow: auto; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; margin: 1em 0; }
  th, td { border: 1px solid #d0d7de; padding: 6px 14px; }
  th { background: #f6f8fa; }
  blockquote { border-left: 4px solid #d0d7de; margin: 1em 0; padding: .1em 1em; color: #57606a; }
  img, audio, video { max-width: 100%; }
  hr { border: none; border-top: 1px solid #d0d7de; margin: 2em 0; }
  @media print { body { margin: 12mm; max-width: none; } }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

export function exportHtmlPayload(
  source: string,
  title: string,
  fontSize: number,
  isMarkdown = true,
  mediaDir?: string | null
): string {
  const body = isMarkdown
    ? markdownToHtml(source, { mediaDir })
    : `<pre style="white-space:pre-wrap">${source.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`;
  return buildHtmlDoc(body, title, fontSize);
}

/** v0.28：右侧贴边实时预览面板（编辑即刷新），支持全屏；打印 / 导出 HTML 收纳在面板里 */
export default function PreviewDialog({
  title,
  source,
  fontSize = 14,
  mediaDir = null,
  onExportHtml,
  onPrint,
  onClose,
}: Props) {
  const isMarkdown = /\.(md|markdown|txt)$/i.test(title);
  const [full, setFull] = useState(false);
  const html = useMemo(() => {
    try {
      if (isMarkdown) return markdownToHtml(source, { mediaDir });
      // 非 markdown：转义后按纯文本段落渲染
      const esc = source.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return `<pre style="white-space:pre-wrap">${esc}</pre>`;
    } catch (e) {
      return `<p>渲染失败：${String(e)}</p>`;
    }
  }, [source, isMarkdown, mediaDir]);

  const bodyRef = useRef<HTMLDivElement>(null);

  // mermaid 等异步增强：innerHTML 写入后执行
  useEffect(() => {
    if (bodyRef.current) void enhanceMarkdownDom(bodyRef.current);
  }, [html]);

  const exportHtml = () => {
    const doc = exportHtmlPayload(source, title, fontSize, isMarkdown, mediaDir);
    if (onExportHtml) {
      onExportHtml(doc);
      return;
    }
    const blob = new Blob([doc], { type: "text/html;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = title.replace(/\.[^.]+$/, "") + ".html";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <aside className={`preview-side ${full ? "full" : ""}`}>
      <div className="preview-head">
        <h3>{full ? "" : "实时预览 — "}{title}</h3>
        <div className="preview-actions">
          <button onClick={() => setFull((v) => !v)} title={full ? "退出全屏" : "全屏预览"}>
            {full ? "⧉ 还原" : "⛶ 全屏"}
          </button>
          {onPrint && (
            <button onClick={onPrint} title="打印 / 导出 PDF（打印对话框里选「另存为 PDF」）">
              🖨️ 打印
            </button>
          )}
          <button onClick={exportHtml} title="导出带样式的 HTML，可直接浏览器打印为 PDF">
            导出 HTML
          </button>
          <button className="primary" onClick={onClose}>关闭</button>
        </div>
      </div>
      <div className="markdown-body" ref={bodyRef} dangerouslySetInnerHTML={{ __html: html }} />
    </aside>
  );
}
