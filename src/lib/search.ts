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
/** 单条替换预览：命中区间 + 替换前后文本 + 所在行 */
export interface ReplacePreview {
  index: number;      // 序号（0 基）
  from: number;
  to: number;
  before: string;
  after: string;
  line: number;       // 行号（1 基）
  lineText: string;   // 所在行完整文本
}

/**
 * 生成「全部替换」的逐条预览（不改变文本）。
 * 正则模式支持 $1…$9 捕获组；非正则用 applyCase 处理大小写。
 */
export function replacePreviews(
  text: string,
  query: string,
  replacement: string,
  opt: SearchOptions,
  max = 2000
): ReplacePreview[] {
  const pieces: { from: number; to: number; before: string; after: string }[] = [];

  if (opt.regex) {
    const re = buildRegExp(query, opt);
    if (!re) return [];
    for (const m of text.matchAll(re)) {
      if (pieces.length >= max) break;
      const from = m.index ?? 0;
      const before = m[0];
      const groups = m.slice();
      const after = replacement.replace(/\$(\d)/g, (_, d: string) => groups[Number(d)] ?? "");
      pieces.push({ from, to: from + before.length, before, after });
    }
  } else {
    for (const m of findAll(text, query, opt)) {
      if (pieces.length >= max) break;
      const before = text.slice(m.from, m.to);
      pieces.push({ from: m.from, to: m.to, before, after: applyCase(before, replacement, opt) });
    }
  }

  return pieces.map((p, index) => {
    const lineStart = text.lastIndexOf("\n", Math.max(0, p.from - 1)) + 1;
    let lineEnd = text.indexOf("\n", p.to);
    if (lineEnd < 0) lineEnd = text.length;
    const line = text.slice(0, p.from).split("\n").length;
    return {
      index, from: p.from, to: p.to, before: p.before, after: p.after,
      line, lineText: text.slice(lineStart, lineEnd),
    };
  });
}

/** 按勾选的预览项执行替换（从后往前应用，避免位置偏移） */
export function applySelectedReplacements(text: string, previews: ReplacePreview[]): { text: string; count: number } {
  const picked = [...previews].sort((a, b) => b.from - a.from);
  let out = text;
  for (const p of picked) {
    out = out.slice(0, p.from) + p.after + out.slice(p.to);
  }
  return { text: out, count: picked.length };
}

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

/** 结果面板中的一行：行号 + 行文本 + 该行内的命中区间（按字符偏移，用于高亮） */
export interface LineHit {
  line: number;
  text: string;
  /** 命中区间（行内偏移） */
  ranges: Array<{ start: number; end: number }>;
}

/**
 * 把全局匹配按行聚合为结果面板条目（Notepad++ 风格）。
 * 匹配跨行时按各自所在的行拆开。
 */
export function lineHits(text: string, matches: Match[], maxLines = 5000): LineHit[] {
  if (matches.length === 0) return [];
  const lineStarts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") lineStarts.push(i + 1);
  }
  const byLine = new Map<number, Array<{ start: number; end: number }>>();
  for (const m of matches) {
    // 命中覆盖到的每一行都要记一条区间
    let start = m.from;
    while (start < m.to) {
      // 该字符所在行
      let lo = 0;
      let hi = lineStarts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (lineStarts[mid] <= start) lo = mid;
        else hi = mid - 1;
      }
      const lineNo = lo;
      const lineEnd = lineNo + 1 < lineStarts.length ? lineStarts[lineNo + 1] - 1 : text.length;
      const segEnd = Math.min(m.to, lineEnd);
      const arr = byLine.get(lineNo) ?? [];
      arr.push({ start: start - lineStarts[lineNo], end: segEnd - lineStarts[lineNo] });
      byLine.set(lineNo, arr);
      start = lineEnd + 1;
    }
  }
  const lines = text.split("\n");
  const out: LineHit[] = [];
  for (const [lineNo, ranges] of [...byLine.entries()].sort((a, b) => a[0] - b[0])) {
    if (out.length >= maxLines) break;
    // 合并重叠区间
    ranges.sort((a, b) => a.start - b.start);
    const merged: typeof ranges = [];
    for (const r of ranges) {
      const last = merged[merged.length - 1];
      if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
      else merged.push({ ...r });
    }
    out.push({ line: lineNo + 1, text: lines[lineNo] ?? "", ranges: merged });
  }
  return out;
}

/** 结果面板条目点击 → 该行第一个命中的全局位置（跳转用；超出末行返回文档末尾） */
export function lineHitPos(text: string, line: number): number {
  const lines = text.split("\n");
  let pos = 0;
  for (let i = 0; i < Math.min(line - 1, lines.length); i++) {
    pos += lines[i].length + (i + 1 < lines.length ? 1 : 0);
  }
  return pos;
}
