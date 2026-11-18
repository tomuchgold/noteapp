import { useEffect, useRef } from "react";
import type { LineHit } from "../lib/search";

export interface SearchResultsProps {
  open: boolean;
  title: string;
  hits: LineHit[];
  activeLine?: number | null;
  onJump: (line: number) => void;
  onClose: () => void;
  onClear?: () => void;
}

/** 把一行文本按命中区间切成 高亮/普通 片段 */
function Segments({ text, ranges }: { text: string; ranges: LineHit["ranges"] }) {
  if (ranges.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((r, i) => {
    if (r.start > cursor) parts.push(<span key={`p${i}`}>{text.slice(cursor, r.start)}</span>);
    parts.push(<mark key={`m${i}`}>{text.slice(r.start, r.end)}</mark>);
    cursor = r.end;
  });
  if (cursor < text.length) parts.push(<span key="tail">{text.slice(cursor)}</span>);
  return <>{parts}</>;
}

/**
 * 搜索结果面板（Notepad++ 风格）：行号 + 命中行内容（命中词高亮），点击跳到该行。
 * 位于编辑器下方，可拖高；固定在查找栏之后、状态栏之前。
 */
export default function SearchResults({
  open, title, hits, activeLine, onJump, onClose, onClear,
}: SearchResultsProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // 命中变化时回到顶部；当前命中行滚动到可视区
  useEffect(() => {
    if (!open) return;
    if (activeLine == null) {
      listRef.current?.scrollTo({ top: 0 });
      return;
    }
    const el = listRef.current?.querySelector(`[data-line="${activeLine}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [open, hits, activeLine]);

  if (!open) return null;

  const total = hits.reduce((n, h) => n + h.ranges.length, 0);

  return (
    <div className="search-results">
      <div className="search-results-head">
        <span className="search-results-title">
          {title}
          {hits.length > 0 && (
            <span className="dim">　{total} 处命中，{hits.length} 行</span>
          )}
        </span>
        <span className="spacer" />
        {onClear && hits.length > 0 && (
          <button className="search-results-btn" onClick={onClear} title="清空结果">清空</button>
        )}
        <button className="search-results-btn" onClick={onClose} title="关闭结果面板">×</button>
      </div>
      <div className="search-results-list" ref={listRef}>
        {hits.length === 0 ? (
          <div className="search-results-empty">没有匹配结果</div>
        ) : (
          hits.map((h) => (
            <button
              key={h.line}
              data-line={h.line}
              className={`search-results-hit ${activeLine === h.line ? "cur" : ""}`}
              onClick={() => onJump(h.line)}
              title={`跳到第 ${h.line} 行`}
            >
              <span className="search-results-line">{h.line}</span>
              <span className="search-results-text">
                <Segments text={h.text} ranges={h.ranges} />
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
