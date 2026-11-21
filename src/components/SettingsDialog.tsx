import { useState } from "react";
import { DEFAULT_SETTINGS, UI_SCALE_MAX, UI_SCALE_MIN, ZOOM_MAX, ZOOM_MIN, type EditorSettings } from "../lib/settings";
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

  /** 设置项标签：emoji 图标 + 名称 + 悬停说明（原生 title，桌面与安卓均可用） */
  const Label = ({ icon, name, tip, dim }: { icon: string; name: string; tip: string; dim?: React.ReactNode }) => (
    <label title={tip}>
      <span className="setting-emoji" aria-hidden="true">{icon}</span>
      <span className="setting-name">{name}</span>
      {dim}
    </label>
  );

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
        <h3>编辑器设置 <span style={{opacity:.5,fontSize:12,fontWeight:400}}>v{__APP_VERSION__}</span></h3>

        <div className="setting-row">
          <Label icon="🔤" name="基准字号" tip="编辑区正文的基础字体大小（像素）。所有缩放都以此为起点。" dim={<span className="dim">{value.fontSize}px</span>} />
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
          <Label icon="🔍" name="正文字号缩放" tip="正文整体缩放比例。在编辑区按住 Ctrl/⌘ 滚动鼠标滚轮可快速调整，最大放大到 900px；Ctrl/⌘+0 复位。" dim={<span className="dim">{value.zoom}%（最大 900px）</span>} />
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
          <Label icon="🖥️" name="界面字号" tip="整体界面文字大小：菜单栏、侧栏、文件列表、标签栏、状态栏、各类面板等（不影响编辑区正文）。" dim={<span className="dim">{value.uiScale}% · 菜单/侧栏/面板</span>} />
          <input
            type="range"
            min={UI_SCALE_MIN}
            max={UI_SCALE_MAX}
            step={10}
            value={value.uiScale}
            onChange={(e) => set({ uiScale: Number(e.target.value) })}
          />
        </div>

        <div className="setting-row">
          <Label icon="🔎" name="查找框字号" tip="查找替换浮窗内的文字大小。也可直接点浮窗标题栏的 A− / A+ 按钮快速调整。" dim={<span className="dim">{value.findScale}%</span>} />
          <input
            type="range"
            min={UI_SCALE_MIN}
            max={UI_SCALE_MAX}
            step={10}
            value={value.findScale}
            onChange={(e) => set({ findScale: Number(e.target.value) })}
          />
        </div>

        <div className="setting-row">
          <Label icon="📏" name="行高" tip="正文每行之间的间距倍数。稍大的行高阅读更舒适。" dim={<span className="dim">×{value.lineHeight.toFixed(1)}</span>} />
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
          <Label icon="➡️" name="Tab 宽度" tip="按一次 Tab 键相当于几个空格的宽度，影响缩进对齐。" />
          <select
            value={value.tabSize}
            onChange={(e) => set({ tabSize: Number(e.target.value) })}
          >
            <option value={2}>2 空格</option>
            <option value={4}>4 空格</option>
            <option value={8}>8 空格</option>
          </select>
        </div>

        <div className="setting-row setting-theme">
          <Label icon="🎨" name="编辑器主题" tip="切换整体界面配色，包含编辑区与菜单/侧栏/状态栏等。可选内置主题，或导入自定义主题 JSON。" />
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
          <Label icon="↩️" name="自动换行" tip="行内容超出窗口宽度时自动折行显示，方便阅读长文本。" />
          <input
            type="checkbox"
            checked={value.wrap}
            onChange={(e) => set({ wrap: e.target.checked })}
          />
        </div>

        <div className="setting-row">
          <Label icon="🔳" name="显示空白符" tip="用可见符号标出空格与制表符，便于检查缩进和对齐（排版/代码场景很有用）。" />
          <input
            type="checkbox"
            checked={value.showWhitespace}
            onChange={(e) => set({ showWhitespace: e.target.checked })}
          />
        </div>

        <div className="setting-row">
          <Label icon="📍" name="当前行高亮" tip="用强调色淡染 + 行首竖条标出光标所在的整行，与主题背景明显区分。" />
          <input
            type="checkbox"
            checked={value.activeLine}
            onChange={(e) => set({ activeLine: e.target.checked })}
          />
        </div>

        <div className="setting-row">
          <Label icon="📄" name="当前段落高亮" tip="高亮光标所在的整个段落（以空行分隔的一段文字），方便聚焦当前写作段落。" />
          <input
            type="checkbox"
            checked={value.paragraphHighlight}
            onChange={(e) => set({ paragraphHighlight: e.target.checked })}
          />
        </div>

        <div className="setting-row">
          <Label icon="🌈" name="高亮颜色" tip="自定义当前行/段落高亮的颜色。留空则跟随当前主题的强调色（淡染背景 + 左侧竖条）。" dim={<span className="dim">{value.paraColor ? "自定义" : "跟随主题（强调色淡染+左竖条）"}</span>} />
          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="color"
              value={value.paraColor || "#3a4256"}
              disabled={!value.paragraphHighlight && !value.activeLine}
              onChange={(e) => set({ paraColor: e.target.value })}
              title="光标所在行/段落的高亮背景色"
            />
            {value.paraColor && (
              <button onClick={() => set({ paraColor: "" })} title="恢复为当前主题的配色">
                跟随主题
              </button>
            )}
          </span>
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
