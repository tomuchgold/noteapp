/**
 * 自定义快捷键系统（v0.14）
 * - 命令注册表：每个命令有稳定 id、显示名、分类、默认快捷键
 * - 用户绑定持久化到 localStorage（覆盖默认值；设为空串表示禁用）
 * - 按键规范化：把 KeyboardEvent 转成 "Ctrl+Alt+Shift+Key" 形式
 * - 动态命令（宏/片段）用前缀 id：macro:<id> / snippet:<id>，其快捷键存在各自记录里，
 *   但这里提供统一的解析与冲突检测。
 */

export interface CommandDef {
  id: string;
  name: string;
  category: "编辑插入" | "查找替换" | "视图布局" | "文件" | "宏与片段";
  /** 默认快捷键（规范串），空串表示默认未绑定 */
  defaultKey: string;
  /** 简述，用于设置界面 tooltip */
  desc: string;
}

/** 内置命令表（不含宏/片段这类动态命令） */
export const BUILTIN_COMMANDS: CommandDef[] = [
  { id: "insert-datetime", name: "插入当前日期时间", category: "编辑插入", defaultKey: "Ctrl+Alt+D", desc: "在光标处插入 YYYY-MM-DD HH:mm:ss" },
  { id: "insert-date", name: "插入当前日期", category: "编辑插入", defaultKey: "", desc: "在光标处插入 YYYY-MM-DD" },
  { id: "insert-time", name: "插入当前时间", category: "编辑插入", defaultKey: "", desc: "在光标处插入 HH:mm:ss" },
  { id: "insert-comment", name: "插入注释", category: "编辑插入", defaultKey: "Ctrl+Alt+C", desc: "按当前文件类型插入行注释符号（//、#、<!-- --> 等）" },
  { id: "insert-block-comment", name: "插入块注释", category: "编辑插入", defaultKey: "", desc: "按文件类型插入块注释 /* … */ 或 <!-- … -->" },
  { id: "insert-table", name: "插入表格", category: "编辑插入", defaultKey: "Ctrl+Alt+T", desc: "打开插入 Markdown 表格对话框" },
  { id: "insert-divider", name: "插入分隔线", category: "编辑插入", defaultKey: "", desc: "插入一条 Markdown 分隔线 ---" },
  { id: "find", name: "打开查找替换", category: "查找替换", defaultKey: "Ctrl+F", desc: "打开可拖动的查找替换浮窗" },
  { id: "find-next", name: "跳到下一处", category: "查找替换", defaultKey: "F3", desc: "跳到查找结果的下一处" },
  { id: "toggle-sidebar", name: "显示/隐藏侧栏", category: "视图布局", defaultKey: "Ctrl+B", desc: "切换左侧文件树侧栏" },
  { id: "toggle-filelist", name: "显示/隐藏文件列表", category: "视图布局", defaultKey: "Ctrl+Shift+B", desc: "切换文件列表" },
  { id: "toggle-split", name: "分屏对照", category: "视图布局", defaultKey: "", desc: "左右同时查看两个文件" },
  { id: "toggle-preview", name: "Markdown 预览", category: "视图布局", defaultKey: "", desc: "打开 Markdown 渲染预览" },
  { id: "print", name: "打印 / 导出 PDF", category: "文件", defaultKey: "Ctrl+P", desc: "打印或另存为 PDF" },
  { id: "save", name: "保存", category: "文件", defaultKey: "Ctrl+S", desc: "保存当前文件" },
  { id: "newtab", name: "新建文件", category: "文件", defaultKey: "Ctrl+N", desc: "新建一个标签页" },
  { id: "record-macro", name: "录制宏", category: "宏与片段", defaultKey: "Ctrl+Shift+R", desc: "开始/停止录制宏" },
  { id: "replay-macro", name: "回放宏", category: "宏与片段", defaultKey: "Ctrl+Shift+P", desc: "回放当前录制的宏" },
  { id: "transform-upper", name: "转为大写", category: "编辑插入", defaultKey: "Ctrl+Alt+U", desc: "把选中文字（无选中则当前行）转成大写" },
  { id: "transform-lower", name: "转为小写", category: "编辑插入", defaultKey: "Ctrl+Alt+I", desc: "把选中文字（无选中则当前行）转成小写" },
  { id: "transform-title", name: "首字母大写", category: "编辑插入", defaultKey: "", desc: "把选中英文每个单词首字母大写（无选中则当前行）" },
  { id: "transform-sort", name: "行排序 A→Z", category: "编辑插入", defaultKey: "", desc: "对选中行（无选中则全文）按字典序升序排序" },
  { id: "transform-sort-desc", name: "行排序 Z→A", category: "编辑插入", defaultKey: "", desc: "对选中行（无选中则全文）按字典序降序排序" },
  { id: "transform-dedupe", name: "去除重复行", category: "编辑插入", defaultKey: "", desc: "对选中行（无选中则全文）去除相邻重复之外的重复行" },
  { id: "transform-trim", name: "去除行首尾空格", category: "编辑插入", defaultKey: "", desc: "对选中行（无选中则全文）去掉每行首尾的空白" },
  { id: "transform-remove-blank", name: "去除空行", category: "编辑插入", defaultKey: "", desc: "对选中行（无选中则全文）删掉所有空行（含纯空格行）" },
  { id: "transform-add-blank", name: "增加空行", category: "编辑插入", defaultKey: "", desc: "对选中行（无选中则全文）在每个硬回车行之间插入一个空行（已有空行不重复加）" },
];

