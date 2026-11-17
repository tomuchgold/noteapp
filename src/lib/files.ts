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

/** 文件大小（打开前判断是否进入大文件模式） */
export function fileInfo(path: string): Promise<{ size: number }> {
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
