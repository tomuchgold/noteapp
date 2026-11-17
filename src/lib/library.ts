/**
 * 文件库：记录所有打开过的文件，供左侧「文件列表」展示与分类。
 * 全部持久化在 localStorage，不依赖后端。
 */

export interface LibraryFile {
  /** 绝对路径，唯一键 */
  path: string;
  /** 显示名（文件名） */
  name: string;
  /** 所属分类 id；null = 未分类 */
  category: string | null;
  /** 收藏（置顶到收藏视图） */
  favorite: boolean;
  /** 最近一次打开的时间戳 */
  lastOpened: number;
  /** 内容首行预览，用于列表副标题 */
  preview: string;
}

export interface Category {
  id: string;
  name: string;
  color: string;
}

/** 虚拟分类（不对应真实分类） */
export const VIRTUAL = {
  all: "all",
  fav: "fav",
  recent: "recent",
  none: "none",
} as const;

export const CAT_COLORS = [
  "#4f9cf9",
  "#f2a03d",
  "#57c78a",
  "#e56d6d",
  "#a97cf0",
  "#39b8c9",
];

const LIB_KEY = "notepp.library";
const CAT_KEY = "notepp.categories";

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export function loadLibrary(): LibraryFile[] {
  const list = readJSON<LibraryFile[]>(LIB_KEY, []);
  if (!Array.isArray(list)) return [];
  return list
    .filter((f) => f && typeof f.path === "string")
    .map((f) => ({
      path: f.path,
      name: f.name || f.path.split(/[\\/]/).pop() || f.path,
      category: f.category ?? null,
      favorite: !!f.favorite,
      lastOpened: typeof f.lastOpened === "number" ? f.lastOpened : 0,
      preview: typeof f.preview === "string" ? f.preview : "",
    }));
}

export function saveLibrary(list: LibraryFile[]) {
  try {
    localStorage.setItem(LIB_KEY, JSON.stringify(list));
  } catch {
    /* 超配额时忽略 */
  }
}

export function loadCategories(): Category[] {
  const list = readJSON<Category[]>(CAT_KEY, []);
  if (!Array.isArray(list)) return [];
  return list
    .filter((c) => c && typeof c.id === "string" && typeof c.name === "string")
    .map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color || CAT_COLORS[0],
    }));
}

export function saveCategories(list: Category[]) {
  try {
    localStorage.setItem(CAT_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

/** 取内容首行为预览 */
export function makePreview(content: string): string {
  const line = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return (line ?? "").slice(0, 80);
}

/** 打开/保存文件时更新库条目 */
export function upsertFile(
  list: LibraryFile[],
  path: string,
  content: string
): LibraryFile[] {
  const name = path.split(/[\\/]/).pop() || path;
  const idx = list.findIndex((f) => f.path === path);
  const next: LibraryFile = {
    path,
    name,
    category: idx >= 0 ? list[idx].category : null,
    favorite: idx >= 0 ? list[idx].favorite : false,
    lastOpened: Date.now(),
    preview: makePreview(content),
  };
  if (idx >= 0) {
    const copy = list.slice();
    copy[idx] = next;
    return copy;
  }
  return [next, ...list];
}

export function removeFile(list: LibraryFile[], path: string): LibraryFile[] {
  return list.filter((f) => f.path !== path);
}

export function patchFile(
  list: LibraryFile[],
  path: string,
  patch: Partial<LibraryFile>
): LibraryFile[] {
  return list.map((f) => (f.path === path ? { ...f, ...patch } : f));
}

/** 按分类筛选 + 关键字搜索 */
export function filterFiles(
  list: LibraryFile[],
  catKey: string,
  query: string,
  categories: Category[]
): LibraryFile[] {
  const q = query.trim().toLowerCase();
  let out = list.slice();
  if (catKey === VIRTUAL.fav) out = out.filter((f) => f.favorite);
  else if (catKey === VIRTUAL.recent) out = out.slice().sort((a, b) => b.lastOpened - a.lastOpened).slice(0, 20);
  else if (catKey === VIRTUAL.none) out = out.filter((f) => !f.category);
  else if (catKey !== VIRTUAL.all && categories.some((c) => c.id === catKey))
    out = out.filter((f) => f.category === catKey);

  if (q) {
    out = out.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        f.path.toLowerCase().includes(q) ||
        f.preview.toLowerCase().includes(q)
    );
  }
  return out.sort((a, b) => b.lastOpened - a.lastOpened);
}

/** 相对时间（用于列表时间戳） */
export function relTime(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  if (sameDay) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.getFullYear() === now.getFullYear())
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}
