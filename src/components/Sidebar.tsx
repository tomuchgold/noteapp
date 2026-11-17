import { useEffect, useRef, useState, type ReactNode } from "react";
import { CAT_COLORS, VIRTUAL, type Category, type LibraryFile } from "../lib/library";

interface Props {
  categories: Category[];
  files: LibraryFile[];
  activeKey: string;
  onSelect: (key: string) => void;
  onCreate: (name: string, color: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  /** 侧栏底部附加区（文件夹树等） */
  children?: ReactNode;
}

const FIXED = [
  { key: VIRTUAL.all, label: "全部文件", icon: "▤" },
  { key: VIRTUAL.fav, label: "收藏", icon: "★" },
  { key: VIRTUAL.recent, label: "最近", icon: "◷" },
  { key: VIRTUAL.none, label: "未分类", icon: "○" },
];

export default function Sidebar({
  categories,
  files,
  activeKey,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  children,
}: Props) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const newRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (creating) newRef.current?.focus();
  }, [creating]);
  useEffect(() => {
    if (editingId) editRef.current?.select();
  }, [editingId]);

  const count = (key: string) => {
    if (key === VIRTUAL.all) return files.length;
    if (key === VIRTUAL.fav) return files.filter((f) => f.favorite).length;
    if (key === VIRTUAL.recent) return Math.min(files.length, 20);
    if (key === VIRTUAL.none) return files.filter((f) => !f.category).length;
    return files.filter((f) => f.category === key).length;
  };

  const submitNew = () => {
    const name = newName.trim();
    if (name) {
      const color = CAT_COLORS[categories.length % CAT_COLORS.length];
      onCreate(name, color);
    }
    setNewName("");
    setCreating(false);
  };

  const submitRename = (id: string) => {
    const name = editName.trim();
    if (name) onRename(id, name);
    setEditingId(null);
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span className="sidebar-title">文件库</span>
        <button
          className="icon-btn"
          title="新建分类"
          onClick={() => {
            setCreating(true);
            setNewName("");
          }}
        >
          ＋
        </button>
      </div>

      <div className="sidebar-section">
        {FIXED.map((item) => (
          <button
            key={item.key}
            className={`side-item ${activeKey === item.key ? "active" : ""}`}
            onClick={() => onSelect(item.key)}
          >
            <span className="side-icon">{item.icon}</span>
            <span className="side-label-text">{item.label}</span>
            <span className="side-count">{count(item.key)}</span>
          </button>
        ))}
      </div>

      <div className="sidebar-section grow">
        <div className="side-group-title">我的分类</div>

        {categories.map((c) => {
          if (confirmDel === c.id) {
            return (
              <div key={c.id} className="side-confirm">
                <span>删除「{c.name}」？</span>
                <button
                  className="mini danger"
                  onClick={() => {
                    onDelete(c.id);
                    setConfirmDel(null);
                  }}
                >
                  删除
                </button>
                <button className="mini" onClick={() => setConfirmDel(null)}>
                  取消
                </button>
              </div>
            );
          }
          if (editingId === c.id) {
            return (
              <div key={c.id} className="side-input-row">
                <span className="cat-dot" style={{ background: c.color }} />
                <input
                  ref={editRef}
                  className="side-input"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitRename(c.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  onBlur={() => submitRename(c.id)}
                />
              </div>
            );
          }
          return (
            <button
              key={c.id}
              className={`side-item ${activeKey === c.id ? "active" : ""}`}
              onClick={() => onSelect(c.id)}
              onDoubleClick={() => {
                setEditingId(c.id);
                setEditName(c.name);
              }}
              title="双击重命名"
            >
              <span className="cat-dot" style={{ background: c.color }} />
              <span className="side-label-text">{c.name}</span>
              <span className="side-count">{count(c.id)}</span>
              <span
                className="side-del"
                title="删除分类"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDel(c.id);
                }}
              >
                ×
              </span>
            </button>
          );
        })}

        {creating && (
          <div className="side-input-row">
            <span className="cat-dot" style={{ background: CAT_COLORS[categories.length % CAT_COLORS.length] }} />
            <input
              ref={newRef}
              className="side-input"
              placeholder="分类名称"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitNew();
                if (e.key === "Escape") setCreating(false);
              }}
              onBlur={submitNew}
            />
          </div>
        )}

        {categories.length === 0 && !creating && (
          <p className="side-hint">点击右上角 ＋ 新建分类，把文件归类管理</p>
        )}
      </div>
      {children}
    </aside>
  );
}
