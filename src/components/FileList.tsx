import { useEffect, useState } from "react";
import { relTime, type Category, type LibraryFile } from "../lib/library";

interface Props {
  title: string;
  files: LibraryFile[];
  activePath: string | null;
  query: string;
  categories: Category[];
  onQuery: (q: string) => void;
  onOpen: (path: string) => void;
  onToggleFav: (path: string) => void;
  onAssign: (path: string, category: string | null) => void;
  onRemove: (path: string) => void;
  onNewFile: () => void;
  /** 打开文件所在文件夹（设为侧栏目录树根） */
  onOpenFolderOf: (path: string) => void;
  /** 在系统文件管理器中定位该文件 */
  onReveal: (path: string) => void;
  /** 关闭文件列表（v0.26） */
  onClose?: () => void;
}

export default function FileList({
  title,
  files,
  activePath,
  query,
  categories,
  onQuery,
  onOpen,
  onToggleFav,
  onAssign,
  onRemove,
  onNewFile,
  onOpenFolderOf,
  onReveal,
  onClose,
}: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  const menuFile = menu ? files.find((f) => f.path === menu.path) : null;

  return (
    <section className="filelist">
      <div className="filelist-head">
        <span className="filelist-title">{title}</span>
        <span className="filelist-count">{files.length}</span>
        <button className="icon-btn" title="新建文件 (Ctrl+N)" onClick={onNewFile}>
          ＋
        </button>
        {onClose && (
          <button className="icon-btn" title="关闭文件列表" onClick={onClose}>
            ×
          </button>
        )}
      </div>

      <div className="filelist-search">
        <input
          value={query}
          placeholder="搜索文件"
          onChange={(e) => onQuery(e.target.value)}
        />
        {query && (
          <button className="search-clear" title="清除" onClick={() => onQuery("")}>
            ×
          </button>
        )}
      </div>

      <div className="filelist-body">
        {files.length === 0 ? (
          <div className="filelist-empty">
            <p>暂无文件</p>
            <p className="dim">用 Ctrl+O 打开，或直接把文件拖进窗口</p>
          </div>
        ) : (
          files.map((f) => (
            <div
              key={f.path}
              className={`file-row ${activePath === f.path ? "active" : ""}`}
              onClick={() => onOpen(f.path)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, path: f.path });
              }}
              title={f.path}
            >
              <div className="file-row-line">
                <span className="file-name">{f.name}</span>
                <span className="file-time">{relTime(f.lastOpened)}</span>
              </div>
              <div className="file-row-sub">
                <span className="file-preview">{f.preview || "（空文件）"}</span>
              </div>
              <div className="file-row-line">
                <span className="file-path">{f.path}</span>
                {f.favorite && <span className="file-star">★</span>}
              </div>
              <button
                className={`row-star ${f.favorite ? "on" : ""}`}
                title={f.favorite ? "取消收藏" : "收藏"}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFav(f.path);
                }}
              >
                {f.favorite ? "★" : "☆"}
              </button>
            </div>
          ))
        )}
      </div>

      {menu && menuFile && (
        <div
          className="ctx-menu"
          style={{ left: Math.min(menu.x, window.innerWidth - 190), top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="ctx-item"
            onClick={() => {
              onOpenFolderOf(menu.path);
              setMenu(null);
            }}
          >
            📂 打开所在文件夹
          </button>
          <button
            className="ctx-item"
            onClick={() => {
              void onReveal(menu.path);
              setMenu(null);
            }}
          >
            🖥️ 在系统中显示
          </button>
          <div className="ctx-title">移动到分类</div>
          <button
            className="ctx-item"
            onClick={() => {
              onAssign(menu.path, null);
              setMenu(null);
            }}
          >
            <span className="cat-dot" style={{ background: "#6b6f76" }} />
            未分类
            {!menuFile.category && <span className="ctx-check">✓</span>}
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              className="ctx-item"
              onClick={() => {
                onAssign(menu.path, c.id);
                setMenu(null);
              }}
            >
              <span className="cat-dot" style={{ background: c.color }} />
              {c.name}
              {menuFile.category === c.id && <span className="ctx-check">✓</span>}
            </button>
          ))}
          <div className="ctx-sep" />
          <button
            className="ctx-item"
            onClick={() => {
              onToggleFav(menu.path);
              setMenu(null);
            }}
          >
            {menuFile.favorite ? "取消收藏" : "加入收藏"}
          </button>
          <button
            className="ctx-item danger"
            onClick={() => {
              onRemove(menu.path);
              setMenu(null);
            }}
          >
            从文件库移除
          </button>
        </div>
      )}
    </section>
  );
}
