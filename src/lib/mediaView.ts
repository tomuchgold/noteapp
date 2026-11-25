/**
 * 编辑器内媒体渲染（v0.18）
 * - ![alt](path)        图片引用 → 内嵌缩略图（光标所在行显示原文便于编辑）
 * - [text](path)        音频/视频引用 → 内嵌播放控件
 * - <audio …>/​<video …> HTML 标签 → 内嵌播放控件
 * 相对引用按当前文档目录解析，经 Tauri asset 协议加载本地文件。
 */
import { ViewPlugin, Decoration, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { Extension, Range } from "@codemirror/state";

const IMG_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif", "ico"]);
const AUDIO_EXT = new Set(["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus"]);
const VIDEO_EXT = new Set(["mp4", "webm", "mov", "avi", "mkv", "m4v"]);

function extOf(ref: string): string {
  const name = ref.split(/[?#]/)[0].split(/[\\/]/).pop() ?? "";
  return (name.includes(".") ? name.split(".").pop()! : "").toLowerCase();
}

/** 把引用路径解析为可加载的 src（asset 协议 / 远程 URL / 原样兜底） */
export function resolveMediaSrc(ref: string, docDir: string | null): string {
  if (/^(https?|data|blob|asset):/i.test(ref)) return ref;
  let p = ref;
  if (!/^[\\/]/.test(p) && !/^[A-Za-z]:/.test(p)) {
    p = docDir ? `${docDir.replace(/[\\/]+$/, "")}/${p}` : p;
  }
  // v0.29：归一化 .. / . 段（如 ../pic.png、media/sub/../a.jpg）——
  // WebView asset 协议不解析 ..，带着 .. 会加载失败（用户实测相对上级引用裂图）
  p = normalizePath(p);
  try {
    // Tauri v2：转发给 internals；浏览器/测试环境没有就退回原路径
    const conv = (window as unknown as { __TAURI_INTERNALS__?: { convertFileSrc?: (p: string) => string } }).__TAURI_INTERNALS__?.convertFileSrc;
    if (typeof conv === "function") return conv(p);
  } catch {
    /* ignore */
  }
  return p;
}

/**
 * 路径归一化：解析 . / .. 段。支持 POSIX 与 Windows（盘符 + 反斜杠）。
 * 绝对路径的 .. 超出根时截断在根；相对路径保留开头的 ..。
 */
export function normalizePath(p: string): string {
  if (!p) return p;
  const isWin = /^[A-Za-z]:/.test(p) || p.includes("\\");
  const drive = isWin && /^[A-Za-z]:/.test(p) ? p.slice(0, 2) : "";
  const body = drive ? p.slice(2) : p;
  const absolute = /^[\\/]/.test(body);
  const segs = body.split(/[\\/]+/).filter((s) => s.length > 0);
  const out: string[] = [];
  for (const seg of segs) {
    if (seg === ".") continue;
    if (seg === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
      else if (!absolute) out.push("..");
      // 绝对路径 .. 超出根：截断（丢弃）
      continue;
    }
    out.push(seg);
  }
  const sep = isWin ? "\\" : "/";
  return drive + (absolute ? sep : "") + out.join(sep);
}

class ImgWidget extends WidgetType {
  constructor(readonly src: string, readonly alt: string) {
    super();
  }
  eq(o: ImgWidget) {
    return o.src === this.src && o.alt === this.alt;
  }
  toDOM() {
    const wrap = document.createElement("span");
    wrap.className = "cm-media cm-media-img";
    const img = document.createElement("img");
    img.src = this.src;
    img.alt = this.alt;
    img.title = this.alt;
    img.loading = "lazy";
    img.onerror = () => wrap.classList.add("cm-media-broken");
    wrap.appendChild(img);
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
}

class AudioWidget extends WidgetType {
  constructor(readonly src: string) {
    super();
  }
  eq(o: AudioWidget) {
    return o.src === this.src;
  }
  toDOM() {
    const wrap = document.createElement("span");
    wrap.className = "cm-media cm-media-audio";
    const a = document.createElement("audio");
    a.controls = true;
    a.src = this.src;
    a.preload = "none";
    wrap.appendChild(a);
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
}

class VideoWidget extends WidgetType {
  constructor(readonly src: string, readonly width: number | null) {
    super();
  }
  eq(o: VideoWidget) {
    return o.src === this.src && o.width === this.width;
  }
  toDOM() {
    const wrap = document.createElement("span");
    wrap.className = "cm-media cm-media-video";
    const v = document.createElement("video");
    v.controls = true;
    v.src = this.src;
    v.preload = "metadata";
    if (this.width) v.style.width = `${this.width}px`;
    wrap.appendChild(v);
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
}

const MD_IMG = /!\[([^\]]*)\]\(([^()\s]+)\)/g;
const MD_LINK = /(?<!!)\[([^\]]*)\]\(([^()\s]+)\)/g;
const AUDIO_TAG = /<audio\b[^>]*\bsrc\s*=\s*"([^"]+)"[^>]*>\s*<\/audio>/gi;
const VIDEO_TAG = /<video\b[^>]*\bsrc\s*=\s*"([^"]+)"[^>]*?(?:\bwidth\s*=\s*"(\d+)")?[^>]*>\s*<\/video>/gi;

