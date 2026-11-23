import { useEffect, useRef, useState } from "react";
import { EditorState, Compartment, EditorSelection, StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  highlightWhitespace,
  crosshairCursor,
  ViewPlugin,
  Decoration,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab, cursorCharLeft, cursorCharRight, cursorLineUp, cursorLineDown, deleteCharBackward, deleteCharForward, insertNewlineAndIndent, insertTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap, autocompletion } from "@codemirror/autocomplete";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { detectLanguage } from "../lib/lang";
import { AI_ACTIONS, type AiAction } from "../lib/ai";
import type { EditorSettings } from "../lib/settings";
import { effectiveFontSize } from "../lib/settings";
import { findTheme, type ThemeDef } from "../lib/themes";
import { HIGHLIGHT_COLORS, reconcileAnnotations, type Annotation, type AnnotationKind } from "../lib/annotations";
import { expandSnippet, type Snippet } from "../lib/snippets";
import { mediaExtension } from "../lib/mediaView";
import type { MacroItem } from "../lib/types";

/** 宏回放：按键 → CodeMirror 命令 */
const MACRO_CMDS: Record<string, (v: EditorView) => boolean> = {
  Enter: insertNewlineAndIndent,
  Tab: insertTab,
  Backspace: deleteCharBackward,
  Delete: deleteCharForward,
  ArrowLeft: cursorCharLeft,
  ArrowRight: cursorCharRight,
  ArrowUp: cursorLineUp,
  ArrowDown: cursorLineDown,
};

interface Props {
  content: string;
  languagePath: string | null;
  onChange: (value: string) => void;
  onCursor: (line: number, col: number, selected: number, selectedText?: string) => void;
  /** 外部请求触发（Ctrl+F、宏回放、AI 写回、插入表格/文本） */
  actionSignal: { type: string; n: number; items?: MacroItem[]; text?: string } | null;
  /** 编辑器样式设置 */
  settings: EditorSettings;
  /** Ctrl/⌘ + 滚轮缩放字体（dir: 1 放大 / -1 缩小） */
  onZoom?: (dir: 1 | -1) => void;
  /** 选中文本后右键触发的 AI 动作（custom 时由上层弹指令输入） */
  onAiAction?: (action: AiAction, text: string) => void;
  /** 是否已配置 AI（未配置时菜单提示去设置） */
  aiReady?: boolean;
  /** 打开 AI 设置 */
  onOpenAiSettings?: () => void;
  /** 只读（大文件模式） */
  readOnly?: boolean;
  /** 列编辑模式（矩形选区 + 十字光标） */
  columnMode?: boolean;
  /** 当前文件的标注列表（持久化由上层负责） */
  annotations?: Annotation[];
  /** 添加/更新标注（上层生成 id 并持久化） */
  onAnnotate?: (a: { from: number; to: number; text: string; kind: AnnotationKind; color?: string; note?: string }) => void;
  /** 整体替换标注列表（重载校准用） */
  onAnnotationsReplace?: (list: Annotation[]) => void;
  /** 删除标注 */
  onDeleteAnnotation?: (id: string) => void;
  /** 查找高亮（全部命中 + 当前命中） */
  searchMarks?: { from: number; to: number; current: boolean }[];
  /** 跳转请求（改变序号时生效）：跳到指定位置 */
  gotoRequest?: { n: number; from: number; to: number } | null;
  /** 代码片段列表：输入缩写后按 Tab 展开 */
  snippets?: Snippet[];
  /** 当前文档所在目录（解析媒体相对引用用；null 表示未保存） */
  mediaDir?: string | null;
  /** 是否在编辑器内渲染图片/音视频 */
  renderMedia?: boolean;
  /** 右键菜单「插入媒体/附件…」回调 */
  onInsertMedia?: () => void;
  /** 右键「在 Web 搜索」：用系统浏览器搜索选中文字 */
  onWebSearch?: (text: string) => void;
  /** 右键「在 NotePP 中搜索」：打开查找浮窗并填入选中文字 */
  onFindInNote?: (text: string) => void;
}

const languageComp = new Compartment();
const themeComp = new Compartment();
const styleComp = new Compartment();
const tabComp = new Compartment();
const wrapComp = new Compartment();
const wsComp = new Compartment();
const activeLineComp = new Compartment();
const paraComp = new Compartment();
const editableComp = new Compartment();
const colComp = new Compartment();
const annComp = new Compartment();
const searchComp = new Compartment();
const mediaComp = new Compartment();

