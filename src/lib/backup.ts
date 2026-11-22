/**
 * GitHub 云备份（v0.20）：把笔记文件内容 + 全部本地设置打包为 JSON，
 * 存到用户的私有 GitHub Gist；可随时恢复到本机。
 * 文件读写走本地 Rust 命令，上传/下载走 gist_upload / gist_download。
 */
import { invoke } from "@tauri-apps/api/core";
import { readTextFile, writeTextFile } from "./files";

const CFG_KEY = "notepp.gist-backup";
const FILENAME = "notepp-backup.json";
/** 自动备份节流：两次备份至少间隔 15 分钟 */
const AUTO_THROTTLE_MS = 15 * 60 * 1000;
const LAST_KEY = "notepp.gist-backup.last";

export interface BackupConfig {
  /** GitHub Personal Access Token（需要 gist 权限） */
  token: string;
  /** 备份 Gist 的 ID（首次备份自动创建并回填） */
  gistId: string;
  /** 保存文件后自动备份（15 分钟节流） */
  autoBackup: boolean;
}

export function loadBackupConfig(): BackupConfig {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (!raw) return { token: "", gistId: "", autoBackup: false };
    const v = JSON.parse(raw);
    return {
      token: typeof v.token === "string" ? v.token : "",
      gistId: typeof v.gistId === "string" ? v.gistId : "",
      autoBackup: !!v.autoBackup,
    };
  } catch {
    return { token: "", gistId: "", autoBackup: false };
  }
}

export function saveBackupConfig(c: BackupConfig) {
  try {
    localStorage.setItem(CFG_KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}

export function backupConfigured(c: BackupConfig): boolean {
  return c.token.trim().length > 0 && c.gistId.trim().length > 0;
}

/** 收集需要随备份走的 localStorage 键（设置类，不含 Token 本身） */
const SETTINGS_KEYS = [
  "notepp.editor-settings",
  "notepp.layout",
  "notepp.library",
  "notepp.categories",
  "notepp.snippets",
  "notepp.snippet-bindings",
  "notepp.keymap-bindings",
  "notepp.saved-macros",
  "notepp.custom-themes",
  "notepp.tts",
  "notepp.ai",
  "notepp.recent",
  "notepp.session",
];

/** 组装备份 JSON：库中所有文件内容 + 标注 + 全部设置 */
export async function collectBackup(): Promise<string> {
  const library = (() => {
    try {
      return JSON.parse(localStorage.getItem("notepp.library") ?? "[]") as { path: string }[];
    } catch {
      return [];
    }
  })();

  const files: { path: string; content: string }[] = [];
  const annotations: Record<string, unknown> = {};
  for (const item of library) {
    if (!item?.path) continue;
    try {
      const res = await readTextFile(item.path);
      files.push({ path: item.path, content: res.content });
    } catch {
      // 文件可能已被移动/删除：跳过内容，仅保留路径标记
      files.push({ path: item.path, content: "" });
    }
    const raw = localStorage.getItem(`notepp.ann:${item.path}`);
    if (raw) annotations[item.path] = JSON.parse(raw);
  }

  const settings: Record<string, unknown> = {};
  for (const k of SETTINGS_KEYS) {
    const raw = localStorage.getItem(k);
    if (raw !== null) settings[k] = raw;
  }

  return JSON.stringify(
    {
      app: "notepp",
      kind: "backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      files,
      annotations,
      settings,
    },
    null,
    0
  );
}

function parseBackup(json: string): { files: { path: string; content: string }[]; annotations: Record<string, unknown>; settings: Record<string, unknown> } {
  const data = JSON.parse(json) as { app?: string; kind?: string; files?: unknown; annotations?: unknown; settings?: unknown };
  if (!data || data.app !== "notepp" || data.kind !== "backup" || !Array.isArray(data.files))
    throw new Error("备份文件格式不正确（不是 NotePP 备份）");
  return {
    files: (data.files as { path: string; content: string }[]).filter((f) => f && typeof f.path === "string"),
    annotations: (data.annotations ?? {}) as Record<string, unknown>,
    settings: (data.settings ?? {}) as Record<string, unknown>,
  };
}

/** 执行备份：返回 Gist ID */
export async function doBackup(cfg: BackupConfig): Promise<string> {
  const content = await collectBackup();
  const newId = await invoke<string>("gist_upload", {
    token: cfg.token,
    gistId: cfg.gistId,
    filename: FILENAME,
    content,
    description: `NotePP backup ${new Date().toISOString().slice(0, 10)}`,
  });
  const next = { ...cfg, gistId: newId };
  saveBackupConfig(next);
  localStorage.setItem(LAST_KEY, String(Date.now()));
  return newId;
}

/** 恢复：下载备份 → 确认 → 写回文件与设置；返回摘要 */
export async function doRestore(
  cfg: BackupConfig,
  confirmFn: (msg: string) => boolean = (m) => window.confirm(m)
): Promise<string> {
  const json = await invoke<string>("gist_download", {
    token: cfg.token,
    gistId: cfg.gistId,
    filename: FILENAME,
  });
  const data = parseBackup(json);
  const withContent = data.files.filter((f) => f.content !== "");
  if (withContent.length === 0) throw new Error("备份中没有可恢复的文件内容");
  const ok = confirmFn(
    `将从云端恢复 ${withContent.length} 个文件（覆盖本地同名文件）和全部设置。当前未保存的修改会丢失，且本机已有的同名文件会被备份内容覆盖。确定继续？`
  );
  if (!ok) return "已取消";

  // 写回文件
  for (const f of withContent) {
    await writeTextFile({ path: f.path, content: f.content, encoding: "UTF-8", bom: false, eol: "LF" });
  }
  // 恢复设置与标注
  for (const [k, v] of Object.entries(data.settings)) {
    if (typeof v === "string") localStorage.setItem(k, v);
  }
  for (const [p, v] of Object.entries(data.annotations)) {
    localStorage.setItem(`notepp.ann:${p}`, JSON.stringify(v));
  }
  return `已恢复 ${withContent.length} 个文件与 ${Object.keys(data.settings).length} 项设置，即将重启应用生效`;
}

/** 保存成功后的自动备份（节流 15 分钟，失败静默） */
export function maybeAutoBackup(): void {
  try {
    const cfg = loadBackupConfig();
    if (!cfg.autoBackup || !backupConfigured(cfg)) return;
    const last = Number(localStorage.getItem(LAST_KEY) ?? "0");
    if (Date.now() - last < AUTO_THROTTLE_MS) return;
    localStorage.setItem(LAST_KEY, String(Date.now())); // 先记时间防抖
    void doBackup(cfg).catch(() => {
      localStorage.setItem(LAST_KEY, String(last)); // 失败回滚节流标记
    });
  } catch {
    /* ignore */
  }
}
