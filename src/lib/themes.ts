/**
 * 主题系统（v0.9）
 * - 内置多套配色（暗色 / 亮色 / 羊皮纸 / 日光 / 护眼绿 / Nord / Dracula / 赛博）
 * - 支持自定义主题：JSON 导入导出，localStorage 持久化，可增量扩充
 */

export interface ThemeColors {
  /** 编辑区背景 */
  bg: string;
  /** 正文文字 */
  fg: string;
  /** 行号栏背景 */
  gutterBg: string;
  /** 行号文字 */
  gutterFg: string;
  /** 当前行背景 */
  activeLine: string;
  /** 当前段落高亮（亮色，比 activeLine 更醒目） */
  para: string;
  /** 光标颜色 */
  caret: string;
  /** 强调色（按钮 / 链接 / 状态） */
  accent: string;
}

export interface ThemeDef {
  id: string;
  name: string;
  dark: boolean;
  colors: ThemeColors;
}

export const BUILTIN_THEMES: ThemeDef[] = [
  {
    id: "dark",
    name: "暗色（默认）",
    dark: true,
    colors: {
      bg: "#282c34", fg: "#abb2bf", gutterBg: "#21252b", gutterFg: "#7f848e",
      activeLine: "#2c313a", para: "#333846", caret: "#528bff", accent: "#61afef",
    },
  },
  {
    id: "light",
    name: "亮色",
    dark: false,
    colors: {
      bg: "#ffffff", fg: "#1f2328", gutterBg: "#f6f8fa", gutterFg: "#6a737d",
      activeLine: "#f0f4fa", para: "#ffe9a8", caret: "#1f2328", accent: "#0969da",
    },
  },
  {
    id: "sepia",
    name: "羊皮纸",
    dark: false,
    colors: {
      bg: "#f4ecd8", fg: "#5b4636", gutterBg: "#eaddc0", gutterFg: "#9a8470",
      activeLine: "#ece1c4", para: "#f3dfa0", caret: "#8b5e34", accent: "#a96e29",
    },
  },
  {
    id: "solar",
    name: "日光（Solarized）",
    dark: false,
    colors: {
      bg: "#fdf6e3", fg: "#586e75", gutterBg: "#eee8d5", gutterFg: "#93a1a1",
      activeLine: "#f5efdc", para: "#ede8a3", caret: "#268bd2", accent: "#268bd2",
    },
  },
  {
    id: "green",
    name: "护眼绿",
    dark: false,
    colors: {
      bg: "#c7edcc", fg: "#2b3a2e", gutterBg: "#b5dfbb", gutterFg: "#5f7d68",
      activeLine: "#b8e2bf", para: "#9fd8a8", caret: "#1f5c2e", accent: "#2f7d46",
    },
  },
  {
    id: "nord",
    name: "Nord",
    dark: true,
    colors: {
      bg: "#2e3440", fg: "#d8dee9", gutterBg: "#272c36", gutterFg: "#6f7787",
      activeLine: "#3b4252", para: "#434c5e", caret: "#88c0d0", accent: "#88c0d0",
    },
  },
  {
    id: "dracula",
    name: "Dracula",
    dark: true,
    colors: {
      bg: "#282a36", fg: "#f8f8f2", gutterBg: "#21222c", gutterFg: "#6272a4",
      activeLine: "#343746", para: "#44475a", caret: "#f8f8f0", accent: "#bd93f9",
    },
  },
  {
    id: "cyber",
    name: "赛博",
    dark: true,
    colors: {
      bg: "#16161f", fg: "#c9d3ff", gutterBg: "#101018", gutterFg: "#5a5f8c",
      activeLine: "#1e1e2c", para: "#2b2340", caret: "#00ffd5", accent: "#ff2ec4",
    },
  },
];

const CUSTOM_KEY = "notepp.custom-themes";

/** 自定义主题（localStorage 持久化） */
export function loadCustomThemes(): ThemeDef[] {
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter(isValidTheme);
  } catch {
    return [];
  }
}

