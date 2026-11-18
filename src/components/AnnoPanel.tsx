import { useEffect, useRef } from "react";
import type { Annotation } from "../lib/annotations";

export interface AnnoPanelProps {
  open: boolean;
  annotations: Annotation[];
  onJump: (ann: Annotation) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

const KIND_LABEL: Record<string, string> = {
  highlight: "高亮",
  underline: "划线",
  note: "备注",
};

/** 标注导航面板：当前文件所有划线/标注，点击跳转 */
export default function AnnoPanel({ open, annotations, onJump, onDelete, onClose }: AnnoPanelProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) listRef.current?.scrollTo({ top: 0 });
  }, [open, annotations.length]);

  if (!open) return null;

  const list = [...annotations].sort((a, b) => a.from - b.from);

  return (
    <div className="anno-panel">
      <div className="anno-panel-head">
        <span className="anno-panel-title">
          标注<span className="dim">　{list.length} 条</span>
        </span>
        <span className="spacer" />
        <button className="anno-panel-btn" onClick={onClose} title="关闭标注面板">×</button>
      </div>
      <div className="anno-panel-list" ref={listRef}>
        {list.length === 0 ? (
          <div className="anno-panel-empty">
            还没有标注。选中文字后右键 →「标注」即可添加划线/高亮/备注。
          </div>
        ) : (
          list.map((a) => (
            <div key={a.id} className="anno-item">
              <button
                className="anno-item-main"
                onClick={() => onJump(a)}
                title="点击跳转到标注位置"
              >
                <span className={`anno-item-kind kind-${a.kind}`}>
                  {KIND_LABEL[a.kind] ?? a.kind}
                </span>
                <span className="anno-item-text">{a.text.trim() || "(空)"}</span>
                {a.note && <span className="anno-item-note">{a.note}</span>}
              </button>
              <button
                className="anno-item-del"
                onClick={() => onDelete(a.id)}
                title="删除该标注"
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
