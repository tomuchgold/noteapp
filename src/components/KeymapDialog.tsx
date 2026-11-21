import { useEffect, useState } from "react";
import {
  BUILTIN_COMMANDS, commandLabel, conflictsOf, effectiveKey, type Bindings,
} from "../lib/keymap";
import type { SavedMacro } from "../lib/macros";
import type { Snippet } from "../lib/snippets";

export interface KeymapDialogProps {
  open: boolean;
  bindings: Bindings;
  /** 片段快捷键独立存储，必须一起参与冲突检测 */
  snippetBindings: Bindings;
  macros: SavedMacro[];
  snippets: Snippet[];
  onClose: () => void;
  /** 保存绑定（立即持久化）；macroKeys/snippetKeys 一起传，便于动态命令也用这套 */
  onChange: (bindings: Bindings) => void;
  onBindMacro: (macroId: string, key: string) => void;
  onBindSnippet: (snippetId: string, key: string) => void;
  /** 外部请求定位到某命令（如从片段弹窗点⌨️） */
  focusCommand?: string | null;
}

type Row = { id: string; category: string; desc: string; defaultKey: string };

export default function KeymapDialog({
  open, bindings, snippetBindings, macros, snippets, onClose, onChange, onBindMacro, onBindSnippet, focusCommand,
}: KeymapDialogProps) {
  const [recording, setRecording] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const macroNames: Record<string, string> = {};
  macros.forEach((m) => { macroNames[m.id] = m.name; });
  const snippetNames: Record<string, string> = {};
  snippets.forEach((s) => { snippetNames[s.id] = s.name; });

  // 组合所有命令：内置 + 动态（宏/片段）
  const rows: Row[] = [
    ...BUILTIN_COMMANDS.map((c) => ({ id: c.id, category: c.category, desc: c.desc, defaultKey: c.defaultKey })),
    ...macros.map((m) => ({ id: `macro:${m.id}`, category: "宏与片段", desc: `回放命名宏「${m.name}」`, defaultKey: "" })),
    ...snippets.map((s) => ({ id: `snippet:${s.id}`, category: "宏与片段", desc: `插入片段「${s.name}」`, defaultKey: "" })),
  ];

  // 外部 focusCommand：自动滚动定位 + 开始录制
  useEffect(() => {
    if (!open || !focusCommand) return;
    setFilter("");
    setRecording(focusCommand);
    const t = window.setTimeout(() => {
      document.querySelector(`[data-cmd="${CSS.escape(focusCommand)}"]`)?.scrollIntoView({ block: "center" });
    }, 60);
    return () => window.clearTimeout(t);
  }, [open, focusCommand]);

  // 录制按键
  useEffect(() => {
    if (!open || !recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { setRecording(null); return; }
      // 仅修饰键不处理
      if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;
      if (e.key === "Backspace") {
        setBinding(recording, "");
        setRecording(null);
        return;
      }
      const parts: string[] = [];
      if (e.ctrlKey) parts.push("Ctrl");
      if (e.altKey) parts.push("Alt");
      if (e.shiftKey) parts.push("Shift");
      if (e.metaKey) parts.push("Meta");
      let k = e.key;
      if (k.length === 1) k = k.toUpperCase();
      parts.push(k);
      const key = parts.join("+");
      // 冲突时保持录制状态，让用户直接按下一个键重试
      if (setBinding(recording, key)) setRecording(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, recording, bindings]);

  const setBinding = (id: string, key: string): boolean => {
    const conflicts = key ? conflictsOf(key, bindings, id, [snippetBindings]) : [];
    if (conflicts.length) {
      const names = conflicts.map((c) => commandLabel(c, macroNames, snippetNames)).join("、");
      setMsg(`快捷键 ${key} 已被「${names}」占用，请先清除其绑定。`);
      return false;
    }
    setMsg(null);
    if (id.startsWith("macro:")) {
      onBindMacro(id.slice(6), key);
    } else if (id.startsWith("snippet:")) {
      onBindSnippet(id.slice(8), key);
    } else {
      onChange({ ...bindings, [id]: key });
    }
    return true;
  };

  if (!open) return null;

  const q = filter.trim().toLowerCase();
  const visible = rows.filter((r) =>
    !q || commandLabel(r.id, macroNames, snippetNames).toLowerCase().includes(q) || r.desc.toLowerCase().includes(q)
  );

  return (
    <div className="modal-mask" onClick={() => { if (!recording) onClose(); }}>
      <div className="modal keymap-modal" onClick={(e) => e.stopPropagation()}>
        <h3>⌨️ 快捷键设置 <span className="dim" style={{ fontSize: 12, fontWeight: 400 }}>点「设置」后按键；Esc 取消，Backspace 清除</span></h3>
        <div className="keymap-toolbar">
          <input type="search" placeholder="搜索命令…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <span className="dim">共 {rows.length} 个命令</span>
        </div>
        {msg && <div className="keymap-msg">{msg}</div>}
        <div className="keymap-list">
          {visible.map((r) => {
            // 片段快捷键存在独立存储里，显示时要从 snippetBindings 取
            const key = r.id.startsWith("snippet:")
              ? (snippetBindings[r.id] || "")
              : effectiveKey(r.id, bindings, r.defaultKey);
            const isRec = recording === r.id;
            return (
              <div key={r.id} data-cmd={r.id} className="keymap-row">
                <div className="keymap-info">
                  <div className="keymap-name">{commandLabel(r.id, macroNames, snippetNames)}</div>
                  <div className="dim keymap-desc">{r.desc}</div>
                </div>
                <div className="keymap-key">
                  {isRec ? <span className="keymap-recording">请按键…</span> : (key ? <kbd>{key}</kbd> : <span className="dim">未绑定</span>)}
                </div>
                <button onClick={() => { setMsg(null); setRecording(isRec ? null : r.id); }}>
                  {isRec ? "取消" : "设置"}
                </button>
              </div>
            );
          })}
        </div>
        <div className="modal-actions">
          <button className="primary" onClick={onClose}>完成</button>
        </div>
      </div>
    </div>
  );
}
