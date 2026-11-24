/** 三栏布局偏好：显隐 + 宽度，持久化到 localStorage */

export interface LayoutState {
  sidebarOpen: boolean;
  filelistOpen: boolean;
  sidebarWidth: number;
  filelistWidth: number;
  /** 侧栏内「文件库分类区」高度（px），上下拖拽分割条调整；0=自适应 */
  sidebarLibH: number;
}

export const DEFAULT_LAYOUT: LayoutState = {
  sidebarOpen: true,
  filelistOpen: true,
  sidebarWidth: 190,
  filelistWidth: 264,
  sidebarLibH: 0,
};

const KEY = "notepp.layout";
const SIDEBAR_MIN = 140,
  SIDEBAR_MAX = 400;
const FILELIST_MIN = 180,
  FILELIST_MAX = 520;
const LIBH_MIN = 100,
  LIBH_MAX = 800;

function clamp(v: number, min: number, max: number, def: number) {
  if (!Number.isFinite(v)) return def;
  return Math.min(max, Math.max(min, Math.round(v)));
}

export function loadLayout(): LayoutState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_LAYOUT };
    const p = JSON.parse(raw) as Partial<LayoutState>;
    return {
      sidebarOpen: p.sidebarOpen ?? DEFAULT_LAYOUT.sidebarOpen,
      filelistOpen: p.filelistOpen ?? DEFAULT_LAYOUT.filelistOpen,
      sidebarWidth: clamp(p.sidebarWidth ?? 0, SIDEBAR_MIN, SIDEBAR_MAX, DEFAULT_LAYOUT.sidebarWidth),
      filelistWidth: clamp(p.filelistWidth ?? 0, FILELIST_MIN, FILELIST_MAX, DEFAULT_LAYOUT.filelistWidth),
      sidebarLibH: clamp(p.sidebarLibH ?? 0, 0, LIBH_MAX, DEFAULT_LAYOUT.sidebarLibH),
    };
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

export function saveLayout(l: LayoutState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(l));
  } catch {
    /* 忽略写入失败（隐私模式等） */
  }
}

export function clampSidebarWidth(v: number) {
  return clamp(v, SIDEBAR_MIN, SIDEBAR_MAX, DEFAULT_LAYOUT.sidebarWidth);
}

export function clampFilelistWidth(v: number) {
  return clamp(v, FILELIST_MIN, FILELIST_MAX, DEFAULT_LAYOUT.filelistWidth);
}

export function clampSidebarLibH(v: number) {
  if (v === 0) return 0; // 0 = 自适应（双击复位）
  return clamp(v, LIBH_MIN, LIBH_MAX, DEFAULT_LAYOUT.sidebarLibH);
}
