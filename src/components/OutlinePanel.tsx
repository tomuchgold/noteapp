export interface OutlineHeading {
  level: number;
  text: string;
  line: number;
}

interface Props {
  open: boolean;
  headings: OutlineHeading[];
  onJump: (line: number) => void;
  onClose: () => void;
}

/** 大纲/目录面板：解析当前文件 Markdown 标题（#/##/###…，不限扩展名），点击跳转 */
export default function OutlinePanel({ open, headings, onJump, onClose }: Props) {
  if (!open) return null;
  return (
    <div className="anno-panel outline-panel">
      <div className="anno-panel-head">
        <span className="anno-panel-title">
          目录<span className="dim">　{headings.length} 节</span>
        </span>
        <span className="spacer" />
        <button className="anno-panel-close" onClick={onClose} title="关闭目录面板">
          ✕ 关闭
        </button>
      </div>
      <div className="anno-panel-list">
        {headings.length === 0 ? (
          <div className="anno-panel-empty">
            未找到标题。用 Markdown 语法写标题（如 <code># 一级</code>、<code>## 二级</code>）即可生成目录。
          </div>
        ) : (
          headings.map((h, i) => (
            <button
              key={`${h.line}-${i}`}
              className="outline-item"
              style={{ paddingLeft: `${6 + (h.level - 1) * 14}px` }}
              onClick={() => onJump(h.line)}
              title={`跳转到第 ${h.line} 行`}
            >
              <span className={`outline-h outline-h${h.level}`}>
                {"H" + h.level}
              </span>
              <span className="outline-text">{h.text || "(空标题)"}</span>
              <span className="outline-line">{h.line}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
