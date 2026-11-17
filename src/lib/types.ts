/** 宏动作：连续输入的文本，或映射到 CodeMirror 命令的按键 */
export type MacroItem =
  | { type: "text"; text: string }
  | { type: "cmd"; cmd: string };

/** 打开的文件标签 */
export interface FileTab {
  id: string;
  /** 绝对路径；未保存的新文件为 null */
  path: string | null;
  /** 标签显示名 */
  name: string;
  content: string;
  dirty: boolean;
  encoding: string; // UTF-8 / GBK / UTF-16LE / UTF-16BE
  bom: boolean;
  eol: "LF" | "CRLF" | "MIXED";
  /** 大文件模式（只读，分块加载） */
  large?: { total: number; loaded: number };
  /** 是否只读 */
  readOnly?: boolean;
}

/** read_file 命令返回 */
export interface ReadResult {
  content: string;
  encoding: string;
  bom: boolean;
  eol: string;
  size: number;
}

export interface WriteRequest {
  path: string;
  content: string;
  encoding: string;
  bom: boolean;
  eol: string;
}
