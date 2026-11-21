import { useMemo, useState } from "react";
import type { ReplacePreview } from "../lib/search";

export interface ReplacePreviewDialogProps {
  open: boolean;
  query: string;
  replacement: string;
  previews: ReplacePreview[];
  onClose: () => void;
  /** 执行替换：传入勾选的预览项 */
  onConfirm: (picked: ReplacePreview[]) => void;
}

export default function ReplacePreviewDialog({
  open, query, replacement, previews, onClose, onConfirm,
}: ReplacePreviewDialogProps) {
  const [checked, setChecked] = useState<Set<number>>(() => new Set(previews.map((p) => p.index)));
  const [only, setOnly] = useState("");

  // 当 previews 变化时重置勾选
  const key = `${query}\u0000${replacement}\u0000${previews.length}`;
  const [lastKey, setLastKey] = useState(key);
  if (lastKey !== key) { setLastKey(key); setChecked(new Set(previews.map((p) => p.index))); }

  const filtered = useMemo(() => {
    const q = only.trim().toLowerCase();
    if (!q) return previews;
    return previews.filter((p) =>
      p.lineText.toLowerCase().includes(q) || p.before.toLowerCase().includes(q) || String(p.line).includes(q)
    );
  }, [previews, only]);

  if (!open) return null;

  const toggle = (i: number) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };
  const allOn = filtered.length > 0 && filtered.every((p) => checked.has(p.index));
  const toggleAll = () => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (allOn) filtered.forEach((p) => next.delete(p.index));
      else filtered.forEach((p) => next.add(p.index));
      return next;
    });
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal replace-preview-modal" onClick={(e) => e.stopPropagation()}>
        <h3>🔍 替换预览 <span className="dim" style={{ fontSize: 12, fontWeight: 400 }}>
          「{query}」→「{replacement}」· 共 {previews.length} 处
        </span></h3>
        <div className="rp-toolbar">
          <label><input type="checkbox" checked={allOn} onChange={toggleAll} /> 全选/全不选</label>
          <span className="spacer" />
          <input className="rp-filter" type="search" placeholder="筛选行内容或行号…" value={only} onChange={(e) => setOnly(e.target.value)} />
          <span className="dim">已选 {checked.size}</span>
        </div>
        <div className="rp-list">
          {filtered.length === 0 ? (
            <div className="macro-empty">没有匹配项</div>
          ) : filtered.map((p) => (
            <label key={p.index} className={`rp-item ${checked.has(p.index) ? "on" : ""}`}>
              <input type="checkbox" checked={checked.has(p.index)} onChange={() => toggle(p.index)} />
              <span className="rp-line">L{p.line}</span>
              <span className="rp-text">
                <span className="rp-old">{p.before}</span>
                <span className="rp-arrow">→</span>
                <span className="rp-new">{p.after}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="modal-actions">
          <button onClick={onClose}>取消</button>
          <button className="primary" disabled={checked.size === 0} onClick={() => onConfirm(previews.filter((p) => checked.has(p.index)))}>
            执行替换（{checked.size} 处）
          </button>
        </div>
      </div>
    </div>
  );
}