/** 查找高亮：全部命中 + 当前命中（当前命中用独立类，允许叠加） */
export const setSearchMarksEffect = StateEffect.define<{ from: number; to: number; current: boolean }[]>();

function searchDecorations(list: { from: number; to: number; current: boolean }[], docLen: number): DecorationSet {
  const ranges = [];
  for (const m of list) {
    const from = Math.max(0, Math.min(m.from, docLen));
    const to = Math.max(from, Math.min(m.to, docLen));
    if (from >= to) continue;
    ranges.push(
      Decoration.mark({ class: m.current ? "cm-search-hit cm-search-hit-current" : "cm-search-hit" }).range(from, to)
    );
  }
  return Decoration.set(ranges, true);
}

const searchMarksField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    const mapped = value.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setSearchMarksEffect)) {
        return searchDecorations(e.value, tr.state.doc.length);
      }
    }
    // 文档变化后旧的高亮会错位，直接清掉更安全（面板会重新计算）
    return tr.docChanged ? Decoration.none : mapped;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * 按起止「屏幕坐标」算出矩形选区（每行一个区间，多光标同步输入）。
 * 逐行按 x 像素定位而非字符列——中文/宽字符/Tab 下也能精确对齐。
 * 对落在行间隙/文档外的坐标用 lineBlockAtHeight 兜底，始终给出稳定的行区间。
 */
function buildColumnSelection(view: EditorView, ax: number, ay: number, bx: number, by: number) {
  const under = (y: number): number => {
    // 先试 posAtCoords（能精确到字符），失败再按高度找行块
    const pos = view.posAtCoords({ x: ax < bx ? ax : bx, y });
    if (pos != null) return view.state.doc.lineAt(pos).number;
    const block = view.lineBlockAtHeight(y);
    return view.state.doc.lineAt(Math.min(Math.max(block.from, 0), view.state.doc.length)).number;
  };
  const lineA = under(ay);
  const lineB = under(by);
  const l1 = Math.min(lineA, lineB);
  const l2 = Math.max(lineA, lineB);
  // 矩形左右边界（视口 x），逐行复用同一 x → 得到真正的「列」
  const x1 = Math.min(ax, bx);
  const x2 = Math.max(ax, bx);
  const ranges: ReturnType<typeof EditorSelection.range>[] = [];

  const lineY = (n: number): number => {
    const line = view.state.doc.line(n);
    const block = view.lineBlockAt(line.from);
    return block.top + block.height / 2; // 相对文档顶部
  };
  // 把「相对文档顶部」的 y 转成 posAtCoords 需要的视口 y
  const scrollTop = view.scrollDOM.scrollTop;
  const docTop = view.documentTop - scrollTop;

  for (let n = l1; n <= l2; n++) {
    const line = view.state.doc.line(n);
    // 优先用真实坐标拿该行中心 y（视口坐标），失败则按行块推算
    const c = view.coordsAtPos(line.from);
    const yViewport = c ? (c.top + c.bottom) / 2 : lineY(n) + docTop;
    let pa = view.posAtCoords({ x: x1, y: yViewport });
    let pb = view.posAtCoords({ x: x2, y: yViewport });
    // 若定位到隔壁行，夹回本行
    if (pa != null && (pa < line.from || pa > line.to)) pa = pa < line.from ? line.from : line.to;
    if (pb != null && (pb < line.from || pb > line.to)) pb = pb < line.from ? line.from : line.to;
    const from = pa == null ? line.from : pa;
    const to = pb == null ? line.to : pb;
    ranges.push(EditorSelection.range(Math.min(from, to), Math.max(from, to)));
  }
  if (!ranges.length) return null;
  return EditorSelection.create(ranges);
}

/**
 * 列编辑「补空格成直线」：把矩形覆盖到的短行/空行用空格补齐到统一的列边界 x2，
 * 使所有行的选区右端对齐成一条直线（非直线的列选没有实际编辑意义）。
 * 返回需要插入的空格变更；调用方在 pointerup 时一次性 dispatch。
 *
 * 注意：字体为等宽时每个字符宽度一致，用「行尾 x → 目标 x」的像素差除以单字符宽度
 * 估算空格数；补完后由 buildColumnSelection 重新按 x 定位，得到真正对齐的矩形选区。
 */