/** 创建媒体渲染扩展（docDir 为当前文档目录，用于解析相对引用） */
export function mediaExtension(docDir: string | null): Extension {
  const Plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: ViewUpdate["view"]) {
        this.decorations = build(view, docDir);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || u.selectionSet) {
          this.decorations = build(u.view, docDir);
        }
      }
    },
    { decorations: (v) => v.decorations }
  );
  return Plugin;
}

function build(view: ViewUpdate["view"], docDir: string | null): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const sel = view.state.selection.main;
  for (const { from, to } of view.visibleRanges) {
    // visibleRange 可能横跨多行，需要逐行匹配；光标/选区所在行保持原文显示，便于编辑引用
    const first = view.state.doc.lineAt(from).number;
    const last = view.state.doc.lineAt(to).number;
    for (let n = first; n <= last; n++) {
      const line = view.state.doc.line(n);
      if (sel.from <= line.to && sel.to >= line.from) continue; // 光标行显示原文
      const text = view.state.doc.sliceString(line.from, line.to);
      const add = (m: RegExpMatchArray, deco: Decoration) => {
        const start = line.from + m.index!;
        const end = start + m[0].length;
        if (sel.from <= end && sel.to >= start) return; // 选区压到引用上时不替换
        ranges.push(deco.range(start, end));
      };
      for (const m of text.matchAll(MD_IMG)) {
        const ref = m[2];
        if (!IMG_EXT.has(extOf(ref))) continue;
        add(m, Decoration.replace({ widget: new ImgWidget(resolveMediaSrc(ref, docDir), m[1] || ref) }));
      }
      for (const m of text.matchAll(MD_LINK)) {
        const ref = m[2];
        const ext = extOf(ref);
        const isAudio = AUDIO_EXT.has(ext);
        if (!isAudio && !VIDEO_EXT.has(ext)) continue;
        add(
          m,
          isAudio
            ? Decoration.replace({ widget: new AudioWidget(resolveMediaSrc(ref, docDir)) })
            : Decoration.replace({ widget: new VideoWidget(resolveMediaSrc(ref, docDir), null) })
        );
      }
      for (const m of text.matchAll(AUDIO_TAG)) {
        add(m, Decoration.replace({ widget: new AudioWidget(resolveMediaSrc(m[1], docDir)) }));
      }
      for (const m of text.matchAll(VIDEO_TAG)) {
        add(m, Decoration.replace({ widget: new VideoWidget(resolveMediaSrc(m[1], docDir), m[2] ? Number(m[2]) : null) }));
      }
    }
  }
  return Decoration.set(ranges, true);
}
