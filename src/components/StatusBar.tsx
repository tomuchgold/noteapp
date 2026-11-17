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
}

export default function StatusBar({ line, col, selected, lines, encoding, bom, eol, language, path }: Props) {
  const sizeText = path ? path : "未保存";
  return (
    <div className="statusbar">
      <span className="status-item" title={sizeText}>
        {sizeText}
      </span>
      <span className="status-item">行 {line}, 列 {col}</span>
      {selected > 0 && <span className="status-item">选中 {selected} 字符</span>}
      <span className="status-item">共 {lines} 行</span>
      <span className="spacer" />
      <span className="status-item">{language}</span>
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
