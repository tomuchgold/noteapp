/**
 * 查找 / 替换（v0.10）
 * 匹配逻辑统一在此实现：查找栏的计数、高亮与编辑器的实际跳转共用同一份，
 * 避免「面板说 12 处、跳转只有 9 处」这类口径不一致。
 */

export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export const DEFAULT_OPTIONS: SearchOptions = {
  caseSensitive: false,
  wholeWord: false,
  regex: false,
};

export interface Match {
  from: number;
  to: number;
}

const WORD_RE = /[0-9A-Za-z_\u4e00-\u9fa5]/;
const isWordChar = (c: string) => WORD_RE.test(c);

/** 全字匹配边界判定（中文也算单词字符，避免「你好」匹配到「你好吗」中间） */
function isWholeWordAt(text: string, from: number, to: number): boolean {
  const before = from > 0 ? text[from - 1] : "";
  const after = to < text.length ? text[to] : "";
  return (!before || !isWordChar(before)) && (!after || !isWordChar(after));
}

/** 转义正则元字符（非正则模式下查询串按字面量处理） */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 构造匹配正则；返回 null 表示查询为空或正则非法 */
export function buildRegExp(query: string, opt: SearchOptions): RegExp | null {
  if (!query) return null;
  const source = opt.regex ? query : escapeRegExp(query);
  try {
    return new RegExp(source, opt.caseSensitive ? "g" : "gi");
  } catch {
    return null;
  }
}

/** 正则语法是否合法（输入框实时标红） */
export function isValidPattern(query: string, opt: SearchOptions): boolean {
  if (!query) return true;
  return buildRegExp(query, opt) !== null;
}

/** 找出文本中全部匹配 */
export function findAll(text: string, query: string, opt: SearchOptions): Match[] {
  if (!query) return [];
  const out: Match[] = [];

  if (opt.regex) {
    const re = buildRegExp(query, opt);
    if (!re) return [];
    let m: RegExpExecArray | null;
    let guard = 0;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        if (++guard > text.length + 10) break;
        continue;
      }
      out.push({ from: m.index, to: m.index + m[0].length });
      if (out.length >= 20000) break;
    }
    return out;
  }

  const hay = opt.caseSensitive ? text : text.toLowerCase();
  const needle = opt.caseSensitive ? query : query.toLowerCase();
  let from = 0;
  while (from <= hay.length - needle.length) {
    const idx = hay.indexOf(needle, from);
    if (idx < 0) break;
    const end = idx + needle.length;
    if (!opt.wholeWord || isWholeWordAt(text, idx, end)) out.push({ from: idx, to: end });
    from = idx + Math.max(1, needle.length);
    if (out.length >= 20000) break;
  }
  return out;
}

/** 当前位置之后的第一个匹配下标；dir=1 向后 / -1 向前（均循环） */
export function nextIndex(matches: Match[], pos: number, dir: 1 | -1): number {
  if (matches.length === 0) return -1;
  if (dir === 1) {
    const i = matches.findIndex((m) => m.from > pos);
    return i >= 0 ? i : 0;
  }
  for (let i = matches.length - 1; i >= 0; i--) {
    if (matches[i].from < pos) return i;
  }
  return matches.length - 1;
}

/** 当前选区对应哪一处匹配（-1 表示没对上） */
export function currentIndex(matches: Match[], selFrom: number, selTo: number): number {
  const exact = matches.findIndex((m) => m.from === selFrom && m.to === selTo);
  if (exact >= 0) return exact;
  return matches.findIndex((m) => m.from <= selFrom && selFrom < m.to);
}

/** 保留大小写地生成替换片段：原文全大写→大写；首字母大写→首字母大写 */
export function applyCase(original: string, replacement: string, opt: SearchOptions): string {
  if (opt.caseSensitive || !original) return replacement;
  if (original === original.toUpperCase() && original !== original.toLowerCase()) {
    return replacement.toUpperCase();
  }
  if (/^[A-Z]/.test(original) && /^[a-z]/.test(replacement)) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

/** 替换单处 */
export function replaceOne(text: string, m: Match, replacement: string, opt: SearchOptions): string {
  const piece = applyCase(text.slice(m.from, m.to), replacement, opt);
  return text.slice(0, m.from) + piece + text.slice(m.to);
}

/**
 * 全部替换，返回新文本与替换次数。
 * 正则模式支持 $1…$9 捕获组引用。
 */
export function replaceAll(
  text: string,
  query: string,
  replacement: string,
  opt: SearchOptions
): { text: string; count: number } {
  if (opt.regex) {
    const re = buildRegExp(query, opt);
    if (!re) return { text, count: 0 };
    let count = 0;
    const next = text.replace(re, (...args: unknown[]) => {
      count++;
      // args 末尾两个是 offset 与整个字符串，前面是 [整体匹配, ...捕获组]
      const groups = args.slice(0, -2) as string[];
      return replacement.replace(/\$(\d)/g, (_, d: string) => groups[Number(d)] ?? "");
    });
    return { text: next, count };
  }

  const matches = findAll(text, query, opt);
  if (matches.length === 0) return { text, count: 0 };
  let out = "";
  let cursor = 0;
  for (const m of matches) {
    out += text.slice(cursor, m.from);
    out += applyCase(text.slice(m.from, m.to), replacement, opt);
    cursor = m.to;
  }
  out += text.slice(cursor);
  return { text: out, count: matches.length };
}

/** 跨文件夹查到的一条命中 */
export interface FolderHit {
  path: string;
  line: number;
  text: string;
  col: number;
}

/** 按文件分组后的命中结构（结果列表渲染用） */
export interface FolderHitGroup {
  path: string;
  name: string;
  hits: FolderHit[];
}
