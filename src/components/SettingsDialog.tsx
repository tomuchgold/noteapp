import { useState } from "react";
import { DEFAULT_SETTINGS, ZOOM_MAX, ZOOM_MIN, type EditorSettings } from "../lib/settings";
import {
  allThemes,
  isValidTheme,
  loadCustomThemes,
  saveCustomThemes,
  themeTemplate,
  type ThemeDef,
} from "../lib/themes";

interface Props {
  value: EditorSettings;
  onChange: (s: EditorSettings) => void;
  onClose: () => void;
}

export default function SettingsDialog({ value, onChange, onClose }: Props) {
  const set = (patch: Partial<EditorSettings>) => onChange({ ...value, ...patch });
  const [themes, setThemes] = useState<ThemeDef[]>(() => allThemes());
  const [customMsg, setCustomMsg] = useState<string | null>(null);

  const importCustom = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const list: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
        const valid = list.filter(isValidTheme) as ThemeDef[];
        if (valid.length === 0) {
          setCustomMsg("导入失败：JSON 不是合法的主题格式（可用「导出模板」参考）");
          return;
        }
        const existing = loadCustomThemes().filter(
          (t) => !valid.some((v) => v.id === t.id)
        );
        const merged = [...existing, ...valid];
        saveCustomThemes(merged);
        setThemes(allThemes());
        setCustomMsg(`已导入 ${valid.length} 个主题：${valid.map((t) => t.name).join("、")}`);
      } catch (e) {
        setCustomMsg(`导入失败：${e instanceof Error ? e.message : e}`);
      }
    };
    input.click();
  };

  const exportCustom = () => {
    const custom = loadCustomThemes();
    if (custom.length === 0) {
      setCustomMsg("还没有自定义主题。可先导入 JSON，或用「导出模板」自己改一份。");
      return;
    }
    const blob = new Blob([JSON.stringify(custom, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "notepp-themes.json";
    a.click();
    URL.revokeObjectURL(a.href);
    setCustomMsg(`已导出 ${custom.length} 个自定义主题`);
  };

  const exportTemplate = () => {
    const blob = new Blob([themeTemplate()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "notepp-theme-template.json";
    a.click();
    URL.revokeObjectURL(a.href);
    setCustomMsg("模板已下载：改好颜色后用「导入主题」加进来");
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal settings" onClick={(e) => e.stopPropagation()}>
        <h3>编辑器设置</h3>

        <div className="setting-row">
          <label>
            基准字号
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
            缩放
            <span className="dim">{value.zoom}%（最大 300%）</span>
          </label>
          <input
            type="range"
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={5}
            value={value.zoom}
            onChange={(e) => set({ zoom: Number(e.target.value) })}
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
          <div className="theme-grid">
            {themes.map((t) => (
              <button
                key={t.id}
                className={`theme-swatch ${value.theme === t.id ? "on" : ""}`}
                style={{ background: t.colors.bg, color: t.colors.fg }}
                title={`${t.name}${loadCustomThemes().some((c) => c.id === t.id) ? "（自定义）" : ""}`}
                onClick={() => set({ theme: t.id })}
              >
                <span className="theme-swatch-a" style={{ background: t.colors.accent }} />
                <span className="theme-swatch-p" style={{ background: t.colors.para }} />
                {t.name}
              </button>
            ))}
          </div>
          <div className="theme-ops">
            <button onClick={importCustom}>导入主题</button>
            <button onClick={exportCustom}>导出我的主题</button>
            <button onClick={exportTemplate}>导出模板</button>
          </div>
          {customMsg && <div className="dim theme-msg">{customMsg}</div>}
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

        <div className="setting-row">
          <label>当前段落高亮</label>
          <input
            type="checkbox"
            checked={value.paragraphHighlight}
            onChange={(e) => set({ paragraphHighlight: e.target.checked })}
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
