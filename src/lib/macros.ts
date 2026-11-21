/**
 * 命名宏仓库：把录制好的宏动作序列持久化到 localStorage，并支持 JSON 导入/导出。
 * 宏动作用于 Editor 的 macro-replay（文本输入 + 映射到 CodeMirror 命令的按键）。
 */
import type { MacroItem } from "./types";

export interface SavedMacro {
  id: string;
  name: string;
  items: MacroItem[];
  createdAt: number;
}

const KEY = "notepp.saved-macros";

function uid(): string {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function isItem(v: unknown): v is MacroItem {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (o.type === "text") return typeof o.text === "string";
  if (o.type === "cmd") return typeof o.cmd === "string";
  return false;
}

/** 校验并规范化一个宏（用于导入） */
function normalize(v: unknown, name?: string): SavedMacro | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const items = o.items;
  if (!Array.isArray(items) || !items.every(isItem)) return null;
  const nm = (name ?? (typeof o.name === "string" ? o.name : "")) || "未命名宏";
  return {
    id: typeof o.id === "string" && o.id ? o.id : uid(),
    name: String(nm).slice(0, 60),
    items,
    createdAt: typeof o.createdAt === "number" ? o.createdAt : Date.now(),
  };
}

export function loadMacros(): SavedMacro[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map((m) => normalize(m)).filter((m): m is SavedMacro => !!m);
  } catch {
    return [];
  }
}

export function saveMacros(list: SavedMacro[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export function addMacro(name: string, items: MacroItem[]): SavedMacro[] {
  const list = loadMacros();
  list.push({ id: uid(), name: (name || "未命名宏").slice(0, 60), items: [...items], createdAt: Date.now() });
  saveMacros(list);
  return list;
}

export function deleteMacro(id: string): SavedMacro[] {
  const list = loadMacros().filter((m) => m.id !== id);
  saveMacros(list);
  return list;
}

export function renameMacro(id: string, name: string): SavedMacro[] {
  const list = loadMacros().map((m) => (m.id === id ? { ...m, name: (name || m.name).slice(0, 60) } : m));
  saveMacros(list);
  return list;
}

/** 导出为 JSON 文本（可直接下载保存） */
export function exportMacros(list?: SavedMacro[]): string {
  const data = list ?? loadMacros();
  return JSON.stringify(
    { format: "notepp-macros", version: 1, macros: data },
    null,
    2
  );
}

/** 从 JSON 文本解析宏：兼容 { macros: [...] } 与裸数组两种格式 */
export function parseMacroJSON(text: string): SavedMacro[] {
  const parsed: unknown = JSON.parse(text);
  const root = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  const arr: unknown[] = Array.isArray(parsed)
    ? parsed
    : root && Array.isArray(root.macros)
      ? root.macros
      : [];
  if (arr.length === 0 && !Array.isArray(parsed) && !(root && Array.isArray(root.macros))) {
    throw new Error("不是合法的宏文件（缺少 macros 数组）");
  }
  const valid = arr.map((m) => normalize(m)).filter((m): m is SavedMacro => !!m);
  if (valid.length === 0) throw new Error("文件中没有可识别的宏");
  return valid;
}

/** 导入宏：按 id 去重合并（同名不同 id 的保留） */
export function importMacros(text: string): SavedMacro[] {
  const incoming = parseMacroJSON(text);
  const list = loadMacros();
  const ids = new Set(list.map((m) => m.id));
  for (const m of incoming) {
    if (!ids.has(m.id)) {
      list.push(m);
      ids.add(m.id);
    }
  }
  saveMacros(list);
  return list;
}
