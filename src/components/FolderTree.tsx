import { useCallback, useEffect, useRef, useState } from "react";
import { listDir, type DirEntryInfo } from "../lib/files";

interface Props {
  /** 打开的文件夹根路径；null 时显示引导 */
  root: string | null;
  activePath: string | null;
  /** App 侧完成新建/重命名/删除后 +1，触发树刷新 */
  reloadKey: number;
  onOpenFile: (path: string) => void;
  onPickFolder: () => void;
  onClear: () => void;
  /** 文件操作（由 App 实现：输入名称 + fs 命令 + 刷新） */
  onCreateFile: (dir: string) => void;
  onCreateFolder: (dir: string) => void;
  onRename: (path: string) => void;
  onDelete: (path: string) => void;
  onReveal: (path: string) => void;
  /** 一键打开目录下所有文本文件 */
  onOpenAll: (dir: string) => void;
  /** 打开某文件所在的文件夹（设为目录树根） */
  onOpenFolderOf: (path: string) => void;
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

/** 右键菜单状态：target 为 null 表示空白处（作用于根目录） */
interface CtxMenu {
  x: number;
  y: number;
  target: DirEntryInfo | null;
}

export default function FolderTree({
  root,
  activePath,
  reloadKey,
  onOpenFile,
  onPickFolder,
  onClear,
  onCreateFile,
  onCreateFolder,
  onRename,
  onDelete,
  onReveal,
  onOpenAll,
  onOpenFolderOf,
}: Props) {
  const [entries, setEntries] = useState<DirEntryInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [children, setChildren] = useState<Record<string, DirEntryInfo[]>>({});
  const [loading, setLoading] = useState(false);
  const [menu, setMenu] = useState<CtxMenu | null>(null);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const prevRootRef = useRef<string | null>(null);

  /** 重新加载根目录；reset=false 时保留展开状态并同步刷新所有已展开的子目录 */
  const doRefresh = useCallback(
    async (r: string, reset: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const es = await listDir(r);
        setEntries(es);
        if (reset) {
          setExpanded(new Set());
          setChildren({});
          return;
        }
        // 保留展开状态：逐个刷新已展开子目录的内容
        const dirs = [...expandedRef.current];
        if (dirs.length > 0) {
          const results = await Promise.all(
            dirs.map((d) => listDir(d).catch(() => [] as DirEntryInfo[]))
          );
          setChildren((c) => {
            const next = { ...c };
            dirs.forEach((d, i) => {
              next[d] = results[i];
            });
            return next;
          });
          // 已被删除/不存在的目录自动收起
          const gone = dirs.filter((d, i) => es.every((e) => e.path !== d) && results[i].length === 0);
          if (gone.length > 0) {
            setExpanded((prev) => {
              const n = new Set(prev);
              gone.forEach((d) => n.delete(d));
              return n;
            });
          }
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // 根目录变化 → 全量重置加载；reloadKey 变化（新建/重命名/删除/另存为/外部刷新）→ 保留展开刷新
  useEffect(() => {
    if (!root) {
      setEntries([]);
      setError(null);
      setExpanded(new Set());
      setChildren({});
      prevRootRef.current = null;
      return;
    }
    saveFolder(root);
    const reset = prevRootRef.current !== root;
    prevRootRef.current = root;
    void doRefresh(root, reset);
  }, [root, reloadKey, doRefresh]);

  // 右键菜单：点击空白 / 失焦 / Esc 关闭
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

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

  const openMenu = (e: React.MouseEvent, target: DirEntryInfo | null) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({
      x: Math.min(e.clientX, window.innerWidth - 170),
      y: Math.min(e.clientY, window.innerHeight - 210),
      target,
    });
  };

  const renderItemMenu = (t: DirEntryInfo) => (
    <>
      {!t.is_dir && <button onClick={() => { setMenu(null); onOpenFile(t.path); }}>打开</button>}
      {!t.is_dir && <button onClick={() => { setMenu(null); onOpenFolderOf(t.path); }}>📂 打开所在文件夹</button>}
      {t.is_dir && <button onClick={() => { setMenu(null); onCreateFile(t.path); }}>新建文件</button>}
      {t.is_dir && <button onClick={() => { setMenu(null); onCreateFolder(t.path); }}>新建文件夹</button>}
      {t.is_dir && <button onClick={() => { setMenu(null); onOpenAll(t.path); }}>全部打开</button>}
      <button onClick={() => { setMenu(null); onReveal(t.path); }}>🖥️ 在系统中显示</button>
      <button onClick={() => { setMenu(null); onRename(t.path); }}>重命名</button>
      <button onClick={() => { setMenu(null); onDelete(t.path); }}>删除</button>
    </>
  );

  const renderRootMenu = () => (
    root ? (
      <>
        <button onClick={() => { setMenu(null); onCreateFile(root); }}>新建文件</button>
        <button onClick={() => { setMenu(null); onCreateFolder(root); }}>新建文件夹</button>
        <button onClick={() => { setMenu(null); onOpenAll(root); }}>全部打开</button>
        <button onClick={() => { setMenu(null); onPickFolder(); }}>切换文件夹…</button>
        <button onClick={() => { setMenu(null); onReveal(root); }}>🖥️ 在系统中显示</button>
      </>
    ) : (
      // 未打开文件夹时只提供入口，避免对空路径操作报错
      <button onClick={() => { setMenu(null); onPickFolder(); }}>📂 打开文件夹…</button>
    )
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
            onContextMenu={(ev) => openMenu(ev, e)}
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
    <div
      className="sidebar-section grow folder-section"
      onContextMenu={(ev) => {
        // 只有落在空白处（不是树节点）时才弹根目录菜单
        if (!(ev.target as HTMLElement).closest(".tree-item")) openMenu(ev, null);
      }}
      onDoubleClick={(ev) => {
        if (!(ev.target as HTMLElement).closest(".tree-item") && root) onCreateFile(root);
      }}
    >
      <div className="side-group-title folder-title">
        文件夹
        <span className="folder-actions">
          <button className="mini" onClick={onPickFolder} title="打开文件夹">
            打开
          </button>
          {root && (
            <button className="mini" onClick={() => root && onCreateFile(root)} title="在根目录新建文件">
              ＋
            </button>
          )}
          {root && (
            <button className="mini" onClick={() => root && void doRefresh(root, false)} title="刷新文件夹树（保留展开状态）">
              ⟳
            </button>
          )}
          {root && (
            <button className="mini" onClick={onClear} title="关闭文件夹">
              ×
            </button>
          )}
        </span>
      </div>

      {!root && (
        <p className="side-hint">打开一个文件夹，在侧栏直接浏览并打开里面的文件；右键空白处可新建</p>
      )}
      {root && loading && <div className="tree-loading">加载中…</div>}
      {root && error && <p className="side-hint danger-text">{error.slice(0, 120)}</p>}
      {root && !loading && entries.length === 0 && !error && (
        <p className="side-hint">空文件夹：右键这里可新建文件</p>
      )}
      {root && renderNodes(entries, 0)}

      {menu && (
        <div className="context-menu folder-context-menu" style={{ display: "block", left: menu.x, top: menu.y }}>
          {menu.target ? renderItemMenu(menu.target) : renderRootMenu()}
        </div>
      )}
    </div>
  );
}
