import { useEffect, useMemo, useRef, useState } from "react";
import { MergeView } from "@codemirror/merge";
import { lineNumbers, EditorView } from "@codemirror/view";
import { highlightActiveLineGutter, highlightActiveLine } from "@codemirror/view";
import { history } from "@codemirror/commands";
import { oneDark } from "@codemirror/theme-one-dark";
import { detectLanguage } from "../lib/lang";
import { markdownToHtml, enhanceMarkdownDom } from "../lib/markdown";

interface Props {
  aText: string;
  bText: string;
  aName: string;
  bName: string;
  onClose: () => void;
}

type Mode = "diff" | "preview";

const isMarkdown = (name: string) => /\.(md|markdown|mdx?)$/i.test(name);

export default function DiffView({ aText, bText, aName, bName, onClose }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>("diff");

  // 左右两侧各自的语言扩展（md 也能语法着色，肉眼更容易定位改动）
  const langA = useMemo(() => detectLanguage(aName).ext, [aName]);
  const langB = useMemo(() => detectLanguage(bName).ext, [bName]);

  useEffect(() => {
    if (mode !== "diff") return;
    if (!hostRef.current) return;
    hostRef.current.innerHTML = "";
    const base = (lang: unknown) => [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      history(),
      EditorView.lineWrapping,
      oneDark,
      ...(lang ? [lang as never] : []),
    ];
    const mv = new MergeView({
      a: { doc: aText, extensions: base(langA) },
      b: { doc: bText, extensions: base(langB) },
      parent: hostRef.current,
      collapseUnchanged: { margin: 3, minSize: 6 },
      gutter: true,
      highlightChanges: true,
    });
    return () => mv.destroy();
  }, [aText, bText, mode, langA, langB]);

  const htmlA = useMemo(() => (isMarkdown(aName) ? markdownToHtml(aText) : null), [aText, aName]);
  const htmlB = useMemo(() => (isMarkdown(bName) ? markdownToHtml(bText) : null), [bText, bName]);

  // mermaid 异步增强（切到预览模式后执行）
  const hostPreviewRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (mode === "preview" && hostPreviewRef.current) {
      void enhanceMarkdownDom(hostPreviewRef.current);
    }
  }, [mode, htmlA, htmlB]);

  return (
    <div className="diff-wrap">
      <div className="diff-header">
        <span className="diff-title">
          文件对比：{aName} ⟷ {bName}
        </span>
        <span className="spacer" />
        <div className="diff-modes">
          <button className={mode === "diff" ? "on" : ""} onClick={() => setMode("diff")} title="逐行差异对比（精确到行）">
            逐行对比
          </button>
          <button
            className={mode === "preview" ? "on" : ""}
            onClick={() => setMode("preview")}
            title="渲染预览对比：Markdown 按排版效果并排显示，纯文本按原文显示"
          >
            渲染预览
          </button>
        </div>
        <button className="diff-close" onClick={onClose}>
          关闭对比
        </button>
      </div>

      {mode === "diff" ? (
        <div className="diff-host" ref={hostRef} />
      ) : (
        <div className="diff-preview" ref={hostPreviewRef}>
          <div className="diff-preview-pane">
            <div className="diff-preview-head">{aName}</div>
            {htmlA !== null ? (
              <div className="markdown-body" dangerouslySetInnerHTML={{ __html: htmlA }} />
            ) : (
              <pre className="diff-preview-pre">{aText}</pre>
            )}
          </div>
          <div className="diff-preview-pane">
            <div className="diff-preview-head">{bName}</div>
            {htmlB !== null ? (
              <div className="markdown-body" dangerouslySetInnerHTML={{ __html: htmlB }} />
            ) : (
              <pre className="diff-preview-pre">{bText}</pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