export function saveCustomThemes(list: ThemeDef[]) {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

function isHexColor(s: unknown): s is string {
  return typeof s === "string" && /^#[0-9a-fA-F]{3,8}$/.test(s);
}

/** 校验导入的主题 JSON */
export function isValidTheme(t: unknown): t is ThemeDef {
  if (!t || typeof t !== "object") return false;
  const o = t as Partial<ThemeDef> & { colors?: Partial<ThemeColors> };
  const c = o.colors;
  return (
    typeof o.id === "string" && o.id.length > 0 &&
    typeof o.name === "string" && o.name.length > 0 &&
    typeof o.dark === "boolean" &&
    !!c &&
    isHexColor(c.bg) && isHexColor(c.fg) && isHexColor(c.gutterBg) &&
    isHexColor(c.gutterFg) && isHexColor(c.activeLine) && isHexColor(c.para) &&
    isHexColor(c.caret) && isHexColor(c.accent)
  );
}

/** 内置 + 自定义全部主题 */
export function allThemes(): ThemeDef[] {
  const custom = loadCustomThemes();
  const ids = new Set(BUILTIN_THEMES.map((t) => t.id));
  return [...BUILTIN_THEMES, ...custom.filter((t) => !ids.has(t.id))];
}

export function findTheme(id: string): ThemeDef {
  return allThemes().find((t) => t.id === id) ?? BUILTIN_THEMES[0];
}

/** hex → rgb 三元组 */
function hexRgb(hex: string): [number, number, number] {
  const m = hex.replace("#", "");
  const v = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 颜色混合：t=0 返回 a，t=1 返回 b */
function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexRgb(a);
  const [br, bg, bb] = hexRgb(b);
  const c = (x: number, y: number) => Math.round(x + (y - x) * t);
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(c(ar, br))}${h(c(ag, bg))}${h(c(ab, bb))}`;
}

/** hex → rgba 字符串 */
function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * 把主题配色映射为「整体界面」CSS 变量（菜单/侧栏/面板/按钮/查找框等）。
 * 由 App 在运行时注入到 document.documentElement，使切换主题时整个界面跟随变化。
 */
export function themeUiVars(t: ThemeDef): Record<string, string> {
  const c = t.colors;
  const dark = t.dark;
  // 面板底色：暗色主题向黑混合更深，亮色主题向白混合更浅，与编辑区形成层次
  const panel = dark ? mix(c.bg, "#000000", 0.16) : mix(c.bg, "#000000", 0.04);
  const panel2 = dark ? mix(c.bg, "#ffffff", 0.05) : mix(c.bg, "#000000", 0.02);
  const hover = dark ? mix(c.bg, "#ffffff", 0.09) : mix(c.bg, "#000000", 0.07);
  const active = dark ? mix(c.bg, "#ffffff", 0.15) : mix(c.bg, c.accent, 0.14);
  const border = dark ? mix(c.bg, "#ffffff", 0.13) : mix(c.bg, "#000000", 0.14);
  const danger = "#e5534b";
  // 当前行左侧竖条：跟随 paraColor 由调用方覆盖，这里给主题强调色兜底
  return {
    "--ui-bg": c.bg,
    "--ui-panel": panel,
    "--ui-panel-2": panel2,
    "--ui-hover": hover,
    "--ui-active": active,
    "--ui-border": border,
    "--ui-fg": c.fg,
    "--ui-fg-dim": c.gutterFg,
    "--ui-accent": c.accent,
    "--ui-accent-soft": rgba(c.accent, dark ? 0.18 : 0.14),
    "--ui-danger": danger,
    "--ui-linebar": c.accent,
    // 兼容旧变量：整体界面也随主题变化
    "--bg": c.bg,
    "--bg-panel": panel,
    "--bg-hover": hover,
    "--bg-active": active,
    "--border": border,
    "--fg": c.fg,
    "--fg-dim": c.gutterFg,
    "--accent": c.accent,
    "--danger": danger,
  };
}

/** 导出模板：给用户一份可改的 JSON */
export function themeTemplate(): string {
  return JSON.stringify(
    {
      id: "my-theme",
      name: "我的主题",
      dark: false,
      colors: {
        bg: "#fbfbf7", fg: "#3a3a3a", gutterBg: "#f0f0ea", gutterFg: "#8a8a80",
        activeLine: "#f2f2e6", para: "#ffe9a8", caret: "#d65d0e", accent: "#d65d0e",
      },
    },
    null,
    2
  );
}
