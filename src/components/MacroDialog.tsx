import { useRef, useState } from "react";
import type { MacroItem } from "../lib/types";
import type { SavedMacro } from "../lib/macros";

export interface MacroDialogProps {
  open: boolean;
  macros: SavedMacro[];
  /** 当前内存中正在录制的动作（可能为空） */
  liveItems: MacroItem[];
  onClose: () => void;
  onSave: (name: string, items: MacroItem[]) => void;
  onReplay: (items: MacroItem[]) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onImport: (json: string) => void;
  onExport: () => void;
  onImportTemplate: () => void;
  /** 取某命令当前快捷键 */
  shortcutOf: (commandId: string) => string;
  /** 打开快捷键设置并定位到某宏 */
  onBindKey: (macroId: string) => void;
}

/** 把动作序列渲染成简短可读摘要 */
function summarize(items: MacroItem[]): string {
  return items
    .slice(0, 12)
    .map((it) => (it.type === "text" ? it.text : `<${it.cmd}>`))
    .join("")
    .replace(/\n/g, "⏎")
    .slice(0, 80) + (items.length > 12 ? "…" : "");
}

export default function MacroDialog({
  open, macros, liveItems, onClose, onSave, onReplay, onDelete, onRename, onImport, onExport, onImportTemplate,
  shortcutOf, onBindKey,
}: MacroDialogProps) {
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const doSave = () => {
    if (liveItems.length === 0) {
      setMsg("还没有可保存的动作，请先点「录制宏」录一段操作。");
      return;
    }
    onSave(name.trim() || `宏 ${macros.length + 1}`, liveItems);
    setName("");
    setMsg(`已保存「${name.trim() || `宏 ${macros.length + 1}`}」（${liveItems.length} 个动作）`);
  };

  const doImportFile = async (file?: File) => {
    if (!file) return;
    try {
      const text = await file.text();
      onImport(text);
      setMsg("宏已导入");
    } catch (e) {
      setMsg(`导入失败：${e instanceof Error ? e.message : e}`);
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal macro-modal" onClick={(e) => e.stopPropagation()}>
        <h3>🎬 宏管理 <span style={{ opacity: .5, fontSize: 12, fontWeight: 400 }}>录制 → 保存 → 随时回放</span></h3>

        <div className="macro-save-box">
          <div className="macro-save-title">保存当前录制</div>
          <div className="macro-save-row">
            <input
              type="text"
              placeholder="给宏起个名字…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") doSave(); }}
            />
            <button className="primary" onClick={doSave} disabled={liveItems.length === 0}>
              保存（{liveItems.length} 个动作）
            </button>
          </div>
          <div className="dim macro-hint">
            先点菜单栏「录制宏」开始，操作完后点「停止录制」，再回到这里保存。
          </div>
        </div>

        <div className="macro-list-head">
          <span>已保存的宏 <span className="dim">（{macros.length}）</span></span>
          <span className="macro-ops">
            <button onClick={() => fileRef.current?.click()} title="从 JSON 文件导入宏">📥 导入</button>
            <button onClick={onExport} disabled={macros.length === 0} title="把所有宏导出为 JSON 文件">📤 导出</button>
            <button onClick={onImportTemplate} title="下载一个宏文件示例，照着改即可批量导入">📄 示例</button>
          </span>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            onChange={(e) => doImportFile(e.target.files?.[0])}
          />
        </div>

        <div className="macro-list">
          {macros.length === 0 ? (
            <div className="macro-empty">
              还没有保存的宏。录一段操作后保存，或点「导入」从 JSON 文件加载。
            </div>
          ) : (
            macros.map((m) => (
              <div key={m.id} className="macro-item">
                <div className="macro-item-main">
                  {editingId === m.id ? (
                    <input
                      className="macro-rename-input"
                      value={editName}
                      autoFocus
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { onRename(m.id, editName.trim() || m.name); setEditingId(null); }
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      onBlur={() => { onRename(m.id, editName.trim() || m.name); setEditingId(null); }}
                    />
                  ) : (
                    <button
                      className="macro-item-name"
                      onClick={() => onReplay(m.items)}
                      title="回放这个宏（从当前光标处开始）"
                    >
                      ▶ {m.name}
                    </button>
                  )}
                  <div className="dim macro-item-sum" title={summarize(m.items)}>{summarize(m.items)}</div>
                  <div className="dim macro-item-meta">
                    {m.items.length} 个动作
                    {shortcutOf(`macro:${m.id}`) && <>　⌨ <kbd>{shortcutOf(`macro:${m.id}`)}</kbd></>}
                  </div>
                </div>
                <div className="macro-item-btns">
                  <button onClick={() => onBindKey(m.id)} title="设置快捷键">⌨️</button>
                  <button onClick={() => { setEditingId(m.id); setEditName(m.name); }} title="重命名">✏️</button>
                  <button onClick={() => onDelete(m.id)} title="删除">🗑️</button>
                </div>
              </div>
            ))
          )}
        </div>

        {msg && <div className="dim macro-msg">{msg}</div>}

        <div className="modal-actions">
          <button className="primary" onClick={onClose}>完成</button>
        </div>
      </div>
    </div>
  );
}
