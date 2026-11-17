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
