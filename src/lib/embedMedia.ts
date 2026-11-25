/**
 * v0.30：导出 HTML 内嵌媒体——所见即所得的自包含 HTML。
 * 导出文本里的 asset:// / http://asset.localhost/ 引用解码回本地路径，
 * 逐个读文件转 base64 data URL 内嵌；外部 http(s)/data 引用保持原样。
 */
import { readFileBase64 } from "./files";

const MEDIA_SRC_RE = /(<(?:img|audio|video|source)\b[^>]*?\bsrc\s*=\s*)("(?:[^"]*)"|'(?:[^']*)')/gi;
const ASSET_PREFIX_RE = /^(?:asset:\/\/localhost\/|http:\/\/asset\.localhost\/)/i;

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  avif: "image/avif",
  ico: "image/x-icon",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  m4a: "audio/mp4",
  aac: "audio/aac",
  opus: "audio/opus",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
  m4v: "video/x-m4v",
};

function extOf(path: string): string {
  const name = path.split(/[?#]/)[0].split(/[\\/]/).pop() ?? "";
  return (name.includes(".") ? name.split(".").pop()! : "").toLowerCase();
}

/** 单个 asset 引用 → data URL；失败返回 null（保持原样） */
async function assetToDataUrl(ref: string): Promise<string | null> {
  const m = ASSET_PREFIX_RE.exec(ref);
  if (!m) return null;
  let path = ref.slice(m[0].length);
  try {
    path = decodeURIComponent(path);
  } catch {
    /* 保持原样 */
  }
  const ext = extOf(path);
  const mime = MIME[ext];
  if (!mime) return null;
  try {
    const b64 = await readFileBase64(path);
    return `data:${mime};base64,${b64}`;
  } catch {
    return null;
  }
}

/** 把 HTML 里的本地媒体引用全部内嵌为 base64，得到可脱离应用打开的自包含 HTML */
export async function embedMediaInHtml(html: string): Promise<string> {
  // 收集需要内嵌的 src（去重）
  const pending = new Map<string, string | null>();
  for (const m of html.matchAll(MEDIA_SRC_RE)) {
    const ref = m[2].slice(1, -1);
    if (!ref || !ASSET_PREFIX_RE.test(ref)) continue;
    if (!pending.has(ref)) pending.set(ref, null);
  }
  if (pending.size === 0) return html;
  await Promise.all(
    Array.from(pending.keys()).map(async (ref) => {
      pending.set(ref, await assetToDataUrl(ref));
    })
  );
  return html.replace(MEDIA_SRC_RE, (whole, lead: string, quoted: string) => {
    const data = pending.get(quoted.slice(1, -1));
    return data ? `${lead}"${data}"` : whole;
  });
}
