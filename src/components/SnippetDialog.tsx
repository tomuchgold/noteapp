import { useRef, useState } from "react";
import type { Snippet } from "../lib/snippets";

export interface SnippetDialogProps {
  open: boolean;
  snippets: Snippet[];
  shortcutOf: (id: string) => string;
  onClose: () => void;
  onAdd: (abbr: string, body: string, name: string) => void;
  onUpdate: (id: string, patch: Partial<Pick<Snippet, "abbr" | "body" | "name">>) => void;
  onDelete: (id: string) => void;
  onImport: (json: string) => void;
  onExport: () => void;
  onTemplate: () => void;
  /** 打开快捷键设置并定位到某片段 */
  onBindKey: (id: string) => void;
}

export default function SnippetDialog({
  open, snippets, shortcutOf, onClose, onAdd, onUpdate, onDelete, onImport, onExport, onTemplate, onBindKey,
}: SnippetDialogProps) {
  const [abbr, setAbbr] = useState("");
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const reset = () => { setAbbr(""); setName(""); setBody(""); setEditingId(null); };

  const doSave = () => {
    if (!abbr.trim() || !body.trim()) {
      setMsg("缩写和内容都不能为空。");
      return;
    }
    if (editingId) {
      onUpdate(editingId, { abbr: abbr.trim(), body, name: name.trim() || abbr.trim() });
      setMsg("片段已更新");
    } else {
      onAdd(abbr.trim(), body, name.trim() || abbr.trim());
      setMsg(`已添加片段「${name.trim() || abbr.trim()}」`);
    }
    reset();
  };

  const startEdit = (s: Snippet) => {
    setEditingId(s.id); setAbbr(s.abbr); setName(s.name); setBody(s.body); setMsg(null);
  };

  const doImportFile = async (file?: File) => {
    if (!file) return;
    try { onImport(await file.text()); setMsg("片段已导入"); }
    catch (e) { setMsg(`导入失败：${e instanceof Error ? e.message : e}`); }
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal snippet-modal" onClick={(e) => e.stopPropagation()}>
        <h3>🧩 代码片段 <span style={{ opacity: .5, fontSize: 12, fontWeight: 400 }}>输入缩写 + Tab 展开</span></h3>

        <div className="snippet-editor">
          <div className="snippet-editor-row">
            <label title="触发缩写：在编辑器里输入它，再按 Tab 即可展开">缩写
              <input type="text" placeholder="如 todo / now" value={abbr} onChange={(e) => setAbbr(e.target.value)} />
            </label>
            <label title="片段名称，便于识别">名称
              <input type="text" placeholder="如 待办项" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
          </div>
          <label className="snippet-body-label" title="展开后的文本。支持占位符：${NOW} 当前日期时间、${DATE} 日期、${TIME} 时间">
            内容（支持 <code>${'{NOW}'}</code> <code>${'{DATE}'}</code> <code>${'{TIME}'}</code>）
            <textarea rows={3} placeholder={"例如：- [ ] ${NOW}"} value={body} onChange={(e) => setBody(e.target.value)} />
          </label>
          <div className="snippet-editor-actions">
            <button onClick={reset}>清空</button>
            <button className="primary" onClick={doSave}>{editingId ? "更新片段" : "添加片段"}</button>
          </div>
        </div>

        <div className="macro-list-head">
          <span>已有片段 <span className="dim">（{snippets.length}）</span></span>
          <span className="macro-ops">
            <button onClick={() => fileRef.current?.click()} title="从 JSON 文件导入片段">📥 导入</button>
            <button onClick={onExport} disabled={snippets.length === 0} title="把所有片段导出为 JSON">📤 导出</button>
            <button onClick={onTemplate} title="下载示例片段文件">📄 示例</button>
          </span>
          <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={(e) => doImportFile(e.target.files?.[0])} />
        </div>

        <div className="macro-list snippet-list">
          {snippets.length === 0 ? (
            <div className="macro-empty">还没有片段。上方填写缩写和内容即可添加。</div>
          ) : snippets.map((s) => (
            <div key={s.id} className="macro-item">
              <div className="macro-item-main">
                <div className="snippet-abbr">{s.abbr} <span className="dim">→ Tab</span></div>
                <div className="dim macro-item-sum" title={s.body}>{s.name} · {s.body.replace(/\s+/g, " ").slice(0, 60)}</div>
                {shortcutOf(`snippet:${s.id}`) && <div className="snippet-key">⌨ {shortcutOf(`snippet:${s.id}`)}</div>}
              </div>
              <div className="macro-item-btns">
                <button onClick={() => onBindKey(s.id)} title="设置快捷键">⌨️</button>
                <button onClick={() => startEdit(s)} title="编辑">✏️</button>
                <button onClick={() => onDelete(s.id)} title="删除">🗑️</button>
              </div>
            </div>
          ))}
        </div>

        {msg && <div className="dim macro-msg">{msg}</div>}

        <div className="modal-actions">
          <button className="primary" onClick={onClose}>完成</button>
        </div>
      </div>
    </div>
  );
}
