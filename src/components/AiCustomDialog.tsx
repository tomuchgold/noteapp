import { useState } from "react";

interface Props {
  source: string;
  onSubmit: (instruction: string) => void;
  onClose: () => void;
}

/** 自定义指令输入框（右键 → 自定义指令…） */
export default function AiCustomDialog({ source, onSubmit, onClose }: Props) {
  const [instruction, setInstruction] = useState("");

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal ai-custom" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>自定义 AI 指令</h2>
          <button className="icon-btn" onClick={onClose} title="关闭">
            ×
          </button>
        </div>
        <div className="modal-body">
          <label className="field">
            <span>要模型做什么？</span>
            <input
              autoFocus
              value={instruction}
              placeholder="例如：改写成正式邮件语气 / 提取所有 URL / 检查语法错误"
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && instruction.trim()) onSubmit(instruction.trim());
              }}
            />
          </label>
          <details className="ai-source">
            <summary>将处理这段内容（{source.length} 字符）</summary>
            <pre>{source}</pre>
          </details>
        </div>
        <div className="modal-foot">
          <div className="grow" />
          <button onClick={onClose}>取消</button>
          <button className="primary" disabled={!instruction.trim()} onClick={() => onSubmit(instruction.trim())}>
            执行
          </button>
        </div>
      </div>
    </div>
  );
}
