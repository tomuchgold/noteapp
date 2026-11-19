/**
 * 编辑器样式规则设置（v0.6 起持续扩充）
 * 持久化于 localStorage，实时应用到 CodeMirror。
 */

export interface EditorSettings {
  /** 正文字号 px（11–24，缩放前的基准字号） */
  fontSize: number;
  /** 缩放百分比（25–300，Ctrl/⌘+滚轮调整，Ctrl+0 复位） */
  zoom: number;
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
  /** 当前段落高亮（亮色背景，覆盖光标所在整段） */
  paragraphHighlight: boolean;
  /** 光标行/段落高亮颜色（空 = 跟随当前主题） */
  paraColor: string;
  /** 编辑器主题（主题注册表 id，内置或自定义） */
  theme: string;
  /** 整体界面字号倍率（百分比，70–200；影响菜单/侧栏/状态栏等所有 UI） */
  uiScale: number;
  /** 查找浮窗字号倍率（百分比，70–200；在界面倍率基础上再叠加） */
  findScale: number;
}

export const DEFAULT_SETTINGS: EditorSettings = {
  fontSize: 14,
  zoom: 100,
  lineHeight: 1.6,
  tabSize: 4,
  wrap: true,
  showWhitespace: false,
  activeLine: true,
  paragraphHighlight: true,
  paraColor: "",
  theme: "dark",
  uiScale: 100,
  findScale: 100,
};

/** 界面/查找字号倍率范围 */
export const UI_SCALE_MIN = 70;
export const UI_SCALE_MAX = 200;

/** 缩放步进（百分比） */
export const ZOOM_STEP = 10;
export const ZOOM_MIN = 25;
/** 缩放上限：放大到 900px（用户要求），按基准字号换算 */
export const FONT_MAX_PX = 900;
export const ZOOM_MAX = 6500;

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
    zoom: clamp(Math.round(s.zoom), ZOOM_MIN, ZOOM_MAX, DEFAULT_SETTINGS.zoom),
    lineHeight: clamp(s.lineHeight, 1.2, 2.4, DEFAULT_SETTINGS.lineHeight),
    tabSize: [2, 4, 8].includes(s.tabSize) ? s.tabSize : 4,
    wrap: !!s.wrap,
    showWhitespace: !!s.showWhitespace,
    activeLine: !!s.activeLine,
    paragraphHighlight: !!s.paragraphHighlight,
    paraColor: typeof s.paraColor === "string" ? s.paraColor : "",
    theme: typeof s.theme === "string" && s.theme ? s.theme : DEFAULT_SETTINGS.theme,
    uiScale: clamp(s.uiScale, UI_SCALE_MIN, UI_SCALE_MAX, DEFAULT_SETTINGS.uiScale),
    findScale: clamp(s.findScale, UI_SCALE_MIN, UI_SCALE_MAX, DEFAULT_SETTINGS.findScale),
  };
}

/** 实际渲染字号（基准字号 × 缩放，上限 900px） */
export function effectiveFontSize(s: EditorSettings): number {
  const px = (s.fontSize * s.zoom) / 100;
  return Math.round(Math.min(px, FONT_MAX_PX) * 10) / 10;
}
