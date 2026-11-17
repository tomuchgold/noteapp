import { useEffect, useRef } from "react";
import { MergeView } from "@codemirror/merge";
import { lineNumbers, EditorView } from "@codemirror/view";
import { highlightActiveLineGutter, highlightActiveLine } from "@codemirror/view";
import { history } from "@codemirror/commands";
import { oneDark } from "@codemirror/theme-one-dark";

interface Props {
  aText: string;
  bText: string;
  aName: string;
  bName: string;
  onClose: () => void;
}

export default function DiffView({ aText, bText, aName, bName, onClose }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const base = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      history(),
      EditorView.lineWrapping,
      oneDark,
    ];
    const mv = new MergeView({
      a: { doc: aText, extensions: base },
      b: { doc: bText, extensions: base },
      parent: hostRef.current,
      collapseUnchanged: { margin: 3, minSize: 6 },
      gutter: true,
      highlightChanges: true,
    });
    return () => mv.destroy();
  }, [aText, bText]);

  return (
    <div className="diff-wrap">
      <div className="diff-header">
        <span className="diff-title">
          文件对比：{aName} ⟷ {bName}
        </span>
        <span className="spacer" />
        <button className="diff-close" onClick={onClose}>
          关闭对比
        </button>
      </div>
      <div className="diff-host" ref={hostRef} />
    </div>
  );
}
