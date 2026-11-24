import { useEffect, useState } from "react";

interface Props {
  title: string;
  source: string;
  loading: boolean;
  error: string | null;
  result: string;
  model?: string;
  tokens?: number;
  /** 插入/替换时使用编辑后的文本 */
  onReplace: (text: string) => void;
  onInsert: (text: string) => void;
  onClose: () => void;
  onRetry?: () => void;
  /** 收起到后台（v0.27：AI 运行/结果不阻塞编辑，状态栏可点回） */
  onMinimize?: () => void;
}

export default function AiResultDialog({
  title,
  source,
  loading,
  error,
  result,
  model,
  tokens,
  onReplace,
  onInsert,
  onClose,
  onRetry,
  onMinimize,
}: Props) {
  const [text, setText] = useState(result);
  const [copied, setCopied] = useState(false);

  // 结果到达后同步（每次请求结果变化时重置编辑内容）
  useEffect(() => {
    setText(result);
  }, [result]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* 忽略剪贴板权限问题 */
    }
  }

  return (
    <div className="modal-mask ai-float">
      <div className="modal ai-result" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <div className="grow" />
          {onMinimize && (
            <button className="icon-btn" onClick={onMinimize} title="收起到后台：不挡编辑，AI 继续运行，状态栏可点回">
              ▼
            </button>
          )}
          <button className="icon-btn" onClick={onClose} title="关闭">
            ×
          </button>
        </div>

        <div className="modal-body">
          <details className="ai-source">
            <summary>原文（{source.length} 字符）</summary>
            <pre>{source}</pre>
          </details>

          {loading ? (
            <div className="ai-loading">
              <span className="spinner" /> 正在请求模型…
            </div>
          ) : error ? (
            <div className="msg err">
              {error}
              {onRetry && (
                <button className="link" onClick={onRetry}>
                  重试
                </button>
              )}
            </div>
          ) : (
            <textarea
              className="ai-output"
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
            />
          )}
        </div>

        <div className="modal-foot">
          <span className="hint">
            {model ? `模型：${model}` : ""}
            {tokens ? ` · ${tokens} tokens` : ""}
          </span>
          <div className="grow" />
          <button onClick={copy} disabled={loading || !!error}>
            {copied ? "已复制" : "复制"}
          </button>
          <button onClick={() => onInsert(text)} disabled={loading || !!error}>
            插入到光标
          </button>
          <button className="primary" onClick={() => onReplace(text)} disabled={loading || !!error}>
            替换选中
          </button>
        </div>
      </div>
    </div>
  );
}
