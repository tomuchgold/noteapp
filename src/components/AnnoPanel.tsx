import { useEffect, useRef } from "react";
import type { Annotation } from "../lib/annotations";

export interface AnnoPanelProps {
  open: boolean;
  annotations: Annotation[];
  onJump: (ann: Annotation) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  /** 朗读该标注文本（TTS） */
  onSpeak: (text: string) => void;
  /** 复制该标注文本到剪贴板 */
  onCopy: (text: string) => void;
  /** 把该标注文本插入当前光标处 */
  onPaste: (text: string) => void;
}

const KIND_LABEL: Record<string, string> = {
  highlight: "高亮",
  underline: "划线",
  note: "备注",
};

/** 标注导航面板：当前文件所有划线/标注，点击跳转；每条可朗读/复制/粘贴 */
export default function AnnoPanel({
  open,
  annotations,
  onJump,
  onDelete,
  onClose,
  onSpeak,
  onCopy,
  onPaste,
}: AnnoPanelProps) {
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
        <button className="anno-panel-close" onClick={onClose} title="关闭标注面板">
          ✕ 关闭
        </button>
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
              <span className="anno-item-ops">
                <button
                  className="anno-op"
                  onClick={() => onSpeak(a.note ? `${a.text}，备注：${a.note}` : a.text)}
                  title="朗读该标注（TTS）"
                >
                  🔊
                </button>
                <button
                  className="anno-op"
                  onClick={() => onCopy(a.text)}
                  title="复制该标注文本"
                >
                  📋
                </button>
                <button
                  className="anno-op"
                  onClick={() => onPaste(a.text)}
                  title="把该标注文本插入当前光标处"
                >
                  📥
                </button>
                <button
                  className="anno-item-del"
                  onClick={() => onDelete(a.id)}
                  title="删除该标注"
                >
                  ×
                </button>
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