function padColumnLines(view: EditorView, ax: number, ay: number, bx: number, by: number) {
  const x2 = Math.max(ax, bx);
  const x1 = Math.min(ax, bx);
  const underLine = (y: number): number => {
    const pos = view.posAtCoords({ x: x1, y });
    if (pos != null) return view.state.doc.lineAt(pos).number;
    const block = view.lineBlockAtHeight(y);
    return view.state.doc.lineAt(Math.min(Math.max(block.from, 0), view.state.doc.length)).number;
  };
  const l1 = Math.min(underLine(ay), underLine(by));
  const l2 = Math.max(underLine(ay), underLine(by));

  // 估算单个半角字符（空格）宽度：取首个非空行，比较相邻两个位置的 x
  let charW = 8;
  const doc = view.state.doc;
  for (let n = 1; n <= doc.lines && n <= l2 + 1; n++) {
    const line = doc.line(n);
    if (line.to > line.from) {
      const c0 = view.coordsAtPos(line.from);
      const c1 = view.coordsAtPos(Math.min(line.from + 1, line.to));
      if (c0 && c1 && c1.left > c0.left) {
        charW = c1.left - c0.left;
        break;
      }
    }
  }
  if (charW <= 0) charW = 8;

  const changes: { from: number; insert: string }[] = [];
  for (let n = l1; n <= l2; n++) {
    const line = doc.line(n);
    const end = view.coordsAtPos(line.to);
    // 行尾渲染 x（空行时 coordsAtPos 仍给出该行起点 x）
    const endX = end ? end.left : x1;
    if (endX < x2 - charW * 0.4) {
      const need = Math.max(1, Math.ceil((x2 - endX) / charW));
      changes.push({ from: line.to, insert: " ".repeat(need) });
    }
  }
  return changes;
}

/** 主题 → CodeMirror 扩展（背景/前景/行号/当前行/光标 + 语法高亮） */
/** hex → rgba 字符串 */
function hexToRgba(hex: string, alpha: number): string {
  const m = hex.replace("#", "");
  const v = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const n = parseInt(v, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** 光标行/段落默认高亮：主题强调色淡染（比面板底色醒目，与标注色系区分） */
function defaultHighlightBg(t: ThemeDef): string {
  return hexToRgba(t.colors.accent, t.dark ? 0.22 : 0.16);
}

function themeFromDef(t: ThemeDef): Extension {
  const theme = EditorView.theme(
    {
      "&": { backgroundColor: t.colors.bg, color: t.colors.fg },
      ".cm-gutters": { backgroundColor: t.colors.gutterBg, color: t.colors.gutterFg, border: "none" },
      ".cm-activeLine": { backgroundColor: t.colors.activeLine },
      ".cm-activeLineGutter": { backgroundColor: t.colors.activeLine },
      ".cm-content": { caretColor: t.colors.caret },
    },
    { dark: t.dark }
  );
  const hl = t.dark ? oneDarkHighlightStyle : defaultHighlightStyle;
  return [theme, syntaxHighlighting(hl, { fallback: true })];
}

/** 字号（含缩放）/ 行高样式（随设置实时变化） */
function styleTheme(s: EditorSettings) {
  return EditorView.theme({
    "&": { fontSize: `${effectiveFontSize(s)}px` },
    ".cm-scroller": { lineHeight: String(s.lineHeight) },
    ".cm-gutters": { fontSize: `${Math.max(11, Math.round(effectiveFontSize(s)) - 2)}px` },
  });
}

// ---------- 当前段落高亮 ----------
/** 光标所在整段（空行分隔的连续非空行块）加亮色行装饰 */
function paraDecorations(view: EditorView): DecorationSet {
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  if (!line.text.trim()) return Decoration.none;
  let from = line.number;
  let to = line.number;
  while (from > 1 && view.state.doc.line(from - 1).text.trim()) from--;
  while (to < view.state.doc.lines && view.state.doc.line(to + 1).text.trim()) to++;
  const ranges = [];
  for (let n = from; n <= to; n++) {
    const l = view.state.doc.line(n);
    ranges.push(Decoration.line({ class: "cm-para-line" }).range(l.from));
  }
  return Decoration.set(ranges, true);
}

const paraHighlightPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = paraDecorations(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet) this.decorations = paraDecorations(u.view);
    }
  },
  { decorations: (v) => v.decorations }
);

// ---------- 标注（划线/高亮/备注） ----------
export const setAnnotationsEffect = StateEffect.define<Annotation[]>();

