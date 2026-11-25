import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { ReadResult, WriteRequest } from "./types";

/** 最近文件列表（localStorage 持久化） */
const RECENT_KEY = "notepp.recent";

export function getRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

export function pushRecent(path: string): string[] {
  const list = getRecent().filter((p) => p !== path);
  list.unshift(path);
  const trimmed = list.slice(0, 10);
  localStorage.setItem(RECENT_KEY, JSON.stringify(trimmed));
  return trimmed;
}

export function readTextFile(path: string): Promise<ReadResult> {
  return invoke("read_text_file", { path });
}

export function writeTextFile(req: WriteRequest): Promise<void> {
  return invoke("write_text_file", { req });
}

/** 系统打开文件对话框（支持多选） */
export async function openFileDialog(): Promise<string[] | null> {
  return await open({
    multiple: true,
    filters: [
      {
        name: "所有支持的文件",
        extensions: [
          "txt", "md", "js", "mjs", "cjs", "jsx", "ts", "tsx", "html", "htm",
          "css", "scss", "less", "json", "jsonc", "py", "rs", "c", "h", "cpp",
          "cc", "cxx", "hpp", "java", "go", "sql", "xml", "svg", "yml", "yaml",
          "sh", "bash", "lua", "pas", "f90", "f", "pl", "rb", "log", "vue",
        ],
      },
      { name: "所有文件", extensions: ["*"] },
    ],
  });
}

export async function saveFileDialog(defaultName: string): Promise<string | null> {
  return await save({ defaultPath: defaultName });
}

/** 系统选择文件夹对话框 */
export async function openDirectoryDialog(): Promise<string | null> {
  const res = await open({ directory: true, multiple: false });
  return typeof res === "string" ? res : null;
}

/** 选择要插入的媒体/附件文件（支持多选：图片/音频/视频/任意文件） */
export async function pickMediaDialog(): Promise<string[] | null> {
  const res = await open({
    multiple: true,
    filters: [
      { name: "图片", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif", "ico"] },
      { name: "音频", extensions: ["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus"] },
      { name: "视频", extensions: ["mp4", "webm", "mov", "avi", "mkv", "m4v"] },
      { name: "所有文件", extensions: ["*"] },
    ],
  });
  return Array.isArray(res) ? res : null;
}

/** 取路径中的目录部分（兼容 / 与 \ 分隔符） */
export function dirName(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i > 0 ? p.slice(0, i) : p;
}

/**
 * 计算媒体文件相对文档目录的引用路径（媒体归档策略为「相对引用」时使用）。
 * 文档与媒体在同一目录树时返回 media/xxx 之类；跨目录自动补 ../；
 * 不同盘符等无法相对化的情况返回绝对路径。
 */
export function mediaRelativeRef(src: string, docPath: string): string {
  const norm = (p: string) => p.replace(/[\\/]+/g, "/");
  const t = norm(src);
  const d = norm(dirName(docPath)).replace(/\/+$/, "");
  const isWin = /^[A-Za-z]:/.test(t) || /^[A-Za-z]:/.test(d);
  if (isWin) {
    const dt = d[0]?.toLowerCase();
    const st = t[0]?.toLowerCase();
    if (dt && st && dt !== st) return t; // 不同盘符：只能绝对引用
  }
  const dd = d.split("/").filter(Boolean);
  const tt = t.split("/").filter(Boolean);
  if (t.startsWith("/") && !d.startsWith("/")) return t; // 绝对路径无从相对化
  let i = 0;
  while (i < dd.length && i < tt.length - 1 && dd[i].toLowerCase() === tt[i].toLowerCase()) i++;
  const up = dd.length - i;
  const rel = [...Array(up).fill(".."), ...tt.slice(i)].join("/");
  return rel || t;
}

/** 目录条目（list_dir 命令返回） */
export interface DirEntryInfo {
  name: string;
  path: string;
  is_dir: boolean;
}

/** 列出目录内容（目录在前、隐藏文件过滤） */
export function listDir(path: string): Promise<DirEntryInfo[]> {
  return invoke("list_dir", { path });
}

/** 文件信息（打开前判断是否进入大文件模式；外部变更监听用 mtime） */
export function fileInfo(path: string): Promise<{ size: number; mtime: number }> {
  return invoke("file_info", { path });
}

/** 分块读取（大文件模式）：从 offset 起读 length 字节 */
export function readFileChunk(path: string, offset: number, length: number): Promise<string> {
  return invoke("read_file_chunk", { path, offset, length });
}

/**
 * 拷贝媒体/附件文件到文档同目录 media/ 下（同名自动加序号），
 * 返回相对引用路径 media/xxx.ext
 */
export function copyMediaFile(src: string, docPath: string): Promise<string> {
  return invoke("copy_media_file", { src, docPath });
}

/**
 * AI 生图落盘：把 base64 图片解码后存到文档同目录 media/ 下（v0.25），
 * 返回相对引用 media/ai-xxx.ext
 */
export function saveImageB64(docPath: string, b64: string, ext: string): Promise<string> {
  return invoke("save_image_b64", { docPath, b64, ext });
}

/** v0.30：读取任意文件为 base64（导出 HTML 内嵌媒体用）；浏览器/测试环境抛错 */
export function readFileBase64(path: string): Promise<string> {
  return invoke<string>("read_file_base64", { path });
}

/** 跨文件夹查找的单条命中（Rust search_in_folder 返回） */
export interface FolderSearchHit {
  path: string;
  line: number;
  text: string;
  col: number;
}

/** 在文件夹中查找（Rust 递归遍历 + 后缀白名单） */
export function searchInFolder(
  root: string,
  query: string,
  opt: { caseSensitive: boolean; wholeWord: boolean; regex: boolean }
): Promise<FolderSearchHit[]> {
  return invoke("search_in_folder", {
    req: {
      root,
      query,
      case_sensitive: opt.caseSensitive,
      whole_word: opt.wholeWord,
      regex: opt.regex,
    },
  });
}

/** 判断路径是否为目录（拖入/外部打开时区分文件与文件夹） */
export function pathIsDir(path: string): Promise<boolean> {
  return invoke("path_is_dir", { path });
}

/** 创建目录（含父目录） */
export function makeDir(path: string): Promise<void> {
  return invoke("make_dir", { path });
}

/** 重命名 / 移动文件或文件夹 */
export function renamePath(from: string, to: string): Promise<void> {
  return invoke("rename_path", { from, to });
}

/** 删除文件或文件夹（文件夹递归删除） */
export function deletePath(path: string): Promise<void> {
  return invoke("delete_path", { path });
}

/** 在系统文件管理器中定位文件/文件夹 */
export function revealInOS(path: string): Promise<void> {
  return invoke("reveal_in_os", { path });
}

/** 用系统默认程序打开文件（v0.28：文件夹树媒体右键「打开媒体」） */
export function openPathDefault(path: string): Promise<void> {
  return invoke("open_path_default", { path });
}

/**
 * 取走系统传递过来的待打开路径（文件关联/单实例/argv），
 * 返回后清空缓冲；浏览器/测试环境返回空数组。
 */
export async function drainOpenedPaths(): Promise<string[]> {
  try {
    const res = await invoke("opened_urls");
    return Array.isArray(res) ? (res as string[]) : [];
  } catch {
    return [];
  }
}
