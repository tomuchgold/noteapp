interface Props {
  line: number;
  col: number;
  selected: number;
  lines: number;
  encoding: string;
  bom: boolean;
  eol: string;
  language: string;
  path: string | null;
  /** 全文字符数（含空格换行） */
  chars?: number;
  /** 全文「字数」：中文按字计，英文按词计 */
  words?: number;
  /** 缩放百分比（点击复位 100%） */
  zoom?: number;
}

/** 估算字数：CJK 字符逐字计数，其余按空白分词 */
export function countWords(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/g) ?? []).length;
  const words = text.replace(/[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/g, " ").split(/\s+/).filter(Boolean).length;
  return cjk + words;
}

export default function StatusBar({ line, col, selected, lines, encoding, bom, eol, language, path, chars, words, zoom }: Props) {
  const sizeText = path ? path : "未保存";
  return (
    <div className="statusbar">
      <span className="status-item" title={sizeText}>
        {sizeText}
      </span>
      <span className="status-item">行 {line}, 列 {col}</span>
      {selected > 0 && <span className="status-item">选中 {selected} 字符</span>}
      <span className="status-item">共 {lines} 行</span>
      {typeof chars === "number" && (
        <span className="status-item" title="全文统计：字数（中文按字/英文按词） · 字符数">
          {words ?? 0} 字 · {chars} 字符
        </span>
      )}
      <span className="spacer" />
      <span className="status-item">{language}</span>
      {typeof zoom === "number" && (
        <span
          className="status-item clickable"
          title="Ctrl/⌘+滚轮缩放，Ctrl+0 复位 100%（点击复位）"
          onClick={() => window.dispatchEvent(new CustomEvent("notepp.zoom-reset"))}
        >
          {zoom}%
        </span>
      )}
      <span
        className="status-item clickable"
        title="点击切换编码"
        onClick={() => window.dispatchEvent(new CustomEvent("notepp.cycle-encoding"))}
      >
        {encoding}{bom ? " BOM" : ""}
      </span>
      <span className="status-item">{eol === "CRLF" ? "Windows (CRLF)" : eol === "LF" ? "Unix (LF)" : eol}</span>
    </div>
  );
}