function annotationDecorations(list: Annotation[], docLen: number): DecorationSet {
  const ranges = [];
  for (const a of list) {
    const from = Math.max(0, Math.min(a.from, docLen));
    const to = Math.max(from, Math.min(a.to, docLen));
    if (from === to) continue;
    const attrs: Record<string, string> = {};
    if (a.note) attrs.title = a.note;
    if (a.kind === "underline") {
      ranges.push(Decoration.mark({ class: "cm-ann-underline", attributes: attrs }).range(from, to));
    } else {
      const style = a.kind === "highlight" && a.color ? `background-color:${a.color};color:#1f2328;` : "";
      ranges.push(Decoration.mark({ class: "cm-ann-hl", attributes: { ...attrs, style } }).range(from, to));
    }
  }
  return Decoration.set(ranges, true);
}

const annotationsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let d = value.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setAnnotationsEffect)) d = annotationDecorations(e.value, tr.state.doc.length);
    }
    return d;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export default function Editor({
  content,
  languagePath,
  onChange,
  onCursor,
  actionSignal,
  settings,
  onZoom,
  onAiAction,
  aiReady,
  onOpenAiSettings,
  readOnly,
  columnMode,
  annotations = [],
  onAnnotate,
  onAnnotationsReplace,
  onDeleteAnnotation,
  searchMarks = [],
  gotoRequest,
  snippets = [],
  mediaDir = null,
  renderMedia = true,
  onInsertMedia,
  onWebSearch,
  onFindInNote,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onCursorRef = useRef(onCursor);
  const onZoomRef = useRef(onZoom);
  const snippetsRef = useRef(snippets);
  snippetsRef.current = snippets;
  const [aiMenu, setAiMenu] = useState<{ x: number; y: number; text: string } | null>(null);
  const [noteInput, setNoteInput] = useState<{ text: string; from: number; to: number; x: number; y: number } | null>(null);
  const switchingRef = useRef(false);

  onChangeRef.current = onChange;
  onCursorRef.current = onCursor;
  onZoomRef.current = onZoom;

  const theme = findTheme(settings.theme);

  // 初始化 EditorView（只挂载一次）
  useEffect(() => {
    if (!hostRef.current) return;
    const s = settings;
    const t = findTheme(s.theme);
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: "",
        extensions: [
          // 允许多选区：矩形（列）选区与多光标同步编辑的前提
          EditorState.allowMultipleSelections.of(true),
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          foldGutter(),
          // 不用 drawSelection：采用浏览器原生选区，CSS 可做「反色」选取样式
          wrapComp.of(s.wrap ? [EditorView.lineWrapping] : []),
          wsComp.of(s.showWhitespace ? [highlightWhitespace()] : []),
          activeLineComp.of(s.activeLine ? [highlightActiveLine()] : []),
          paraComp.of(s.paragraphHighlight ? [paraHighlightPlugin] : []),
          annComp.of([annotationsField]),
          searchComp.of([searchMarksField]),
          mediaComp.of(renderMedia && !readOnly ? [mediaExtension(mediaDir)] : []),
          styleComp.of(styleTheme(s)),
          editableComp.of(EditorView.editable.of(true)),
          colComp.of([]),
          tabComp.of(EditorState.tabSize.of(s.tabSize)),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          autocompletion(),
          highlightSelectionMatches(),
          keymap.of([
            // 代码片段：输入缩写后按 Tab 展开（优先于缩进 Tab）
            {
              key: "Tab",
              run: (view) => {
                const snips = snippetsRef.current;
                if (!snips.length) return false;
                const sel = view.state.selection.main;
                if (sel.from !== sel.head) return false; // 有选区时不展开
                const line = view.state.doc.lineAt(sel.head);
                const before = line.text.slice(0, sel.head - line.from);
                const match = before.match(/([^\s]+)$/);
                if (!match) return false;
                const abbr = match[1];
                const snip = snips.find((s) => s.abbr === abbr);
                if (!snip) return false;
                const from = sel.head - abbr.length;
                const body = expandSnippet(snip.body);
                view.dispatch({
                  changes: { from, to: sel.head, insert: body },
                  selection: { anchor: from + body.length },
                  scrollIntoView: true,
                });
                return true;
              },
            },
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...foldKeymap,
            indentWithTab,
          ]),
          languageComp.of([]),
          themeComp.of(themeFromDef(t)),
          EditorView.updateListener.of((u) => {
            if (switchingRef.current) return;
            if (u.docChanged) {
              onChangeRef.current(u.state.doc.toString());
            }
            if (u.docChanged || u.selectionSet) {
              const sel = u.state.selection.main;
              const line = u.state.doc.lineAt(sel.head);
              onCursorRef.current(
                line.number,
                sel.head - line.from + 1,
                sel.to - sel.from,
                sel.from !== sel.to ? u.state.doc.sliceString(sel.from, sel.to) : ""
              );
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
    // 挂载即聚焦：新建标签 / 切换标签后光标直接落在编辑区
    requestAnimationFrame(() => view.focus());
    // Ctrl/⌘ + 滚轮 缩放字体
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      onZoomRef.current?.(e.deltaY < 0 ? 1 : -1);
    };
    hostRef.current.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      hostRef.current?.removeEventListener("wheel", onWheel);
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 主题 CSS 变量（反色选区 / 段落高亮从变量取色）
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.style.setProperty("--np-bg", theme.colors.bg);
    host.style.setProperty("--np-fg", theme.colors.fg);
    host.style.setProperty("--np-para", defaultHighlightBg(theme));
    host.style.setProperty("--np-accent", theme.colors.accent);
    host.dataset.dark = theme.dark ? "1" : "0";
  }, [theme]);

  // 文档内容切换（激活标签变化时）；同时校准标注位置
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== content) {
      switchingRef.current = true;
      view.dispatch({ changes: { from: 0, to: current.length, insert: content } });
      switchingRef.current = false;
      view.focus();
    }
    // 内容变化后重新校准标注
    if (annotations.length > 0) {
      const fixed = reconcileAnnotations(view.state.doc.toString(), annotations);
      if (fixed.length !== annotations.length) onAnnotationsReplace?.(fixed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  // 语言切换
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const lang = detectLanguage(languagePath);
    view.dispatch({
      effects: languageComp.reconfigure(lang.ext ? [lang.ext] : []),
    });
  }, [languagePath]);

  // 样式设置变化 → 实时重新配置
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: [
        styleComp.reconfigure(styleTheme(settings)),
        tabComp.reconfigure(EditorState.tabSize.of(settings.tabSize)),
        wrapComp.reconfigure(settings.wrap ? [EditorView.lineWrapping] : []),
        wsComp.reconfigure(settings.showWhitespace ? [highlightWhitespace()] : []),
        activeLineComp.reconfigure(settings.activeLine ? [highlightActiveLine()] : []),
        paraComp.reconfigure(settings.paragraphHighlight ? [paraHighlightPlugin] : []),
        themeComp.reconfigure(themeFromDef(findTheme(settings.theme))),
      ],
    });
    // 光标行高亮颜色：用户设定优先；默认用主题强调色淡染（与底色、标注色明显区分）
    hostRef.current?.style.setProperty(
      "--np-para",
      settings.paraColor || defaultHighlightBg(findTheme(settings.theme))
    );
    hostRef.current?.style.setProperty(
      "--np-linebar",
      settings.paraColor || findTheme(settings.theme).colors.accent
    );
  }, [settings]);

  // 标注变化 → 应用装饰
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: setAnnotationsEffect.of(annotations) });
  }, [annotations]);

  // 媒体渲染开关 / 文档目录变化 → 重新配置媒体渲染扩展
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: mediaComp.reconfigure(renderMedia && !readOnly ? [mediaExtension(mediaDir)] : []),
    });
  }, [mediaDir, renderMedia, readOnly]);

  // 查找高亮变化 → 应用装饰
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: setSearchMarksEffect.of(searchMarks) });
  }, [searchMarks]);

  // 跳转到某个匹配
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !gotoRequest) return;
    const len = view.state.doc.length;
    const from = Math.max(0, Math.min(gotoRequest.from, len));
    const to = Math.max(from, Math.min(gotoRequest.to, len));
    view.dispatch({
      selection: EditorSelection.range(from, to),
      effects: EditorView.scrollIntoView(EditorSelection.range(from, to), { y: "center" }),
    });
    view.focus();
  }, [gotoRequest]);

  // 只读 / 列编辑模式变化
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: [
        editableComp.reconfigure(EditorView.editable.of(!readOnly)),
        colComp.reconfigure(columnMode ? [crosshairCursor()] : []),
      ],
    });
  }, [readOnly, columnMode]);

  // 列编辑：自己接管拖拽，直接生成矩形多区间选区
  useEffect(() => {
    const host = hostRef.current;
    const view = viewRef.current;
    if (!host || !view || !columnMode) return;

    let dragging = false;
    let sx = 0;
    let sy = 0;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (!(e.target as HTMLElement).closest(".cm-content")) return;
      // 彻底拦掉 CodeMirror 自身的选区手势
      e.stopImmediatePropagation();
      e.preventDefault();
      dragging = true;
      sx = e.clientX;
      sy = e.clientY;
      view.focus();
      const sel = buildColumnSelection(view, sx, sy, sx, sy);
      if (sel) view.dispatch({ selection: sel });
    };

    const blockMouse = (e: MouseEvent) => {
      if (!dragging) return;
      e.stopImmediatePropagation();
      e.preventDefault();
    };

    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      const sel = buildColumnSelection(view, sx, sy, e.clientX, e.clientY);
      if (sel) view.dispatch({ selection: sel });
    };

    const onUp = (e: PointerEvent) => {
      if (!dragging) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      // 松手时：先把短行/空行补空格到统一列边界，让选区成为一条直线，
      // 再用同一组坐标重建矩形选区（此时每行都够长，from/to 自然对齐）。
      const changes = padColumnLines(view, sx, sy, e.clientX, e.clientY);
      if (changes.length) {
        view.dispatch({ changes, scrollIntoView: false });
      }
      const sel = buildColumnSelection(view, sx, sy, e.clientX, e.clientY);
      if (sel) view.dispatch({ selection: sel });
      dragging = false;
    };

    host.addEventListener("pointerdown", onDown, true);
    host.addEventListener("mousedown", blockMouse, true);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    return () => {
      host.removeEventListener("pointerdown", onDown, true);
      host.removeEventListener("mousedown", blockMouse, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
    };
  }, [columnMode]);

  // 外部动作（Ctrl+F、宏回放、AI 写回、插入表格/文本）
  useEffect(() => {
    if (!actionSignal) return;
    const view = viewRef.current;
    if (!view) return;
    view.focus();
    if (actionSignal.type === "find") {
      import("@codemirror/search").then(({ openSearchPanel }) => {
        if (viewRef.current) openSearchPanel(viewRef.current);
      });
    } else if (actionSignal.type === "insert-text" && actionSignal.text !== undefined) {
      // 在光标处插入文本（插入表格 / markdown 片段等）
      const sel = view.state.selection.main;
      view.dispatch({
        changes: { from: sel.head, insert: actionSignal.text },
        selection: { anchor: sel.head + actionSignal.text.length },
        scrollIntoView: true,
      });
    } else if (actionSignal.type === "transform" && actionSignal.text) {
      // 文字变换：upper / lower / title 作用于选区（无选中则当前行）；
      // sort / sort-desc / dedupe / trim 作用于选中行（无选中则全文）
      const kind = actionSignal.text;
      const sel = view.state.selection.main;
      const hasSel = sel.from !== sel.to;
      if (kind === "upper" || kind === "lower" || kind === "title") {
        const from = hasSel ? sel.from : view.state.doc.lineAt(sel.head).from;
        const to = hasSel ? sel.to : view.state.doc.lineAt(sel.head).to;
        const text = view.state.doc.sliceString(from, to);
        const out =
          kind === "upper"
            ? text.toUpperCase()
            : kind === "lower"
              ? text.toLowerCase()
              : text.toLowerCase().replace(/(^|[^A-Za-z'])([a-z])/g, (_m: string, p: string, c: string) => p + c.toUpperCase());
        view.dispatch({
          changes: { from, to, insert: out },
          selection: { anchor: from + out.length },
          scrollIntoView: true,
        });
      } else if (["sort", "sort-desc", "dedupe", "trim"].includes(kind)) {
        const from = hasSel ? view.state.doc.lineAt(sel.from).from : 0;
        const to = hasSel ? view.state.doc.lineAt(sel.to).to : view.state.doc.length;
        const lines: string[] = view.state.doc.sliceString(from, to).split("\n");
        let out: string[];
        if (kind === "sort") out = [...lines].sort((a: string, b: string) => a.localeCompare(b, "zh"));
        else if (kind === "sort-desc") out = [...lines].sort((a: string, b: string) => b.localeCompare(a, "zh"));
        else if (kind === "dedupe") out = Array.from(new Set<string>(lines));
        else out = lines.map((l) => l.trim());
        view.dispatch({
          changes: { from, to, insert: out.join("\n") },
          scrollIntoView: true,
        });
      }
    } else if (actionSignal.type === "macro-replay" && actionSignal.items) {
      // 宏回放：按录制顺序重放文本输入与按键命令
      const v0 = viewRef.current;
      if (v0) v0.focus();
      for (const item of actionSignal.items) {
        const v = viewRef.current;
        if (!v) break;
        if (item.type === "text") {
          const sel = v.state.selection.main;
          v.dispatch({
            changes: { from: sel.head, insert: item.text },
            selection: { anchor: sel.head + item.text.length },
            scrollIntoView: true,
          });
        } else {
          const cmd = MACRO_CMDS[item.cmd];
          if (cmd) cmd(v);
        }
      }
    } else if (actionSignal.type === "select-all") {
      view.dispatch({
        selection: EditorSelection.range(0, view.state.doc.length),
        scrollIntoView: true,
      });
    } else if (actionSignal.type === "ai-replace" && actionSignal.text !== undefined) {
      const sel = view.state.selection.main;
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert: actionSignal.text },
        selection: { anchor: sel.from + actionSignal.text.length },
        scrollIntoView: true,
      });
    } else if (actionSignal.type === "ai-insert" && actionSignal.text !== undefined) {
      const sel = view.state.selection.main;
      view.dispatch({
        changes: { from: sel.head, insert: actionSignal.text },
        selection: { anchor: sel.head + actionSignal.text.length },
        scrollIntoView: true,
      });
    } else if (actionSignal.type === "goto-line" && actionSignal.text) {
      // 跳到指定行并把光标放到行首（跨文件夹搜索结果跳转）
      const n = Number(actionSignal.text);
      if (Number.isFinite(n) && n >= 1 && n <= view.state.doc.lines) {
        const line = view.state.doc.line(n);
        view.dispatch({
          selection: EditorSelection.cursor(line.from),
          effects: EditorView.scrollIntoView(line.from, { y: "center" }),
        });
        view.focus();
      }
    } else if (actionSignal.type === "goto") {
      // 跳到行（在 App 中解析）
    }
  }, [actionSignal]);

  /** 光标/选区命中的已有标注 */
  function hitAnnotations(): Annotation[] {
    const view = viewRef.current;
    if (!view) return [];
    const sel = view.state.selection.main;
    return annotations.filter((a) => a.from < sel.to && sel.from < a.to && a.from >= 0);
  }

  // 右键：弹出 标注 + AI 动作 菜单
  // 注意：右键的 mousedown 会把 CodeMirror 选区 collapse 到点击处，
  // 所以在 contextmenu 阶段读 selection 可能已为空 —— 右键前缓存一份。
  const selCacheRef = useRef<{ from: number; to: number; text: string } | null>(null);
  function handleContextMenu(e: React.MouseEvent) {
    const view = viewRef.current;
    if (!view) return;
    const sel = view.state.selection.main;
    if (!sel.empty) {
      const text = view.state.sliceDoc(sel.from, sel.to);
      if (text.trim()) selCacheRef.current = { from: sel.from, to: sel.to, text };
    }
    const hits = hitAnnotations();
    const cached = selCacheRef.current;
    if (sel.empty && hits.length === 0 && !cached) {
      // 无选区且未命中标注：只要上层提供了「插入媒体」，就弹插入菜单
      if (!onInsertMedia) return; // 保留默认菜单
      e.preventDefault();
      setAiMenu({
        x: Math.min(e.clientX, window.innerWidth - 230),
        y: Math.min(e.clientY, window.innerHeight - 200),
        text: "",
      });
      return;
    }
    const text = sel.empty ? cached?.text ?? "" : view.state.sliceDoc(sel.from, sel.to);
    if (!sel.empty && !text.trim()) return;
    e.preventDefault();
    setAiMenu({
      x: Math.min(e.clientX, window.innerWidth - 230),
      y: Math.min(e.clientY, window.innerHeight - 360),
      text,
    });
  }

  /** 选区信息（标注写入用） */
  function currentSelection(): { from: number; to: number; text: string } | null {
    const view = viewRef.current;
    if (!view) return null;
    const sel = view.state.selection.main;
    if (!sel.empty) {
      const text = view.state.sliceDoc(sel.from, sel.to);
      if (text.trim()) return { from: sel.from, to: sel.to, text };
    }
    // 选区被右键 collapse 时用缓存
    return selCacheRef.current;
  }

  function annotate(kind: AnnotationKind, color?: string) {
    const sel = currentSelection();
    setAiMenu(null);
    if (!sel) return;
    onAnnotate?.({ ...sel, kind, color });
  }

  function openNoteInput() {
    const sel = currentSelection();
    const pos = aiMenu ? { x: aiMenu.x, y: aiMenu.y } : { x: 200, y: 200 };
    setAiMenu(null);
    if (!sel) return;
    setNoteInput({ text: "", from: sel.from, to: sel.to, ...pos });
  }

  const menuHits = aiMenu ? hitAnnotations() : [];

  return (
    <div
      className="editor-host"
      data-col={columnMode ? "1" : "0"}
      ref={hostRef}
      onContextMenu={handleContextMenu}
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest(".ai-menu, .note-input-pop")) return;
        setAiMenu(null);
        setNoteInput(null);
      }}
    >
      {aiMenu && (
        <div
          className="ai-menu"
          style={{ left: aiMenu.x, top: aiMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {aiMenu.text && (
            <>
              <div className="ai-menu-head">
                标注
                <span className="ai-menu-sub">{aiMenu.text.length} 字符</span>
              </div>
              <div className="ann-colors">
                {HIGHLIGHT_COLORS.map((c) => (
                  <button
                    key={c.key}
                    className="ann-color"
                    style={{ backgroundColor: c.value }}
                    title={`高亮标注（${c.name}）`}
                    onClick={() => annotate("highlight", c.value)}
                  />
                ))}
                <button className="ann-menu-item" title="给选中文字加下划线" onClick={() => annotate("underline")}>
                  划线
                </button>
                <button className="ann-menu-item" title="添加标注信息（备注，悬停可查看）" onClick={openNoteInput}>
                  标注信息
                </button>
              </div>
            </>
          )}
          {aiMenu && !aiMenu.text && (
            <>
              <div className="ai-menu-head">插入</div>
              <button
                className="ann-menu-item"
                title="选择图片、音频、视频或任意附件，按设置的归档方式插入引用"
                onClick={() => {
                  setAiMenu(null);
                  onInsertMedia?.();
                }}
              >
                🖼️ 插入媒体/附件…
              </button>
            </>
          )}
          {aiMenu.text && (
            <>
              <div className="ai-menu-head">搜索</div>
              <button
                className="ann-menu-item"
                title="用系统浏览器搜索选中文字（搜索引擎可在设置中更换）"
                onClick={() => {
                  const t = aiMenu.text;
                  setAiMenu(null);
                  onWebSearch?.(t);
                }}
              >
                🌐 在 Web 搜索
              </button>
              <button
                className="ann-menu-item"
                title="在 NotePP 中搜索选中文字（打开查找替换）"
                onClick={() => {
                  const t = aiMenu.text;
                  setAiMenu(null);
                  onFindInNote?.(t);
                }}
              >
                🔍 在 NotePP 中搜索
              </button>
            </>
          )}
          {menuHits.length > 0 && (
            <>
              <div className="ai-menu-head">已有标注</div>
              {menuHits.map((a) => (
                <button
                  key={a.id}
                  className="ann-menu-item ann-remove"
                  title={a.note ? `备注：${a.note}` : a.kind === "underline" ? "下划线标注" : "高亮标注"}
                  onClick={() => {
                    setAiMenu(null);
                    onDeleteAnnotation?.(a.id);
                  }}
                >
                  删除标注 {a.note ? `· ${a.note.slice(0, 10)}` : ""}
                </button>
              ))}
            </>
          )}
          {aiMenu.text && (
            <>
              <div className="ai-menu-head">
                AI 操作
                <span className="ai-menu-sub">{aiMenu.text.length} 字符</span>
              </div>
              {!aiReady && (
                <button
                  className="ai-menu-config"
                  onClick={() => {
                    setAiMenu(null);
                    onOpenAiSettings?.();
                  }}
                >
                  尚未配置模型，点此设置 →
                </button>
              )}
              {AI_ACTIONS.map((a) => (
                <button
                  key={a.id}
                  disabled={!aiReady}
                  title={a.hint}
                  onClick={() => {
                    setAiMenu(null);
                    onAiAction?.(a.id, aiMenu.text);
                  }}
                >
                  {a.label}
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {noteInput && (
        <div
          className="note-input-pop"
          style={{ left: noteInput.x, top: Math.min(noteInput.y, window.innerHeight - 220) }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="ai-menu-head">标注信息</div>
          <textarea
            autoFocus
            value={noteInput.text}
            placeholder="写下备注，悬停标注文字时显示"
            onChange={(e) => setNoteInput({ ...noteInput, text: e.target.value })}
          />
          <div className="note-input-actions">
            <button
              className="primary"
              onClick={() => {
                const view = viewRef.current;
                if (view && noteInput.text.trim()) {
                  onAnnotate?.({
                    from: noteInput.from,
                    to: noteInput.to,
                    text: view.state.sliceDoc(noteInput.from, noteInput.to),
                    kind: "note",
                    note: noteInput.text.trim(),
                  });
                }
                setNoteInput(null);
              }}
            >
              保存
            </button>
            <button onClick={() => setNoteInput(null)}>取消</button>
          </div>
        </div>
      )}
    </div>
  );
}
