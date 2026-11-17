import { useState } from "react";

interface Props {
  /** 生成 markdown 表格文本 */
  onInsert: (text: string) => void;
  onClose: () => void;
}

/** 简易表格：输入行列数，生成 markdown 表格模板 */
export default function InsertTableDialog({ onInsert, onClose }: Props) {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);

  const build = () => {
    const header = `| ${Array.from({ length: cols }, (_, i) => `列${i + 1}`).join(" | ")} |`;
    const sep = `| ${Array.from({ length: cols }, () => "---").join(" | ")} |`;
    const body = Array.from({ length: Math.max(0, rows - 1) }, () =>
      `| ${Array.from({ length: cols }, () => " ").join(" | ")} |`
    ).join("\n");
    const table = body ? `${header}\n${sep}\n${body}` : `${header}\n${sep}`;
    return `\n${table}\n`;
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>插入表格（Markdown）</h3>
        <div className="table-rows-cols">
          <label>
            行数
            <input
              type="number"
              min={2}
              max={50}
              value={rows}
              onChange={(e) => setRows(Math.max(2, Math.min(50, Number(e.target.value) || 2)))}
            />
          </label>
          <label>
            列数
            <input
              type="number"
              min={1}
              max={20}
              value={cols}
              onChange={(e) => setCols(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
            />
          </label>
        </div>
        <div className="modal-actions">
          <button className="primary" onClick={() => { onInsert(build()); onClose(); }}>
            插入
          </button>
          <button onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  );
}
