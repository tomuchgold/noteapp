import { DEFAULT_SETTINGS, type EditorSettings } from "../lib/settings";

interface Props {
  value: EditorSettings;
  onChange: (s: EditorSettings) => void;
  onClose: () => void;
}

export default function SettingsDialog({ value, onChange, onClose }: Props) {
  const set = (patch: Partial<EditorSettings>) => onChange({ ...value, ...patch });

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal settings" onClick={(e) => e.stopPropagation()}>
        <h3>编辑器设置</h3>

        <div className="setting-row">
          <label>
            字号
            <span className="dim">{value.fontSize}px</span>
          </label>
          <input
            type="range"
            min={11}
            max={24}
            step={1}
            value={value.fontSize}
            onChange={(e) => set({ fontSize: Number(e.target.value) })}
          />
        </div>

        <div className="setting-row">
          <label>
            行高
            <span className="dim">×{value.lineHeight.toFixed(1)}</span>
          </label>
          <input
            type="range"
            min={1.2}
            max={2.4}
            step={0.1}
            value={value.lineHeight}
            onChange={(e) => set({ lineHeight: Number(e.target.value) })}
          />
        </div>

        <div className="setting-row">
          <label>Tab 宽度</label>
          <select
            value={value.tabSize}
            onChange={(e) => set({ tabSize: Number(e.target.value) })}
          >
            <option value={2}>2 空格</option>
            <option value={4}>4 空格</option>
            <option value={8}>8 空格</option>
          </select>
        </div>

        <div className="setting-row">
          <label>编辑器主题</label>
          <select
            value={value.theme}
            onChange={(e) => set({ theme: e.target.value as EditorSettings["theme"] })}
          >
            <option value="dark">暗色（One Dark）</option>
            <option value="light">亮色</option>
          </select>
        </div>

        <div className="setting-row">
          <label>自动换行</label>
          <input
            type="checkbox"
            checked={value.wrap}
            onChange={(e) => set({ wrap: e.target.checked })}
          />
        </div>

        <div className="setting-row">
          <label>显示空白符</label>
          <input
            type="checkbox"
            checked={value.showWhitespace}
            onChange={(e) => set({ showWhitespace: e.target.checked })}
          />
        </div>

        <div className="setting-row">
          <label>当前行高亮</label>
          <input
            type="checkbox"
            checked={value.activeLine}
            onChange={(e) => set({ activeLine: e.target.checked })}
          />
        </div>

        <div className="modal-actions">
          <button onClick={() => onChange({ ...DEFAULT_SETTINGS })}>恢复默认</button>
          <button className="primary" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
