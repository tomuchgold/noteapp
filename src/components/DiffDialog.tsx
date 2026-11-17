import { useState } from "react";
import type { FileTab } from "../lib/types";

export type DiffSource = { kind: "tab"; tab: FileTab } | { kind: "file" };

interface Props {
  tabs: FileTab[];
  defaultA: string | null; // 默认 A 侧：激活标签 id
  onConfirm: (a: DiffSource, b: DiffSource) => void;
  onCancel: () => void;
}

export default function DiffDialog({ tabs, defaultA, onConfirm, onCancel }: Props) {
  const [aSel, setASel] = useState<string>(defaultA ?? "");
  const [bSel, setBSel] = useState<string>("");

  const renderList = (value: string, onChange: (v: string) => void, side: string) => (
    <div className="diff-col">
      <div className="diff-col-title">{side} 侧文件</div>
      <label className="diff-option">
        <input
          type="radio"
          name={`diff-${side}`}
          checked={value === "@file"}
          onChange={() => onChange("@file")}
        />
        从磁盘选择文件…
      </label>
      {tabs.map((t) => (
        <label key={t.id} className="diff-option">
          <input
            type="radio"
            name={`diff-${side}`}
            checked={value === t.id}
            onChange={() => onChange(t.id)}
          />
          {t.name}
          {t.dirty ? " ●" : ""}
        </label>
      ))}
      {tabs.length === 0 && (
        <div className="diff-hint">暂无打开的标签，可从磁盘选择文件</div>
      )}
    </div>
  );

  return (
    <div className="modal-mask" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal diff-modal">
        <p>选择要对比的两个文件</p>
        <div className="diff-cols">
          {renderList(aSel, setASel, "A")}
          <div className="diff-arrow">⟷</div>
          {renderList(bSel, setBSel, "B")}
        </div>
        <div className="modal-actions">
          <button
            className="primary"
            disabled={!aSel || !bSel || aSel === bSel}
            title={!aSel || !bSel ? "两侧都需要选择文件" : aSel === bSel ? "不能选择同一个文件" : ""}
            onClick={() => {
              const toSrc = (sel: string): DiffSource =>
                sel === "@file"
                  ? { kind: "file" }
                  : { kind: "tab", tab: tabs.find((t) => t.id === sel)! };
              onConfirm(toSrc(aSel), toSrc(bSel));
            }}
          >
            开始对比
          </button>
          <button onClick={onCancel}>取消</button>
        </div>
      </div>
    </div>
  );
}
