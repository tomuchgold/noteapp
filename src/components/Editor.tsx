import { useEffect, useRef, useState } from "react";
import { EditorState, Compartment, EditorSelection } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  highlightSpecialChars,
  highlightWhitespace,
  crosshairCursor,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab, cursorCharLeft, cursorCharRight, cursorLineUp, cursorLineDown, deleteCharBackward, deleteCharForward, insertNewlineAndIndent, insertTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap, autocompletion } from "@codemirror/autocomplete";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { oneDark } from "@codemirror/theme-one-dark";
import { detectLanguage } from "../lib/lang";
import { AI_ACTIONS, type AiAction } from "../lib/ai";
import type { EditorSettings } from "../lib/settings";
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
  onCursor: (line: number, col: number, selected: number) => void;
  /** 外部请求触发（如 Ctrl+F、宏回放、AI 结果写回） */
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
}

const languageComp = new Compartment();
const themeComp = new Compartment();
const styleComp = new Compartment();
const tabComp = new Compartment();
const wrapComp = new Compartment();
const wsComp = new Compartment();
const activeLineComp = new Compartment();
const editableComp = new Compartment();
const colComp = new Compartment();

/** 按起止坐标算出矩形选区（每行一个区间，多光标同步输入） */
function buildColumnSelection(view: EditorView, ax: number, ay: number, bx: number, by: number) {
  const start = view.posAtCoords({ x: ax, y: ay });
  const cur = view.posAtCoords({ x: bx, y: by });
  if (start == null || cur == null) return null;
  const a = view.state.doc.lineAt(start);
  const b = view.state.doc.lineAt(cur);
  const c1 = Math.min(start - a.from, cur - b.from);
  const c2 = Math.max(start - a.from, cur - b.from);
  const l1 = Math.min(a.number, b.number);
  const l2 = Math.max(a.number, b.number);
  const ranges = [];
  for (let n = l1; n <= l2; n++) {
    const line = view.state.doc.line(n);
    ranges.push(
      EditorSelection.range(Math.min(line.from + c1, line.to), Math.min(line.from + c2, line.to))
    );
  }
  return EditorSelection.create(ranges);
}

/** 亮色主题（自带背景，避免透出深色外壳） */
const lightTheme = EditorView.theme(
  {
    "&": { backgroundColor: "#ffffff", color: "#1f2328" },
    ".cm-gutters": { backgroundColor: "#f6f8fa", color: "#6a737d", border: "none" },
    ".cm-activeLine": { backgroundColor: "#f0f4fa" },
    ".cm-content": { caretColor: "#1f2328" },
  },
  { dark: false }
);

/** 字号 / 行高样式（随设置实时变化） */
function themeExtensions(s: EditorSettings) {
  return s.theme === "dark"
    ? [oneDark, syntaxHighlighting(defaultHighlightStyle, { fallback: true })]
    : [lightTheme, syntaxHighlighting(defaultHighlightStyle, { fallback: true })];
}

function styleTheme(s: EditorSettings) {
  return EditorView.theme({
    "&": { fontSize: `${s.fontSize}px` },
    ".cm-scroller": { lineHeight: String(s.lineHeight) },
    ".cm-gutters": { fontSize: `${Math.max(11, s.fontSize - 2)}px` },
  });
}

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
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onCursorRef = useRef(onCursor);
  const onZoomRef = useRef(onZoom);
  const [aiMenu, setAiMenu] = useState<{ x: number; y: number; text: string } | null>(null);
  const switchingRef = useRef(false);

  onChangeRef.current = onChange;
  onCursorRef.current = onCursor;
  onZoomRef.current = onZoom;

  // 初始化 EditorView（只挂载一次）
  useEffect(() => {
    if (!hostRef.current) return;
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
          drawSelection(),
          wrapComp.of(settings.wrap ? [EditorView.lineWrapping] : []),
          wsComp.of(settings.showWhitespace ? [highlightWhitespace()] : []),
          activeLineComp.of(settings.activeLine ? [highlightActiveLine()] : []),
          styleComp.of(styleTheme(settings)),
          editableComp.of(EditorView.editable.of(!readOnly)),
          colComp.of(columnMode ? [crosshairCursor()] : []),
          tabComp.of(EditorState.tabSize.of(settings.tabSize)),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          autocompletion(),
          highlightSelectionMatches(),
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...foldKeymap,
            indentWithTab,
          ]),
          languageComp.of([]),
          themeComp.of(themeExtensions(settings)),
          EditorView.updateListener.of((u) => {
            if (switchingRef.current) return;
            if (u.docChanged) {
              onChangeRef.current(u.state.doc.toString());
            }
            if (u.docChanged || u.selectionSet) {
              const sel = u.state.selection.main;
              const line = u.state.doc.lineAt(sel.head);
              onCursorRef.current(line.number, sel.head - line.from + 1, sel.to - sel.from);
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
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
  }, []);

  // 文档内容切换（激活标签变化时）
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
        themeComp.reconfigure(themeExtensions(settings)),
      ],
    });
  }, [settings]);

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

  // 外部动作（Ctrl+F 打开搜索面板等）
  useEffect(() => {
    if (!actionSignal) return;
    const view = viewRef.current;
    if (!view) return;
    view.focus();
    if (actionSignal.type === "find") {
      import("@codemirror/search").then(({ openSearchPanel }) => {
        if (viewRef.current) openSearchPanel(viewRef.current);
      });
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
    } else if (actionSignal.type === "goto") {
      // 跳到行（在 App 中解析）
    }
  }, [actionSignal]);

  // 右键：有选中内容时弹出 AI 动作菜单
  function handleContextMenu(e: React.MouseEvent) {
    const view = viewRef.current;
    if (!view) return;
    const sel = view.state.selection.main;
    if (sel.empty) return; // 无选区 → 保留浏览器默认菜单
    const text = view.state.sliceDoc(sel.from, sel.to);
    if (!text.trim()) return;
    e.preventDefault();
    setAiMenu({
      x: Math.min(e.clientX, window.innerWidth - 220),
      y: Math.min(e.clientY, window.innerHeight - 300),
      text,
    });
  }

  return (
    <div
      className="editor-host"
      data-col={columnMode ? "1" : "0"}
      ref={hostRef}
      onContextMenu={handleContextMenu}
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest(".ai-menu")) return;
        setAiMenu(null);
      }}
    >
      {aiMenu && (
        <div
          className="ai-menu"
          style={{ left: aiMenu.x, top: aiMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
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
        </div>
      )}
    </div>
  );
}
