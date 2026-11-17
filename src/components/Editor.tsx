import { useEffect, useRef } from "react";
import { EditorState, Compartment, EditorSelection } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, highlightSpecialChars } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab, cursorCharLeft, cursorCharRight, cursorLineUp, cursorLineDown, deleteCharBackward, deleteCharForward, insertNewlineAndIndent, insertTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap, autocompletion } from "@codemirror/autocomplete";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { oneDark } from "@codemirror/theme-one-dark";
import { detectLanguage } from "../lib/lang";
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
  /** 外部请求触发（如 Ctrl+F、宏回放） */
  actionSignal: { type: string; n: number; items?: MacroItem[] } | null;
}

const languageComp = new Compartment();
const themeComp = new Compartment();

export default function Editor({ content, languagePath, onChange, onCursor, actionSignal }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onCursorRef = useRef(onCursor);
  const switchingRef = useRef(false);

  onChangeRef.current = onChange;
  onCursorRef.current = onCursor;

  // 初始化 EditorView（只挂载一次）
  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: "",
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          foldGutter(),
          drawSelection(),
          EditorView.lineWrapping,
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          autocompletion(),
          highlightActiveLine(),
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
          themeComp.of([oneDark, syntaxHighlighting(defaultHighlightStyle, { fallback: true })]),
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
    return () => {
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
    } else if (actionSignal.type === "goto") {
      // 跳到行（在 App 中解析）
    }
  }, [actionSignal]);

  return <div className="editor-host" ref={hostRef} />;
}
