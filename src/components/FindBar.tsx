import { useEffect, useRef, useState } from "react";
import { isValidPattern, type FolderHitGroup, type SearchOptions } from "../lib/search";

export interface FindBarProps {
  open: boolean;
  /** 命中总数与当前序号（1 基；无命中为 0） */
  total: number;
  current: number;
  options: SearchOptions;
  query: string;
  /** 是否显示「在文件夹中查找」页签（需要已选文件夹） */
  folderRoot: string | null;
  /** 文件夹搜索结果 */
  folderHits: FolderHitGroup[];
  folderLoading: boolean;
  folderMessage: string | null;
  /** 替换结果提示（如「已替换 12 处」） */
  replaceMessage?: string | null;
  onQuery: (q: string) => void;
  onOptions: (o: SearchOptions) => void;
  /** 跳转上/下一处 */
  onStep: (dir: 1 | -1) => void;
  onReplace: (replacement: string) => void;
  onReplaceAll: (replacement: string) => void;
  /** 在文件夹中查找 */
  onFolderSearch: (q: string, o: SearchOptions) => void;
  onOpenHit: (path: string, line: number) => void;
  onClose: () => void;
  /** 从编辑器选区带入的查找词 */
  seed?: string;
}

type Tab = "file" | "folder";

export default function FindBar(props: FindBarProps) {
  const {
    open, total, current, options, query, folderRoot, folderHits, folderLoading,
    folderMessage, onQuery, onOptions, onStep, onReplace, onReplaceAll,
    onFolderSearch, onOpenHit, onClose, seed, replaceMessage,
  } = props;

  const [tab, setTab] = useState<Tab>("file");
  const [replacement, setReplacement] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // 打开时聚焦并全选；从选区带入查找词时一并填入
  useEffect(() => {
    if (!open) return;
    if (seed && seed.trim() && seed.length < 300) onQuery(seed.trim());
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const badPattern = !isValidPattern(query, options);
  const toggle = (k: keyof SearchOptions) => onOptions({ ...options, [k]: !options[k] });

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      // 焦点在替换框时回车 = 替换；在查找框时回车 = 跳下一处
      const inReplace = (e.target as HTMLElement).dataset.role === "replace";
      const inQuery = (e.target as HTMLElement).dataset.role === "query";
      if (inReplace) onReplace(replacement);
      else if (inQuery && tab === "file") onStep(e.shiftKey ? -1 : 1);
      else if (tab === "folder") onFolderSearch(query, options);
      else onStep(e.shiftKey ? -1 : 1);
    } else if (e.key === "F3") {
      e.preventDefault();
      onStep(e.shiftKey ? -1 : 1);
    }
  };

  const hitGroups = folderHits.length;
  const hitCount = folderHits.reduce((n, g) => n + g.hits.length, 0);

  return (
    <div className="findbar" onKeyDown={onKeyDown}>
      <div className="findbar-tabs">
        <button
          className={tab === "file" ? "on" : ""}
          onClick={() => setTab("file")}
          title="在当前文件内查找"
        >
          当前文件
        </button>
        <button
          className={tab === "folder" ? "on" : ""}
          onClick={() => {
            setTab("folder");
            if (query) onFolderSearch(query, options);
          }}
          disabled={!folderRoot}
          title={folderRoot ? `在文件夹中查找：${folderRoot}` : "先在左侧选择一个文件夹"}
        >
          在文件夹中
        </button>
        <span className="spacer" />
        <button className="findbar-close" onClick={onClose} title="关闭 (Esc)">×</button>
      </div>

      <div className="findbar-rows">
        <div className="findbar-row">
          <span className="findbar-label">查找</span>
          <input
            ref={inputRef}
            data-role="query"
            className={`findbar-input ${badPattern ? "bad" : ""} ${query && tab === "file" && total === 0 ? "empty" : ""}`}
            value={query}
            placeholder={options.regex ? "正则表达式" : "查找内容"}
            onChange={(e) => onQuery(e.target.value)}
            spellCheck={false}
          />
          {tab === "file" && (
            <span className={`findbar-count ${query && total === 0 ? "bad" : ""}`}>
              {query ? (badPattern ? "正则无效" : total === 0 ? "无结果" : `${current} / ${total}`) : ""}
            </span>
          )}
          <div className="findbar-toggles">
            <button className={options.caseSensitive ? "on" : ""} onClick={() => toggle("caseSensitive")} title="区分大小写">
              Aa
            </button>
            <button className={options.wholeWord ? "on" : ""} onClick={() => toggle("wholeWord")} title="全字匹配">
              ab
            </button>
            <button className={options.regex ? "on" : ""} onClick={() => toggle("regex")} title="正则表达式">
              .*
            </button>
          </div>
          {tab === "file" ? (
            <>
              <button className="findbar-btn" onClick={() => onStep(-1)} title="上一处 (Shift+Enter)">↑</button>
              <button className="findbar-btn" onClick={() => onStep(1)} title="下一处 (Enter)">↓</button>
            </>
          ) : (
            <button className="findbar-btn wide" onClick={() => onFolderSearch(query, options)} disabled={folderLoading}>
              {folderLoading ? "搜索中…" : "搜索"}
            </button>
          )}
        </div>

        {tab === "file" && (
          <div className="findbar-row">
            <span className="findbar-label">替换</span>
            <input
              className="findbar-input"
              data-role="replace"
              value={replacement}
              placeholder={options.regex ? "替换为（可用 $1 引用捕获组）" : "替换为"}
              onChange={(e) => setReplacement(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  onReplaceAll(replacement);
                }
              }}
              spellCheck={false}
            />
            <button className="findbar-btn wide" onClick={() => onReplace(replacement)} disabled={total === 0}>
              替换
            </button>
            <button className="findbar-btn wide" onClick={() => onReplaceAll(replacement)} disabled={total === 0}>
              全部替换
            </button>
          </div>
        )}
      </div>

      {replaceMessage && <div className="findbar-toast">{replaceMessage}</div>}

      {tab === "folder" && (
        <div className="findbar-results">
          <div className="findbar-results-head">
            {folderLoading
              ? "正在搜索…"
              : folderMessage
                ? folderMessage
                : hitCount > 0
                  ? `${hitCount} 处命中，${hitGroups} 个文件`
                  : query
                    ? "没有匹配结果"
                    : "输入关键词后回车搜索"}
          </div>
          {folderHits.map((g) => (
            <div key={g.path} className="findbar-group">
              <div className="findbar-group-head" title={g.path}>
                {g.name} <span className="dim">{g.hits.length}</span>
              </div>
              {g.hits.map((h) => (
                <button
                  key={`${h.line}-${h.col}`}
                  className="findbar-hit"
                  title={`${g.path}:${h.line}`}
                  onClick={() => onOpenHit(g.path, h.line)}
                >
                  <span className="findbar-hit-line">{h.line}</span>
                  <span className="findbar-hit-text">{h.text.trim()}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
