/**
 * 标注系统（v0.9）：划线 / 高亮颜色 / 标注信息（备注）
 * 按文件路径持久化于 localStorage（sidecar），编辑时随 CodeMirror changes 自动位移。
 */

export type AnnotationKind = "highlight" | "underline" | "note";

export interface Annotation {
  id: string;
  from: number;
  to: number;
  /** 标注时的原文快照（重载时用于校验/重新定位） */
  text: string;
  kind: AnnotationKind;
  /** 高亮颜色（highlight 用） */
  color?: string;
  /** 标注信息（备注，悬停显示） */
  note?: string;
  createdAt: number;
}

/** 高亮可选色板 */
export const HIGHLIGHT_COLORS = [
  { key: "yellow", value: "#ffe066", name: "黄" },
  { key: "green", value: "#b2f2bb", name: "绿" },
  { key: "blue", value: "#a5d8ff", name: "蓝" },
  { key: "pink", value: "#fcc2d7", name: "粉" },
  { key: "orange", value: "#ffd8a8", name: "橙" },
];

const keyOf = (path: string) => `notepp.ann:${path}`;

export function loadAnnotations(path: string): Annotation[] {
  try {
    const raw = JSON.parse(localStorage.getItem(keyOf(path)) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (a) => a && typeof a.from === "number" && typeof a.to === "number" &&
             typeof a.text === "string" &&
             ["highlight", "underline", "note"].includes(a.kind)
    );
  } catch {
    return [];
  }
}

export function saveAnnotations(path: string, list: Annotation[]) {
  try {
    if (list.length === 0) localStorage.removeItem(keyOf(path));
    else localStorage.setItem(keyOf(path), JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export function newAnnotationId(): string {
  return `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 重载时校验标注位置：
 * 1) 位置与原文仍一致 → 保留
 * 2) 不一致 → 在原文位置附近向后搜索快照文本，找到则重定位
 * 3) 找不到 → 丢弃
 */
export function reconcileAnnotations(doc: string, list: Annotation[]): Annotation[] {
  const out: Annotation[] = [];
  for (const a of list) {
    if (a.from >= 0 && a.to <= doc.length && doc.slice(a.from, a.to) === a.text) {
      out.push(a);
      continue;
    }
    const probe = Math.max(0, Math.min(a.from, doc.length) - 500);
    const idx = doc.indexOf(a.text, probe);
    if (idx >= 0) out.push({ ...a, from: idx, to: idx + a.text.length });
  }
  return out;
}
