import { useCallback, useEffect, useState } from "react";
import { listDir, type DirEntryInfo } from "../lib/files";

interface Props {
  /** 打开的文件夹根路径；null 时显示引导 */
  root: string | null;
  activePath: string | null;
  onOpenFile: (path: string) => void;
  onPickFolder: () => void;
  onClear: () => void;
}

const FOLDER_KEY = "notepp.folder";

export function loadSavedFolder(): string | null {
  try {
    return localStorage.getItem(FOLDER_KEY) || null;
  } catch {
    return null;
  }
}

function saveFolder(path: string | null) {
  try {
    if (path) localStorage.setItem(FOLDER_KEY, path);
    else localStorage.removeItem(FOLDER_KEY);
  } catch {
    /* ignore */
  }
}

export default function FolderTree({
  root,
  activePath,
  onOpenFile,
  onPickFolder,
  onClear,
}: Props) {
  const [entries, setEntries] = useState<DirEntryInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [children, setChildren] = useState<Record<string, DirEntryInfo[]>>({});
  const [loading, setLoading] = useState(false);

  // 根目录变化 → 加载根层级
  useEffect(() => {
    if (!root) {
      setEntries([]);
      setError(null);
      return;
    }
    saveFolder(root);
    setLoading(true);
    setError(null);
    listDir(root)
      .then((es) => {
        setEntries(es);
        setExpanded(new Set());
        setChildren({});
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [root]);

  const toggle = useCallback(
    async (dir: DirEntryInfo) => {
      if (!dir.is_dir) return;
      const next = new Set(expanded);
      if (next.has(dir.path)) {
        next.delete(dir.path);
        setExpanded(next);
        return;
      }
      if (!children[dir.path]) {
        try {
          const es = await listDir(dir.path);
          setChildren((c) => ({ ...c, [dir.path]: es }));
        } catch (e) {
          setChildren((c) => ({ ...c, [dir.path]: [] }));
          setError(String(e));
        }
      }
      next.add(dir.path);
      setExpanded(next);
    },
    [expanded, children]
  );

  const renderNodes = (list: DirEntryInfo[], depth: number) =>
    list.map((e) => {
      const open = expanded.has(e.path);
      return (
        <div key={e.path}>
          <button
            className={`side-item tree-item ${!e.is_dir && activePath === e.path ? "active" : ""}`}
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() => (e.is_dir ? toggle(e) : onOpenFile(e.path))}
            title={e.path}
          >
            <span className="tree-caret">{e.is_dir ? (open ? "▾" : "▸") : ""}</span>
            <span className="tree-icon">{e.is_dir ? "📁" : "📄"}</span>
            <span className="side-label-text">{e.name}</span>
          </button>
          {e.is_dir && open && children[e.path] && renderNodes(children[e.path], depth + 1)}
          {e.is_dir && open && !children[e.path] && (
            <div className="tree-loading" style={{ paddingLeft: 8 + depth * 14 + 26 }}>
              加载中…
            </div>
          )}
        </div>
      );
    });

  return (
    <div className="sidebar-section grow folder-section">
      <div className="side-group-title folder-title">
        文件夹
        <span className="folder-actions">
          <button className="mini" onClick={onPickFolder} title="打开文件夹">
            打开
          </button>
          {root && (
            <button className="mini" onClick={onClear} title="关闭文件夹">
              ×
            </button>
          )}
        </span>
      </div>

      {!root && (
        <p className="side-hint">打开一个文件夹，在侧栏直接浏览并打开里面的文件</p>
      )}
      {root && loading && <div className="tree-loading">加载中…</div>}
      {root && error && <p className="side-hint danger-text">{error.slice(0, 120)}</p>}
      {root && !loading && entries.length === 0 && !error && (
        <p className="side-hint">空文件夹</p>
      )}
      {root && renderNodes(entries, 0)}
    </div>
  );
}
