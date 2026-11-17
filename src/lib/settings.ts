/**
 * 编辑器样式规则设置（看板：编辑器具体样式规则）
 * 持久化于 localStorage，实时应用到 CodeMirror。
 */

export interface EditorSettings {
  /** 正文字号 px（11–24） */
  fontSize: number;
  /** 行高倍数（1.2–2.4） */
  lineHeight: number;
  /** Tab 宽度（空格数） */
  tabSize: number;
  /** 自动换行 */
  wrap: boolean;
  /** 显示空白符（空格/Tab 可视化） */
  showWhitespace: boolean;
  /** 当前行高亮 */
  activeLine: boolean;
  /** 编辑器主题 */
  theme: "dark" | "light";
}

export const DEFAULT_SETTINGS: EditorSettings = {
  fontSize: 14,
  lineHeight: 1.6,
  tabSize: 4,
  wrap: true,
  showWhitespace: false,
  activeLine: true,
  theme: "dark",
};

const KEY = "notepp.editor-settings";

export function loadSettings(): EditorSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const v = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...(v && typeof v === "object" ? v : {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: EditorSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function clampSettings(s: EditorSettings): EditorSettings {
  const clamp = (n: number, lo: number, hi: number, fb: number) =>
    Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fb;
  return {
    fontSize: clamp(Math.round(s.fontSize), 11, 24, DEFAULT_SETTINGS.fontSize),
    lineHeight: clamp(s.lineHeight, 1.2, 2.4, DEFAULT_SETTINGS.lineHeight),
    tabSize: [2, 4, 8].includes(s.tabSize) ? s.tabSize : 4,
    wrap: !!s.wrap,
    showWhitespace: !!s.showWhitespace,
    activeLine: !!s.activeLine,
    theme: s.theme === "light" ? "light" : "dark",
  };
}