const KEY = "notepp.keymap-bindings";

/** 用户覆盖的快捷键：{ commandId: keyString } */
export type Bindings = Record<string, string>;

export function loadBindings(): Bindings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Bindings) : {};
  } catch {
    return {};
  }
}

export function saveBindings(b: Bindings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(b));
  } catch { /* ignore */ }
}

/** 取某命令当前生效的快捷键（用户绑定优先；用户显式设 "" 表示禁用） */
export function effectiveKey(id: string, bindings: Bindings, defaultKey = ""): string {
  if (Object.prototype.hasOwnProperty.call(bindings, id)) return bindings[id];
  return defaultKey;
}

/**
 * 把 KeyboardEvent 规范化为 "Ctrl+Alt+Shift+Key" 形式。
 * 修饰键顺序固定 Ctrl, Alt, Shift, Meta；主键用 e.key（保留 F3、方向键等原样，字母转大写）。
 */
export function normalizeEvent(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Meta");
  let k = e.key;
  if (k.length === 1) k = k.toUpperCase();
  parts.push(k);
  return parts.join("+");
}

/** 规范化用户手输的快捷键串（设置界面用），容错空格/大小写/顺序 */
export function normalizeKeyString(input: string): string {
  const segs = input.split("+").map((s) => s.trim()).filter(Boolean);
  const mods = new Set<string>();
  let main = "";
  for (const s of segs) {
    const low = s.toLowerCase();
    if (low === "ctrl" || low === "control") mods.add("Ctrl");
    else if (low === "alt") mods.add("Alt");
    else if (low === "shift") mods.add("Shift");
    else if (low === "meta" || low === "cmd" || low === "command") mods.add("Meta");
    else main = s.length === 1 ? s.toUpperCase() : s;
  }
  if (!main) return "";
  const order = ["Ctrl", "Alt", "Shift", "Meta"].filter((m) => mods.has(m));
  return [...order, main].join("+");
}

/**
 * 检测某快捷键被哪些命令占用（返回命令 id 列表）。
 * extraBindings 用于把片段快捷键这类独立存储的绑定也纳入检测，避免内置/宏/片段互相撞键。
 */
export function conflictsOf(
  key: string,
  bindings: Bindings,
  selfId?: string,
  extraBindings: Bindings[] = []
): string[] {
  if (!key) return [];
  const sources = [bindings, ...extraBindings];
  const lookup = (id: string): { found: boolean; key?: string } => {
    for (const src of sources) {
      if (Object.prototype.hasOwnProperty.call(src, id)) return { found: true, key: src[id] };
    }
    return { found: false };
  };

  const out: string[] = [];
  for (const c of BUILTIN_COMMANDS) {
    if (c.id === selfId) continue;
    const own = lookup(c.id);
    const current = own.found ? own.key : c.defaultKey;
    if (current === key) out.push(c.id);
  }

  // 动态命令的绑定（macro:/snippet: 前缀）也参与冲突检测
  const seen = new Set<string>();
  for (const src of sources) {
    for (const [id, k] of Object.entries(src)) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (id === selfId) continue;
      if ((id.startsWith("macro:") || id.startsWith("snippet:")) && k === key) out.push(id);
    }
  }
  return [...new Set(out)];
}

/** 命令 id → 显示名（含动态命令） */
export function commandLabel(id: string, macroNames: Record<string, string> = {}, snippetNames: Record<string, string> = {}): string {
  const built = BUILTIN_COMMANDS.find((c) => c.id === id);
  if (built) return built.name;
  if (id.startsWith("macro:")) return `宏：${macroNames[id.slice(6)] ?? id.slice(6)}`;
  if (id.startsWith("snippet:")) return `片段：${snippetNames[id.slice(8)] ?? id.slice(8)}`;
  return id;
}
