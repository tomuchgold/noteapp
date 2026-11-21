/**
 * 代码片段（Snippet）仓库 v0.14
 * 片段 = 缩写 + 内容。在编辑器里输入缩写后按 Tab 即展开为内容。
 * 与宏互补：宏管「动作序列」，片段管「静态文本块」。
 * 持久化于 localStorage，支持 JSON 导入/导出。
 */
import type { Bindings } from "./keymap";

export interface Snippet {
  id: string;
  /** 触发缩写（不含前后空格），如 "date" "todo" */
  abbr: string;
  /** 展开内容，支持 ${NOW} ${DATE} ${TIME} ${CLIPBOARD} 占位符 */
  body: string;
  /** 名称/说明 */
  name: string;
  createdAt: number;
}

const KEY = "notepp.snippets";
const BIND_KEY = "notepp.snippet-bindings";

function uid(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function normalize(v: unknown): Snippet | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const abbr = typeof o.abbr === "string" ? o.abbr.trim() : "";
  const body = typeof o.body === "string" ? o.body : "";
  if (!abbr || !body) return null;
  return {
    id: typeof o.id === "string" && o.id ? o.id : uid(),
    abbr: abbr.slice(0, 40),
    body,
    name: (typeof o.name === "string" && o.name ? o.name : abbr).slice(0, 60),
    createdAt: typeof o.createdAt === "number" ? o.createdAt : Date.now(),
  };
}

export function loadSnippets(): Snippet[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map(normalize).filter((s): s is Snippet => !!s);
  } catch {
    return [];
  }
}

export function saveSnippets(list: Snippet[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

export function addSnippet(abbr: string, body: string, name: string): Snippet[] {
  const list = loadSnippets();
  list.push({ id: uid(), abbr: abbr.trim().slice(0, 40), body, name: (name || abbr).slice(0, 60), createdAt: Date.now() });
  saveSnippets(list);
  return list;
}

export function deleteSnippet(id: string): Snippet[] {
  const list = loadSnippets().filter((s) => s.id !== id);
  saveSnippets(list);
  return list;
}

export function updateSnippet(id: string, patch: Partial<Pick<Snippet, "abbr" | "body" | "name">>): Snippet[] {
  const list = loadSnippets().map((s) => (s.id === id ? { ...s, ...patch } : s));
  saveSnippets(list);
  return list;
}

// ---- 片段快捷键绑定（独立存储，语义同 keymap 的 Bindings）----
export function loadSnippetBindings(): Bindings {
  try {
    const raw = localStorage.getItem(BIND_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Bindings) : {};
  } catch { return {}; }
}
export function saveSnippetBindings(b: Bindings) {
  try { localStorage.setItem(BIND_KEY, JSON.stringify(b)); } catch { /* ignore */ }
}

// ---- 导入 / 导出 ----
export function exportSnippets(list?: Snippet[]): string {
  return JSON.stringify({ format: "notepp-snippets", version: 1, snippets: list ?? loadSnippets() }, null, 2);
}

export function parseSnippetsJSON(text: string): Snippet[] {
  const parsed: unknown = JSON.parse(text);
  const root = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  const arr: unknown[] = Array.isArray(parsed)
    ? parsed
    : root && Array.isArray(root.snippets)
      ? root.snippets
      : [];
  if (arr.length === 0 && !Array.isArray(parsed) && !(root && Array.isArray(root.snippets))) {
    throw new Error("不是合法的片段文件（缺少 snippets 数组）");
  }
  const valid = arr.map(normalize).filter((s): s is Snippet => !!s);
  if (valid.length === 0) throw new Error("文件中没有可识别的片段");
  return valid;
}

export function importSnippets(text: string): Snippet[] {
  const incoming = parseSnippetsJSON(text);
  const list = loadSnippets();
  const ids = new Set(list.map((s) => s.id));
  for (const s of incoming) if (!ids.has(s.id)) { list.push(s); ids.add(s.id); }
  saveSnippets(list);
  return list;
}

/** 展开占位符：${NOW}/${DATE}/${TIME} */
export function expandSnippet(body: string): string {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  const time = `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
  return body
    .replace(/\$\{DATE\}/g, date)
    .replace(/\$\{TIME\}/g, time)
    .replace(/\$\{NOW\}/g, `${date} ${time}`);
}

// ---- 默认片段（首次使用时播种）----
const SEEDED_KEY = "notepp.snippets.seeded";
export function seedSnippetsIfEmpty(): Snippet[] {
  try {
    if (localStorage.getItem(SEEDED_KEY)) return loadSnippets();
    if (loadSnippets().length > 0) { localStorage.setItem(SEEDED_KEY, "1"); return loadSnippets(); }
    const defaults: Snippet[] = [
      { id: uid(), abbr: "now", body: "${NOW}", name: "当前日期时间", createdAt: Date.now() },
      { id: uid(), abbr: "todo", body: "- [ ] ", name: "待办项", createdAt: Date.now() },
      { id: uid(), abbr: "divider", body: "\n---\n", name: "分隔线", createdAt: Date.now() },
    ];
    saveSnippets(defaults);
    localStorage.setItem(SEEDED_KEY, "1");
    return defaults;
  } catch { return loadSnippets(); }
}
