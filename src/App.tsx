import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { openUrl } from "@tauri-apps/plugin-opener";
import Editor from "./components/Editor";
import TabBar from "./components/TabBar";
import StatusBar from "./components/StatusBar";
import DiffView from "./components/DiffView";
import DiffDialog, { type DiffSource } from "./components/DiffDialog";
import Sidebar from "./components/Sidebar";
import FileList from "./components/FileList";
import FolderTree, { loadSavedFolder } from "./components/FolderTree";
import SettingsDialog from "./components/SettingsDialog";
import Splitter from "./components/Splitter";
import InsertTableDialog from "./components/InsertTableDialog";
import PreviewDialog from "./components/PreviewDialog";
import FindBar from "./components/FindBar";
import SearchResults from "./components/SearchResults";
import AnnoPanel from "./components/AnnoPanel";
import MacroDialog from "./components/MacroDialog";
import {
  addMacro, deleteMacro, exportMacros, importMacros, loadMacros, renameMacro, type SavedMacro,
} from "./lib/macros";
import { printDocument } from "./lib/print";
import {
  applyCase,
  DEFAULT_OPTIONS,
  findAll,
  lineHitPos,
  lineHits,
  replaceAll,
  type FolderHitGroup,
  type SearchOptions,
} from "./lib/search";
import AiSettingsDialog from "./components/AiSettingsDialog";
import AiResultDialog from "./components/AiResultDialog";
import AiCustomDialog from "./components/AiCustomDialog";
import UpdateDialog from "./components/UpdateDialog";
import { checkUpdate, type UpdateInfo } from "./lib/update";
import {
  AI_ACTIONS,
  isConfigured,
  loadAiConfig,
  resolveConfig,
  runAiActionStream,
  saveAiConfig,
  type AiAction,
  type AiConfig,
} from "./lib/ai";
import {
  fileInfo,
  openFileDialog,
  pushRecent,
  readFileChunk,
  readTextFile,
  saveFileDialog,
  writeTextFile,
  getRecent,
  openDirectoryDialog,
  copyMediaFile,
  searchInFolder,
} from "./lib/files";
import {
  clampFilelistWidth,
  clampSidebarWidth,
  DEFAULT_LAYOUT,
  loadLayout,
  saveLayout,
  type LayoutState,
} from "./lib/layout";
import { clampSettings, effectiveFontSize, loadSettings, saveSettings, UI_SCALE_MAX, UI_SCALE_MIN, ZOOM_STEP, type EditorSettings } from "./lib/settings";
import { findTheme, themeUiVars } from "./lib/themes";
import {
  loadAnnotations,
  newAnnotationId,
  saveAnnotations,
  type Annotation,
  type AnnotationKind,
} from "./lib/annotations";
import { EXT_LANG } from "./lib/lang";
import {
  VIRTUAL,
  filterFiles,
  loadCategories,
  loadLibrary,
  patchFile,
  removeFile,
  saveCategories,
  saveLibrary,
  upsertFile,
  type Category,
  type LibraryFile,
} from "./lib/library";
import { detectLanguage } from "./lib/lang";
import type { FileTab, MacroItem } from "./lib/types";

function newId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

const ENCODINGS = ["UTF-8", "GBK"];
const SESSION_KEY = "notepp.session";

/** 字节 → 人类可读（大文件模式横幅用） */
function fmtMB(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** 超过该大小进入大文件模式（只读 + 分块加载） */
const LARGE_FILE_LIMIT = 8 * 1024 * 1024;
/** 每次加载的字节数 */
const LARGE_FILE_CHUNK = 1024 * 1024;

/** 窄屏（手机/小窗）判定：移动端抽屉行为用 */
function isNarrow(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 820px)").matches;
}

export default function App() {
  const [tabs, setTabs] = useState<FileTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [cursor, setCursor] = useState({ line: 1, col: 1, selected: 0 });
  const [confirmState, setConfirmState] = useState<{
    tabId: string;
    onDone: () => void;
  } | null>(null);
  const [recent, setRecent] = useState<string[]>(getRecent());
  const [actionSignal, setActionSignal] = useState<{
    type: string;
    n: number;
    items?: MacroItem[];
    text?: string;
  } | null>(null);
  const [diff, setDiff] = useState<{ aText: string; bText: string; aName: string; bName: string } | null>(null);
  const [diffDialog, setDiffDialog] = useState(false);
  const [recording, setRecording] = useState(false);
  const [macroLen, setMacroLen] = useState(0);
  const macroRef = useRef<MacroItem[]>([]);
  const [macroDialogOpen, setMacroDialogOpen] = useState(false);
  const [savedMacros, setSavedMacros] = useState<SavedMacro[]>(() => loadMacros());
  const actionCount = useRef(0);
  const sessionLoaded = useRef(false);

  // ---------- 文件库 / 分类 ----------
  const [library, setLibrary] = useState<LibraryFile[]>(() => loadLibrary());
  const [categories, setCategories] = useState<Category[]>(() => loadCategories());
  const [catKey, setCatKey] = useState<string>(VIRTUAL.all);
  const [query, setQuery] = useState("");
  // ---------- 三栏布局（显隐 + 宽度持久化） ----------
  const [layout, setLayout] = useState<LayoutState>(() => loadLayout());
  useEffect(() => saveLayout(layout), [layout]);
  const patchLayout = useCallback((patch: Partial<LayoutState>) => {
    setLayout((l) => ({ ...l, ...patch }));
  }, []);

  // ---------- 编辑器样式设置 ----------
  const [editorSettings, setEditorSettings] = useState<EditorSettings>(() => loadSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => saveSettings(editorSettings), [editorSettings]);

  // 把主题配色 + 界面字号倍率注入到根元素，令整个界面（菜单/侧栏/面板/按钮等）随主题变化
  useEffect(() => {
    const root = document.documentElement;
    const theme = findTheme(editorSettings.theme);
    const vars = themeUiVars(theme);
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    // 光标行竖条跟随自定义高亮色（若设置），否则用主题强调色
    root.style.setProperty("--np-linebar", editorSettings.paraColor || vars["--ui-linebar"]);
    // 界面字号倍率：基础 13px → 实际由 CSS calc(13px * var(--ui-scale)) 使用
    root.style.setProperty("--ui-scale", String(editorSettings.uiScale / 100));
    root.style.setProperty("--find-scale", String(editorSettings.findScale / 100));
    // 亮/暗主题标记，供 CSS 做针对性微调
    root.dataset.theme = theme.dark ? "dark" : "light";
  }, [editorSettings.theme, editorSettings.uiScale, editorSettings.findScale, editorSettings.paraColor]);

  // 界面字号快捷键：Ctrl/⌘ + [ / ] 缩放 UI（与编辑器正文缩放独立）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (e.key !== "[" && e.key !== "]") return;
      e.preventDefault();
      const dir = e.key === "]" ? 1 : -1;
      setEditorSettings((s) => {
        const next = Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, s.uiScale + dir * 10));
        return { ...s, uiScale: next };
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const zoomEditor = useCallback((dir: 1 | -1) => {
    setEditorSettings((s) =>
      clampSettings({ ...s, zoom: s.zoom + dir * ZOOM_STEP })
    );
  }, []);
  const resetZoom = useCallback(() => {
    setEditorSettings((s) => clampSettings({ ...s, zoom: 100 }));
  }, []);

  // ---------- 文件夹浏览 ----------
  const [folderRoot, setFolderRoot] = useState<string | null>(() => loadSavedFolder());

  // ---------- AI ----------
  const [aiConfig, setAiConfig] = useState<AiConfig>(() => loadAiConfig());
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [aiJob, setAiJob] = useState<{
    title: string;
    action: AiAction;
    source: string;
    custom?: string;
    loading: boolean;
    error: string | null;
    result: string;
    model?: string;
    tokens?: number;
  } | null>(null);
  const [aiCustom, setAiCustom] = useState<{ source: string } | null>(null);
  useEffect(() => saveAiConfig(aiConfig), [aiConfig]);
  const aiReady = isConfigured(aiConfig);

  const runAi = useCallback(
    async (action: AiAction, source: string, custom?: string) => {
      const title = AI_ACTIONS.find((a) => a.id === action)?.label ?? "AI 操作";
      setAiJob({ title, action, source, custom, loading: true, error: null, result: "" });
      try {
        const res = await runAiActionStream(aiConfig, action, source, custom, (delta) => {
          setAiJob((j) => (j ? { ...j, loading: false, result: (j.result ?? "") + delta } : j));
        });
        setAiJob((j) =>
          j ? { ...j, loading: false, result: res.content || j.result, model: res.model, tokens: res.tokens } : j
        );
      } catch (e) {
        setAiJob((j) =>
          j ? { ...j, loading: false, error: String(e instanceof Error ? e.message : e) } : j
        );
      }
    },
    [aiConfig]
  );

  const handleAiAction = useCallback(
    (action: AiAction, text: string) => {
      if (!aiReady) {
        setAiSettingsOpen(true);
        return;
      }
      if (action === "custom") {
        setAiCustom({ source: text });
        return;
      }
      void runAi(action, text);
    },
    [aiReady, runAi]
  );

  // ---------- 列编辑模式 ----------
  const [columnMode, setColumnMode] = useState(() => localStorage.getItem("notepp.column-mode") === "1");
  useEffect(() => {
    localStorage.setItem("notepp.column-mode", columnMode ? "1" : "0");
  }, [columnMode]);


  // ---------- 更新检查 ----------
  const [updateOpen, setUpdateOpen] = useState(false);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const doCheckUpdate = useCallback(async () => {
    setUpdateChecking(true);
    setUpdateError(null);
    try {
      const info = await checkUpdate();
      setUpdateInfo(info);
    } catch (e) {
      setUpdateError(String(e instanceof Error ? e.message : e));
    } finally {
      setUpdateChecking(false);
    }
  }, []);

  useEffect(() => {
    void doCheckUpdate();
  }, [doCheckUpdate]);

  const writeAiText = useCallback((mode: "ai-replace" | "ai-insert", text: string) => {
    actionCount.current += 1;
    setActionSignal({ type: mode, n: actionCount.current, text });
    setAiJob(null);
  }, []);

  useEffect(() => saveLibrary(library), [library]);
  useEffect(() => saveCategories(categories), [categories]);

  const viewFiles = useMemo(
    () => filterFiles(library, catKey, query, categories),
    [library, catKey, query, categories]
  );

  const viewTitle = useMemo(() => {
    if (catKey === VIRTUAL.all) return "全部文件";
    if (catKey === VIRTUAL.fav) return "收藏";
    if (catKey === VIRTUAL.recent) return "最近";
    if (catKey === VIRTUAL.none) return "未分类";
    return categories.find((c) => c.id === catKey)?.name ?? "全部文件";
  }, [catKey, categories]);

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeId) ?? null,
    [tabs, activeId]
  );

  const updateTab = useCallback((id: string, patch: Partial<FileTab>) => {
    setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  // ---------- 查找替换（当前文件 + 跨文件夹） ----------
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findOptions, setFindOptions] = useState<SearchOptions>(DEFAULT_OPTIONS);
  const [findSeed, setFindSeed] = useState("");
  const [findCurrent, setFindCurrent] = useState(0);
  const [gotoRequest, setGotoRequest] = useState<{ n: number; from: number; to: number } | null>(null);
  const [folderHits, setFolderHits] = useState<FolderHitGroup[]>([]);
  const [folderLoading, setFolderLoading] = useState(false);
  const [folderMessage, setFolderMessage] = useState<string | null>(null);
  /** 替换结果轻提示（如「已替换 12 处」） */
  const [replaceMsg, setReplaceMsg] = useState<string | null>(null);
  const gotoSeq = useRef(0);

  /** 当前文件的全部匹配（面板计数与跳转共用） */
  const findMatches = useMemo(
    () => (activeTab ? findAll(activeTab.content, findQuery, findOptions) : []),
    [activeTab?.content, findQuery, findOptions]
  );

  /** 搜索高亮（当前命中单独标色） */
  const searchMarks = useMemo(
    () => findMatches.map((m, i) => ({ ...m, current: i === findCurrent })),
    [findMatches, findCurrent]
  );

  // ---------- 搜索结果面板（Notepad++ 风格：行号+行内容+点击跳行） ----------
  const [resultsOpen, setResultsOpen] = useState(false);
  /** 命中按行聚合（结果面板数据源） */
  const searchLineHits = useMemo(
    () => (activeTab ? lineHits(activeTab.content, findMatches) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeTab?.content, findMatches]
  );
  /** 当前命中所在行（面板中加粗定位） */
  const currentMatchLine = useMemo(() => {
    const m = findMatches[findCurrent];
    if (!m || !activeTab) return null;
    return activeTab.content.slice(0, m.from).split("\n").length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findMatches, findCurrent, activeTab?.content]);

  /** 当前查找位置的位置指针；null 表示还没跳过（下次跳第一处） */
  const findPosRef = useRef<number | null>(null);
  /** 当前序号（与 findCurrent 同步，供 stepFind 读取最新值） */
  const findCurrentRef = useRef(-1);

  const gotoMatch = useCallback(
    (idx: number) => {
      const m = findMatches[idx];
      if (!m) return;
      findCurrentRef.current = idx;
      setFindCurrent(idx);
      findPosRef.current = m.from;
      gotoSeq.current += 1;
      setGotoRequest({ n: gotoSeq.current, from: m.from, to: m.to });
    },
    [findMatches]
  );

  // 查询/选项真正变化时才重置指针与序号（不能在每次重渲染里重置，否则跳转会被打回第一处）
  const findKeyRef = useRef("");
  useEffect(() => {
    if (!findOpen) return;
    const key = `${findQuery}\u0000${findOptions.caseSensitive}${findOptions.wholeWord}${findOptions.regex}`;
    if (findKeyRef.current === key) return;
    findKeyRef.current = key;
    findPosRef.current = null;
    findCurrentRef.current = -1;
    setFindCurrent(0);
    // 输入即预览：把光标移到第一处命中，并把「当前位置」记到第一处，
    // 这样下一次「下一处」是第 2 处，而不是原地不动。
    const first = findMatches[0];
    if (first) {
      findCurrentRef.current = 0;
      findPosRef.current = first.from;
      gotoSeq.current += 1;
      setGotoRequest({ n: gotoSeq.current, from: first.from, to: first.to });
    } else {
      setGotoRequest(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findQuery, findOptions, findMatches, findOpen]);

  const stepFind = useCallback(
    (dir: 1 | -1) => {
      if (findMatches.length === 0) return;
      const cur = findCurrentRef.current;
      // 还没跳过（-1）→ 正向从第一处开始；反向从最后一处开始
      const target =
        cur < 0 || cur >= findMatches.length
          ? dir === 1
            ? 0
            : findMatches.length - 1
          : (cur + dir + findMatches.length) % findMatches.length;
      gotoMatch(target);
    },
    [findMatches, gotoMatch]
  );

  /** 点击结果面板某行 → 跳到该行第一个命中 */
  const jumpToResultLine = useCallback(
    (line: number) => {
      if (!activeTab) return;
      const pos = lineHitPos(activeTab.content, line);
      let idx = findMatches.findIndex((m) => m.from >= pos);
      if (idx < 0) idx = 0;
      gotoMatch(idx);
    },
    [activeTab, findMatches, gotoMatch]
  );

  /** 替换当前命中 */
  const doReplace = useCallback(
    (replacement: string) => {
      if (!activeTab || findMatches.length === 0) return;
      const idx = findCurrent >= 0 && findCurrent < findMatches.length ? findCurrent : 0;
      const m = findMatches[idx];
      const piece = applyCase(activeTab.content.slice(m.from, m.to), replacement, findOptions);
      const next = activeTab.content.slice(0, m.from) + piece + activeTab.content.slice(m.to);
      updateTab(activeTab.id, { content: next, dirty: true });
      // 替换后光标停在替换文本末尾，再跳到下一处
      gotoSeq.current += 1;
      setGotoRequest({ n: gotoSeq.current, from: m.from + piece.length, to: m.from + piece.length });
      findCurrentRef.current = idx;
      setFindCurrent(idx);
    },
    [activeTab, findMatches, findCurrent, findOptions, updateTab]
  );

  /** 全部替换（可撤销：替换前后各入一次历史，CodeMirror 的 undo 会合并为一步） */
  const doReplaceAll = useCallback(
    (replacement: string) => {
      if (!activeTab || findMatches.length === 0) return;
      const { text, count } = replaceAll(activeTab.content, findQuery, replacement, findOptions);
      updateTab(activeTab.id, { content: text, dirty: true });
      setFindCurrent(0);
      findCurrentRef.current = -1;
      findPosRef.current = null;
      setReplaceMsg(`已替换 ${count} 处`);
      window.setTimeout(() => setReplaceMsg(null), 4000);
    },
    [activeTab, findMatches.length, findQuery, findOptions, updateTab]
  );

  /** 在文件夹中查找 */
  const doFolderSearch = useCallback(
    async (q: string, opt: SearchOptions) => {
      if (!folderRoot || !q) return;
      setFolderLoading(true);
      setFolderMessage(null);
      try {
        const hits = await searchInFolder(folderRoot, q, opt);
        const map = new Map<string, FolderHitGroup>();
        for (const h of hits) {
          const g = map.get(h.path) ?? { path: h.path, name: baseName(h.path), hits: [] };
          g.hits.push(h);
          map.set(h.path, g);
        }
        setFolderHits([...map.values()]);
        setFolderMessage(hits.length === 0 ? "没有匹配结果" : null);
      } catch (e) {
        setFolderHits([]);
        setFolderMessage(String(e instanceof Error ? e.message : e));
      } finally {
        setFolderLoading(false);
      }
    },
    [folderRoot]
  );

  /** 所有已打开标签中查找（内存搜索，不改底部结果面板） */
  const [tabHits, setTabHits] = useState<FolderHitGroup[]>([]);
  const [tabMessage, setTabMessage] = useState<string | null>(null);
  const doTabsSearch = useCallback(
    (q: string, opt: SearchOptions) => {
      if (!q) return;
      const groups: FolderHitGroup[] = [];
      for (const t of tabsRef.current) {
        if (t.large) continue;
        const matches = findAll(t.content, q, opt);
        if (matches.length === 0) continue;
        const key = t.path ?? `tab:${t.id}`;
        groups.push({
          path: key,
          name: t.path ? baseName(t.path) : `未保存 - ${t.name}`,
          hits: lineHits(t.content, matches).map((h) => ({
            path: key,
            line: h.line,
            text: h.text,
            col: h.ranges[0]?.start ?? 0,
          })),
        });
      }
      setTabHits(groups);
      setTabMessage(groups.length === 0 ? "已打开的标签中没有匹配结果" : null);
    },
    []
  );

  /** 打开文件夹搜索结果：打开文件并跳到对应行；标签结果则直接切换标签 */
  const openFolderHit = useCallback(
    async (path: string, line: number) => {
      if (path.startsWith("tab:")) {
        const id = path.slice(4);
        setActiveId(id);
        window.setTimeout(() => {
          setActionSignal({ type: "goto-line", n: ++actionCount.current, text: String(line) });
        }, 200);
        return;
      }
      await openPathRef.current(path);
      // 等标签挂载后跳到该行
      window.setTimeout(() => {
        setActionSignal({ type: "goto-line", n: ++actionCount.current, text: String(line) });
      }, 250);
    },
    []
  );

  /** openPath 的引用（避免循环依赖，供 openFolderHit 使用） */
  const openPathRef = useRef<(p: string) => Promise<void>>(async () => {});

  /** 打开查找栏（带入选中文本） */
  const openFind = useCallback(() => {
    const sel = window.getSelection()?.toString() ?? "";
    setFindSeed(sel.length > 0 && sel.length < 300 ? sel : "");
    setFindOpen(true);
  }, []);


  // ---------- 标注（划线/高亮/备注，按文件路径持久化） ----------
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const activePath = activeTab?.path ?? null;
  useEffect(() => {
    setAnnotations(activePath ? loadAnnotations(activePath) : []);
  }, [activePath]);

  const persistAnnotations = useCallback((list: Annotation[]) => {
    setAnnotations(list);
    if (activePath) saveAnnotations(activePath, list);
  }, [activePath]);

  const handleAnnotate = useCallback(
    (a: { from: number; to: number; text: string; kind: AnnotationKind; color?: string; note?: string }) => {
      const ann: Annotation = { id: newAnnotationId(), createdAt: Date.now(), ...a };
      setAnnotations((prev) => {
        const next = [...prev, ann];
        if (activePath) saveAnnotations(activePath, next);
        return next;
      });
    },
    [activePath]
  );

  const handleDeleteAnnotation = useCallback(
    (id: string) => {
      setAnnotations((prev) => {
        const next = prev.filter((x) => x.id !== id);
        if (activePath) saveAnnotations(activePath, next);
        return next;
      });
    },
    [activePath]
  );

  // ---------- 标注导航面板 ----------
  const [annoOpen, setAnnoOpen] = useState(false);
  /** 点击标注列表项 → 跳到标注位置 */
  const jumpToAnnotation = useCallback((ann: Annotation) => {
    gotoSeq.current += 1;
    setGotoRequest({ n: gotoSeq.current, from: ann.from, to: ann.to });
  }, []);

  // ---------- 插入表格 / Markdown 预览 ----------
  const [tableOpen, setTableOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const insertText = useCallback((text: string) => {
    actionCount.current += 1;
    setActionSignal({ type: "insert-text", n: actionCount.current, text });
  }, []);

  const activeIsMarkdown = !!activeTab && (/\.(md|markdown)$/i.test(activeTab.name) || /\.(md|markdown)$/i.test(activeTab.path ?? ""));
  void activeIsMarkdown; // 预览按钮对所有文档开放；保留标记供状态提示使用

  const exportPreviewHtml = useCallback(async (html: string) => {
    const name = (activeTab?.name ?? "文档").replace(/\.[^.]+$/, "") + ".html";
    const picked = await saveFileDialog(name);
    if (!picked) return;
    try {
      await writeTextFile({ path: picked, content: html, encoding: "UTF-8", bom: false, eol: "LF" });
      pushRecent(picked);
      setRecent(getRecent());
    } catch (e) {
      alert(`导出失败：${e}`);
    }
  }, [activeTab]);

  /** 打印 / 导出 PDF（打印机选「另存为 PDF」） */
  const doPrint = useCallback(() => {
    if (!activeTab) return;
    printDocument(
      activeTab.content,
      activeTab.name.replace(/\.[^.]+$/, ""),
      effectiveFontSize(editorSettings),
      /\.(md|markdown)$/i.test(activeTab.name)
    );
  }, [activeTab, editorSettings]);

  // ---------- 分屏对照（左右同时查看两个文件） ----------
  const [splitId, setSplitId] = useState<string | null>(null);
  const splitTab = useMemo(() => tabs.find((t) => t.id === splitId) ?? null, [tabs, splitId]);
  const toggleSplit = useCallback(() => {
    if (splitId) {
      setSplitId(null);
      return;
    }
    const other = tabs.find((t) => t.id !== activeId);
    if (!other) {
      alert("分屏需要至少两个文件：请再打开一个文件后重试。");
      return;
    }
    setSplitId(other.id);
  }, [splitId, tabs, activeId]);

  // ---------- 拖拽多媒体/附件（引用插入） ----------
  const MEDIA_IMG = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif", "ico"]);
  const MEDIA_AUDIO = new Set(["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus"]);
  const MEDIA_VIDEO = new Set(["mp4", "webm", "mov", "avi", "mkv", "m4v"]);

  const insertMedia = useCallback(
    async (srcPath: string) => {
      if (!activeTab) {
        alert("请先新建或打开一个文档，再把媒体/附件拖进来。");
        return;
      }
      if (!activeTab.path) {
        alert("文档尚未保存。请先用 Ctrl+S 保存文档，媒体文件会复制到文档同目录的 media/ 文件夹下并以引用方式插入。");
        return;
      }
      if (activeTab.readOnly) {
        alert("大文件模式为只读，不支持插入媒体引用。");
        return;
      }
      const file = baseName(srcPath);
      const ext = (file.split(".").pop() ?? "").toLowerCase();
      const stem = file.replace(/\.[^.]+$/, "");
      try {
        const rel = await copyMediaFile(srcPath, activeTab.path);
        let snippet: string;
        if (MEDIA_IMG.has(ext)) snippet = `![${stem}](${rel})`;
        else if (MEDIA_AUDIO.has(ext)) snippet = `\n<audio controls src="${rel}"></audio>\n`;
        else if (MEDIA_VIDEO.has(ext)) snippet = `\n<video controls width="480" src="${rel}"></video>\n`;
        else snippet = `\n[📎 ${file}](${rel})\n`;
        insertText(snippet);
      } catch (e) {
        alert(`导入媒体失败：${e}`);
      }
    },
    [activeTab, insertText]
  );

  /** 判断拖入路径是当文本打开，还是作为媒体/附件插入引用 */
  const isTextFilePath = (p: string): boolean => {
    const ext = (p.split(/[\\/]/).pop()?.split(".").pop() ?? "").toLowerCase();
    if (MEDIA_IMG.has(ext) || MEDIA_AUDIO.has(ext) || MEDIA_VIDEO.has(ext)) return false;
    if (!ext) return true; // 无扩展名按文本处理
    return ext in EXT_LANG; // 已知文本类型打开；其他（pdf/zip 等）当附件插入引用
  };



  /** 打开单个路径（去重：已打开则激活） */
  const openPath = useCallback(async (path: string) => {
    const existing = tabs.find((t) => t.path === path);
    if (existing) {
      setActiveId(existing.id);
      return;
    }
    try {
      const { size } = await fileInfo(path);
      if (size > LARGE_FILE_LIMIT) {
        const first = await readFileChunk(path, 0, LARGE_FILE_CHUNK);
        pushRecent(path);
        setRecent(getRecent());
        setLibrary((prev) => upsertFile(prev, path, first));
        const tab: FileTab = {
          id: newId(),
          path,
          name: `${baseName(path)}（大文件）`,
          content: first,
          dirty: false,
          encoding: "UTF-8",
          bom: false,
          eol: "LF",
          readOnly: true,
          large: { total: size, loaded: Math.min(size, LARGE_FILE_CHUNK) },
        };
        setTabs((ts) => [...ts, tab]);
        setActiveId(tab.id);
        return;
      }
      const res = await readTextFile(path);
      pushRecent(path);
      setRecent(getRecent());
      setLibrary((prev) => upsertFile(prev, path, res.content));
      const tab: FileTab = {
        id: newId(),
        path,
        name: baseName(path),
        content: res.content,
        dirty: false,
        encoding: res.encoding,
        bom: res.bom,
        eol: (["LF", "CRLF", "CR", "MIXED"].includes(res.eol) ? res.eol : "LF") as FileTab["eol"],
      };
      setTabs((ts) => [...ts, tab]);
      setActiveId(tab.id);
    } catch (e) {
      alert(`打开文件失败：${e}`);
    }
  }, [tabs]);

  // openPath 就绪后写入 ref，供文件夹搜索结果跳转使用
  useEffect(() => {
    openPathRef.current = openPath;
  }, [openPath]);

  /** 大文件模式：追加下一块 */
  const loadMoreChunk = useCallback(async () => {
    const t = activeTab;
    if (!t?.large || !t.path) return;
    try {
      const step = Math.min(LARGE_FILE_CHUNK, t.large.total - t.large.loaded);
      const next = await readFileChunk(t.path, t.large.loaded, step);
      updateTab(t.id, {
        content: t.content + next,
        large: { total: t.large.total, loaded: t.large.loaded + step },
      });
    } catch (e) {
      alert(`加载失败：${e}`);
    }
  }, [activeTab, updateTab]);

  const newTab = useCallback(() => {
    const n = tabs.filter((t) => t.path === null).length;
    const tab: FileTab = {
      id: newId(),
      path: null,
      name: n === 0 ? "新文件" : `新文件 (${n + 1})`,
      content: "",
      dirty: false,
      encoding: "UTF-8",
      bom: false,
      eol: "LF",
    };
    setTabs((ts) => [...ts, tab]);
    setActiveId(tab.id);
  }, [tabs]);

  const openDialog = useCallback(async () => {
    const paths = await openFileDialog();
    if (paths) for (const p of paths) await openPath(p);
  }, [openPath]);

  // ---------- 文件对比 ----------
  const resolveDiffSource = useCallback(
    async (src: DiffSource): Promise<{ text: string; name: string } | null> => {
      if (src.kind === "tab") return { text: src.tab.content, name: src.tab.name };
      const picked = await openFileDialog();
      if (!picked || picked.length === 0) return null;
      try {
        const res = await readTextFile(picked[0]);
        return { text: res.content, name: baseName(picked[0]) };
      } catch (e) {
        alert(`读取文件失败：${e}`);
        return null;
      }
    },
    []
  );

  const startDiff = useCallback(
    async (a: DiffSource, b: DiffSource) => {
      setDiffDialog(false);
      const ra = await resolveDiffSource(a);
      const rb = await resolveDiffSource(b);
      if (!ra || !rb) return;
      setDiff({ aText: ra.text, aName: ra.name, bText: rb.text, bName: rb.name });
    },
    [resolveDiffSource]
  );

  // ---------- 会话恢复：启动时还原上次打开的标签 ----------
  useEffect(() => {
    if (sessionLoaded.current) return;
    sessionLoaded.current = true;
    (async () => {
      let session: { paths: string[]; activePath: string | null } | null = null;
      try {
        session = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null");
      } catch {
        session = null;
      }
      const paths = session?.paths ?? [];
      const loaded: FileTab[] = [];
      for (const p of paths) {
        try {
          const res = await readTextFile(p);
          loaded.push({
            id: newId(),
            path: p,
            name: baseName(p),
            content: res.content,
            dirty: false,
            encoding: res.encoding,
            bom: res.bom,
            eol: (["LF", "CRLF", "CR", "MIXED"].includes(res.eol) ? res.eol : "LF") as FileTab["eol"],
          });
        } catch {
          // 文件已失效（被移动/删除），跳过
        }
      }
      if (loaded.length === 0) {
        newTab();
        return;
      }
      setTabs(loaded);
      const active =
        loaded.find((t) => t.path === session?.activePath) ?? loaded[0];
      setActiveId(active.id);
    })();
  }, [newTab]);

  // ---------- 会话持久化：标签变化时保存路径列表 ----------
  useEffect(() => {
    if (!sessionLoaded.current) return;
    const paths = tabs.filter((t) => t.path).map((t) => t.path!);
    const activePath = tabs.find((t) => t.id === activeId && t.path)?.path ?? null;
    localStorage.setItem(SESSION_KEY, JSON.stringify({ paths, activePath }));
  }, [tabs, activeId]);

  // ---------- 外部文件变更监听：轮询 mtime/size，磁盘被改时提示/自动重载 ----------
  const tabsRef = useRef<FileTab[]>([]);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);
  const diskStamps = useRef<Map<string, string>>(new Map());
  /** 有未保存修改的标签发现磁盘被改 → 弹窗询问 */
  const [reloadPrompt, setReloadPrompt] = useState<string | null>(null);

  const checkExternalChanges = useCallback(async () => {
    for (const t of tabsRef.current) {
      if (!t.path || t.readOnly || t.large) continue;
      try {
        const info = await fileInfo(t.path);
        const stamp = `${info.size}:${info.mtime}`;
        const prev = diskStamps.current.get(t.path);
        if (prev === undefined) {
          diskStamps.current.set(t.path, stamp);
          continue;
        }
        if (prev === stamp) continue;
        diskStamps.current.set(t.path, stamp);
        if (t.dirty) {
          // 内容相同（如 touch / 同步软件原样重写）不提示，避免误判
          try {
            const res = await readTextFile(t.path);
            if (res.content === t.content) continue;
          } catch {
            /* 读不到按有变化处理 */
          }
          setReloadPrompt(t.id);
        } else {
          // 未编辑：静默重载最新内容
          const res = await readTextFile(t.path);
          updateTab(t.id, {
            content: res.content,
            encoding: res.encoding,
            bom: res.bom,
            eol: (["LF", "CRLF", "CR", "MIXED"].includes(res.eol) ? res.eol : "LF") as FileTab["eol"],
            dirty: false,
          });
        }
      } catch {
        // 文件被移动/删除/暂不可读：忽略，不干扰编辑
      }
    }
  }, [updateTab]);

  useEffect(() => {
    const iv = window.setInterval(() => void checkExternalChanges(), 3000);
    const onFocus = () => void checkExternalChanges();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(iv);
      window.removeEventListener("focus", onFocus);
    };
  }, [checkExternalChanges]);

  /** 保存；forceDialog 用于另存为。返回是否成功保存 */
  const saveTab = useCallback(async (tab: FileTab, forceDialog = false): Promise<boolean> => {
    if (tab.readOnly) {
      alert("大文件模式为只读，不支持保存。可用「另存为」导出已加载的部分。");
      return false;
    }
    let path = tab.path;
    if (!path || forceDialog) {
      const picked = await saveFileDialog(tab.name);
      if (!picked) return false; // 用户取消
      path = picked;
    }
    const eol = tab.eol === "MIXED" ? "LF" : tab.eol;
    try {
      await writeTextFile({
        path,
        content: tab.content,
        encoding: tab.encoding,
        bom: tab.bom,
        eol,
      });
      // 关键：保存成功后刷新该文件的磁盘基线，
      // 否则下一次监听节拍会把「自己的保存」误判为外部修改，
      // 弹出「重新加载」导致继续编辑的内容被回退（数据丢失 bug）
      try {
        const info = await fileInfo(path);
        diskStamps.current.set(path, `${info.size}:${info.mtime}`);
      } catch {
        diskStamps.current.delete(path);
      }
      pushRecent(path);
      setRecent(getRecent());
      setLibrary((prev) => upsertFile(prev, path!, tab.content));
      setTabs((ts) =>
        ts.map((t) =>
          t.id === tab.id
            ? { ...t, path, name: baseName(path!), dirty: false, eol }
            : t
        )
      );
      return true;
    } catch (e) {
      alert(`保存失败：${e}`);
      return false;
    }
  }, []);

  /** 关闭标签：脏文件先确认 */
  const closeTab = useCallback(
    (id: string) => {
      const tab = tabs.find((t) => t.id === id);
      if (!tab) return;
      const doClose = () => {
        setTabs((ts) => {
          const idx = ts.findIndex((t) => t.id === id);
          const rest = ts.filter((t) => t.id !== id);
          if (id === activeId) {
            const next = rest[Math.min(idx, rest.length - 1)];
            setActiveId(next ? next.id : null);
          }
          return rest;
        });
      };
      if (tab.dirty) {
        setConfirmState({ tabId: id, onDone: doClose });
      } else {
        doClose();
      }
    },
    [tabs, activeId]
  );

  // ---------- 文件库操作 ----------
  const toggleFav = useCallback((path: string) => {
    setLibrary((prev) => {
      const f = prev.find((x) => x.path === path);
      return patchFile(prev, path, { favorite: !f?.favorite });
    });
  }, []);

  const assignCategory = useCallback((path: string, category: string | null) => {
    setLibrary((prev) => patchFile(prev, path, { category }));
  }, []);

  const removeFromLibrary = useCallback((path: string) => {
    setLibrary((prev) => removeFile(prev, path));
  }, []);

  const createCategory = useCallback((name: string, color: string) => {
    const id = `cat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setCategories((prev) => [...prev, { id, name, color }]);
    setCatKey(id);
  }, []);

  const renameCategory = useCallback((id: string, name: string) => {
    setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
  }, []);

  const deleteCategory = useCallback(
    (id: string) => {
      setCategories((prev) => prev.filter((c) => c.id !== id));
      setLibrary((prev) =>
        prev.map((f) => (f.category === id ? { ...f, category: null } : f))
      );
      setCatKey((k) => (k === id ? VIRTUAL.all : k));
    },
    []
  );

  // ---------- 宏录制与回放 ----------
  const toggleRecord = useCallback(() => {
    if (recording) {
      setRecording(false);
    } else {
      macroRef.current = [];
      setMacroLen(0);
      setRecording(true);
    }
  }, [recording]);

  const playItems = useCallback((items: MacroItem[]) => {
    if (recording || !items.length) return;
    actionCount.current += 1;
    setActionSignal({ type: "macro-replay", n: actionCount.current, items: [...items] });
  }, [recording]);

  const replayMacro = useCallback(() => {
    playItems(macroRef.current);
  }, [playItems]);

  // ---------- 命名宏：保存 / 回放 / 管理 / 导入导出 ----------
  const handleSaveMacro = useCallback((name: string, items: MacroItem[]) => {
    setSavedMacros(addMacro(name, items));
  }, []);
  const handleDeleteMacro = useCallback((id: string) => setSavedMacros(deleteMacro(id)), []);
  const handleRenameMacro = useCallback((id: string, name: string) => setSavedMacros(renameMacro(id, name)), []);
  const handleImportMacros = useCallback((json: string) => setSavedMacros(importMacros(json)), []);
  const handleExportMacros = useCallback(() => {
    const blob = new Blob([exportMacros()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "notepp-macros.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }, []);
  const handleMacroTemplate = useCallback(() => {
    const sample = {
      format: "notepp-macros", version: 1,
      macros: [
        { name: "示例：输入问候", items: [{ type: "text", text: "Hello, NotePP!" }] },
        { name: "示例：空两行", items: [{ type: "cmd", cmd: "Enter" }, { type: "cmd", cmd: "Enter" }] },
      ],
    };
    const blob = new Blob([JSON.stringify(sample, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "notepp-macros-example.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }, []);

  // 录制中捕获按键（排除应用级快捷键与纯修饰键）
  useEffect(() => {
    if (!recording) return;
    const APP_KEYS = new Set(["n", "o", "s", "w", "f", "tab", "r", "p"]);
    const onKey = (e: KeyboardEvent) => {
      if (["Control", "Shift", "Alt", "Meta", "CapsLock"].includes(e.key)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && APP_KEYS.has(e.key.toLowerCase())) return;
      const item: MacroItem =
        e.key.length === 1 && !mod && !e.altKey
          ? { type: "text", text: e.key }
          : { type: "cmd", cmd: e.key };
      macroRef.current.push(item);
      setMacroLen(macroRef.current.length);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording]);

  // ---------- 快捷键 ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Esc 关闭查找浮窗（焦点不在浮窗内时也要生效）
      if (e.key === "Escape" && findOpen) {
        setFindOpen(false);
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "n" && !e.shiftKey) {
        e.preventDefault();
        newTab();
      } else if (key === "o") {
        e.preventDefault();
        openDialog();
      } else if (key === "s" && !e.shiftKey) {
        e.preventDefault();
        if (activeTab) saveTab(activeTab);
      } else if (key === "s" && e.shiftKey) {
        e.preventDefault();
        if (activeTab) saveTab(activeTab, true);
      } else if (key === "w") {
        e.preventDefault();
        if (activeId) closeTab(activeId);
      } else if (key === "b" && e.shiftKey) {
        e.preventDefault();
        setLayout((l) => ({ ...l, filelistOpen: !l.filelistOpen }));
      } else if (key === "b") {
        e.preventDefault();
        setLayout((l) => ({ ...l, sidebarOpen: !l.sidebarOpen }));
      } else if (key === "f") {
        e.preventDefault();
        openFind();
      } else if (key === "h") {
        // Ctrl+H：打开查找并聚焦替换框（与查找栏共用）
        e.preventDefault();
        openFind();
      } else if (key === "f3") {
        e.preventDefault();
        stepFind(e.shiftKey ? -1 : 1);
      } else if (key === "escape") {
        setFindOpen(false);
      } else if (key === "r" && e.shiftKey) {
        e.preventDefault();
        toggleRecord();
      } else if (key === "p" && e.shiftKey) {
        e.preventDefault();
        replayMacro();
      } else if (key === "0") {
        // Ctrl+0 复位缩放 100%
        e.preventDefault();
        resetZoom();
      } else if (key === "p" && !e.shiftKey) {
        // Ctrl+P 打印 / 导出 PDF
        e.preventDefault();
        doPrint();
      } else if (key === "tab") {
        e.preventDefault();
        if (tabs.length > 1 && activeId) {
          const idx = tabs.findIndex((t) => t.id === activeId);
          setActiveId(tabs[(idx + 1) % tabs.length].id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newTab, openDialog, saveTab, closeTab, activeTab, activeId, tabs, toggleRecord, replayMacro, openFind, stepFind, doPrint, findOpen]);

  // 状态栏点击：循环切换保存编码
  useEffect(() => {
    const onCycle = () => {
      if (!activeId) return;
      setTabs((ts) =>
        ts.map((t) =>
          t.id === activeId
            ? {
                ...t,
                encoding:
                  ENCODINGS[(ENCODINGS.indexOf(t.encoding) + 1) % ENCODINGS.length] ??
                  "UTF-8",
                dirty: true,
              }
            : t
        )
      );
    };
    window.addEventListener("notepp.cycle-encoding", onCycle);
    window.addEventListener("notepp.zoom-reset", resetZoom);
    return () => {
      window.removeEventListener("notepp.cycle-encoding", onCycle);
      window.removeEventListener("notepp.zoom-reset", resetZoom);
    };
  }, [activeId, resetZoom]);

  // ---------- 拖拽打开文件 ----------
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "drop") {
        for (const p of event.payload.paths) {
          if (isTextFilePath(p)) openPath(p);
          else void insertMedia(p);
        }
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [openPath, insertMedia]);

  // ---------- 移动端：双指捏合调整字号（对应桌面 Ctrl+滚轮） ----------
  const zoomRef = useRef(editorSettings.zoom);
  useEffect(() => {
    zoomRef.current = editorSettings.zoom;
  }, [editorSettings.zoom]);
  useEffect(() => {
    let startDist = 0;
    let startZoom = 100;
    const dist = (e: TouchEvent) =>
      Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        startDist = dist(e);
        startZoom = zoomRef.current;
      }
    };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && startDist > 0) {
        const z = Math.round((startZoom * dist(e)) / startDist / 5) * 5;
        setEditorSettings((s) => clampSettings({ ...s, zoom: z }));
        e.preventDefault(); // 阻止页面级缩放
      }
    };
    const onEnd = () => {
      startDist = 0;
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  // ---------- 移动端：软键盘弹出时保证输入位置可见 ----------
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.scrollIntoView({ block: "nearest" });
    };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, []);

  // 标题栏
  useEffect(() => {
    document.title = activeTab
      ? `${activeTab.dirty ? "● " : ""}${activeTab.name} - NotePP`
      : "NotePP";
  }, [activeTab]);

  // 全局点击关闭右键菜单
  useEffect(() => {
    const hide = () => {
      const menu = document.getElementById("tab-context-menu");
      if (menu) menu.style.display = "none";
    };
    window.addEventListener("click", hide);
    window.addEventListener("blur", hide);
    return () => {
      window.removeEventListener("click", hide);
      window.removeEventListener("blur", hide);
    };
  }, []);

  const lang = detectLanguage(activeTab?.path ?? null);
  const lines = activeTab ? activeTab.content.split("\n").length : 0;

  return (
    <div className="app">
      {/* 菜单栏 */}
      <div className="menubar">
        <button onClick={newTab}>新建</button>
        <button onClick={openDialog}>打开</button>
        <button onClick={() => activeTab && saveTab(activeTab)}>保存</button>
        <button onClick={() => activeTab && saveTab(activeTab, true)}>另存为</button>
        <button onClick={() => setDiffDialog(true)}>对比</button>
        <button onClick={() => openFind()} title="查找替换 (Ctrl+F，Shift+F3 反向)">
          查找
        </button>
        <button onClick={() => activeId && closeTab(activeId)}>关闭</button>
        <button
          onClick={toggleRecord}
          className={recording ? "rec-active" : ""}
          title="录制编辑动作 (Ctrl+Shift+R)"
        >
          {recording ? `停止录制 ●${macroLen}` : "录制宏"}
        </button>
        <button
          onClick={replayMacro}
          disabled={recording || macroLen === 0}
          title={`回放宏 (Ctrl+Shift+P)${macroLen ? `，共 ${macroLen} 个动作` : "，尚未录制"}`}
        >
          回放宏
        </button>
        <button
          onClick={() => setMacroDialogOpen(true)}
          title="宏管理：保存当前录制为命名宏、回放/重命名/删除、导入导出 JSON"
        >
          宏管理
        </button>
        <button
          onClick={() => patchLayout({ sidebarOpen: !layout.sidebarOpen })}
          className={layout.sidebarOpen ? "on" : ""}
          title="显示/隐藏侧栏 (Ctrl+B)"
        >
          侧栏
        </button>
        <button
          onClick={() => patchLayout({ filelistOpen: !layout.filelistOpen })}
          className={layout.filelistOpen ? "on" : ""}
          title="显示/隐藏文件列表 (Ctrl+Shift+B)"
        >
          列表
        </button>
        <button
          onClick={() => setTableOpen(true)}
          disabled={!activeTab}
          title="在光标处插入 Markdown 表格"
        >
          表格
        </button>
        <button
          onClick={() => setPreviewOpen(true)}
          disabled={!activeTab}
          className={previewOpen ? "on" : ""}
          title="Markdown 预览（GFM）+ 导出带样式 HTML；非 Markdown 文件按纯文本预览"
        >
          预览
        </button>
        <button
          onClick={doPrint}
          disabled={!activeTab}
          className="menubar-secondary"
          title="打印 / 导出 PDF（按当前缩放字号；打印对话框里选「另存为 PDF」）"
        >
          打印
        </button>
        <button
          onClick={() => setAnnoOpen((v) => !v)}
          disabled={!activeTab}
          className={annoOpen ? "on" : ""}
          title="标注导航：当前文件所有划线/高亮/备注列表，点击跳转"
        >
          标注
        </button>
        <button
          onClick={toggleSplit}
          className={splitId ? "on" : ""}
          title="分屏对照：左右同时查看两个文件（再次点击关闭）"
        >
          分屏
        </button>
        <button onClick={() => setSettingsOpen(true)} title="编辑器样式设置">
          设置
        </button>
        <button
          onClick={() => setColumnMode((v) => !v)}
          className={columnMode ? "on" : ""}
          title="列编辑模式：矩形选区 + 十字光标（Alt+拖拽也可多行同时编辑）"
        >
          列选
        </button>
        <button
          onClick={() => {
            setUpdateOpen(true);
            void doCheckUpdate();
          }}
          className={updateInfo?.newer ? "on" : ""}
          title={updateInfo?.newer ? `发现新版本 v${updateInfo.latest}` : "检查更新"}
        >
          更新
        </button>
        <button
          onClick={() => setAiSettingsOpen(true)}
          className={aiReady ? "on" : ""}
          title={aiReady ? `AI 已就绪：${resolveConfig(aiConfig).model}` : "配置 AI 服务商与 Key"}
        >
          AI
        </button>
        <button
          className="menubar-secondary"
          onClick={() => void openUrl("https://notepp.ambook.vip")}
          title="访问官网 notepp.ambook.vip（在系统浏览器中打开）"
        >
          我的网站
        </button>
        <span className="spacer" />
        {recent.length > 0 && (
          <select
            className="recent-select"
            value=""
            onChange={(e) => e.target.value && openPath(e.target.value)}
            title="最近打开的文件"
          >
            <option value="">最近文件</option>
            {recent.map((p) => (
              <option key={p} value={p}>
                {baseName(p)} — {p}
              </option>
            ))}
          </select>
        )}
      </div>

      <div
        className="workspace"
        style={
          {
            "--sidebar-w": `${layout.sidebarWidth}px`,
            "--filelist-w": `${layout.filelistWidth}px`,
          } as React.CSSProperties
        }
      >
        {/* 窄屏抽屉遮罩：点击关闭侧栏/文件列表 */}
        {(layout.sidebarOpen || layout.filelistOpen) && (
          <div
            className="drawer-mask"
            onClick={() => patchLayout({ sidebarOpen: false, filelistOpen: false })}
          />
        )}
        {layout.sidebarOpen && (
          <Sidebar
            categories={categories}
            files={library}
            activeKey={catKey}
            onSelect={setCatKey}
            onCreate={createCategory}
            onRename={renameCategory}
            onDelete={deleteCategory}
          >
            <FolderTree
              root={folderRoot}
              activePath={activeTab?.path ?? null}
              onOpenFile={openPath}
              onPickFolder={async () => {
                const dir = await openDirectoryDialog();
                if (dir) setFolderRoot(dir);
              }}
              onClear={() => setFolderRoot(null)}
            />
          </Sidebar>
        )}
        {layout.sidebarOpen && (
          <Splitter
            onDelta={(dx) =>
              patchLayout({ sidebarWidth: clampSidebarWidth(layout.sidebarWidth + dx) })
            }
            onReset={() => patchLayout({ sidebarWidth: DEFAULT_LAYOUT.sidebarWidth })}
          />
        )}
        {layout.filelistOpen && (
          <FileList
            title={viewTitle}
            files={viewFiles}
            activePath={activeTab?.path ?? null}
            query={query}
            categories={categories}
            onQuery={setQuery}
            onOpen={(p) => {
              void openPath(p);
              // 手机上打开文件后自动收起抽屉，避免遮住编辑区
              if (isNarrow()) patchLayout({ filelistOpen: false, sidebarOpen: false });
            }}
            onToggleFav={toggleFav}
            onAssign={assignCategory}
            onRemove={removeFromLibrary}
            onNewFile={newTab}
          />
        )}
        {layout.filelistOpen && (
          <Splitter
            onDelta={(dx) =>
              patchLayout({ filelistWidth: clampFilelistWidth(layout.filelistWidth + dx) })
            }
            onReset={() => patchLayout({ filelistWidth: DEFAULT_LAYOUT.filelistWidth })}
          />
        )}

        <div className="main">
          <TabBar
            tabs={tabs}
            activeId={activeId}
            onSelect={setActiveId}
            onClose={closeTab}
          />

        <div className="editor-row">
        <div
          className="editor-area"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => e.preventDefault()}
        >
        {diff ? (
          <DiffView
            aText={diff.aText}
            bText={diff.bText}
            aName={diff.aName}
            bName={diff.bName}
            onClose={() => setDiff(null)}
          />
        ) : tabs.length === 0 ? (
          <div className="empty-state">
            <h1>NotePP</h1>
            <p>轻量跨平台文本 / 代码编辑器</p>
            <ul>
              <li><b>Ctrl+N</b> 新建　<b>Ctrl+O</b> 打开　<b>Ctrl+S</b> 保存</li>
              <li><b>Ctrl+F</b> 查找替换　<b>Ctrl+W</b> 关闭标签　<b>Ctrl+Tab</b> 切换标签</li>
              <li>也可以直接把文件拖进窗口</li>
            </ul>
          </div>
        ) : (
          activeTab && (
            <>
              {activeTab.large && (
                <div className="large-banner">
                  <span>
                    大文件模式（只读）· 已加载 {fmtMB(activeTab.large.loaded)} / 共{" "}
                    {fmtMB(activeTab.large.total)}
                  </span>
                  {activeTab.large.loaded < activeTab.large.total && (
                    <button onClick={loadMoreChunk}>再加载 1MB</button>
                  )}
                  <span className="hint">分块读取，避免一次性载入占满内存</span>
                </div>
              )}
              <Editor
              key={activeTab.id}
              content={activeTab.content}
              languagePath={activeTab.path}
              onChange={(v) => updateTab(activeTab.id, { content: v, dirty: true })}
              onCursor={(line, col, selected) => setCursor({ line, col, selected })}
              actionSignal={actionSignal}
              settings={editorSettings}
              onZoom={zoomEditor}
              onAiAction={handleAiAction}
              aiReady={aiReady}
              onOpenAiSettings={() => setAiSettingsOpen(true)}
              readOnly={activeTab.readOnly}
              columnMode={columnMode}
              annotations={annotations}
              onAnnotate={handleAnnotate}
              onAnnotationsReplace={persistAnnotations}
              onDeleteAnnotation={handleDeleteAnnotation}
              searchMarks={searchMarks}
              gotoRequest={gotoRequest}
            />
            </>
          )
        )}
      </div>

      {splitTab && (
        <div className="editor-area editor-split">
          <div className="editor-split-head">
            <select
              value={splitTab.id}
              onChange={(e) => setSplitId(e.target.value)}
              title="选择右侧分屏显示的文件"
            >
              {tabs.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button onClick={() => setSplitId(null)} title="关闭分屏">×</button>
          </div>
          <Editor
            key={`split-${splitTab.id}`}
            content={splitTab.content}
            languagePath={splitTab.path}
            onChange={(v) => updateTab(splitTab.id, { content: v, dirty: true })}
            onCursor={() => {}}
            actionSignal={null}
            settings={editorSettings}
            onZoom={zoomEditor}
            readOnly={splitTab.readOnly}
          />
        </div>
      )}
      </div>

      {activeTab && (
        <AnnoPanel
          open={annoOpen}
          annotations={annotations}
          onJump={jumpToAnnotation}
          onDelete={handleDeleteAnnotation}
          onClose={() => setAnnoOpen(false)}
        />
      )}

      {activeTab && (
        <FindBar
          open={findOpen}
          total={findMatches.length}
          current={findMatches.length === 0 ? 0 : findCurrent + 1}
          options={findOptions}
          query={findQuery}
          folderRoot={folderRoot}
          folderHits={folderHits}
          folderLoading={folderLoading}
          folderMessage={folderMessage}
          tabHits={tabHits}
          tabMessage={tabMessage}
          onQuery={setFindQuery}
          onOptions={setFindOptions}
          onStep={stepFind}
          onReplace={doReplace}
          onReplaceAll={doReplaceAll}
          onFolderSearch={(q, o) => void doFolderSearch(q, o)}
          onTabsSearch={(q, o) => doTabsSearch(q, o)}
          onOpenHit={(p, l) => void openFolderHit(p, l)}
          onClose={() => setFindOpen(false)}
          seed={findSeed}
          replaceMessage={replaceMsg}
          resultsOpen={resultsOpen && findOpen}
          onToggleResults={() => setResultsOpen((v) => !v)}
          findScale={editorSettings.findScale}
          onFindScale={(next) => setEditorSettings((s) => clampSettings({ ...s, findScale: next }))}
        />
      )}

      {activeTab && (
        <SearchResults
          open={resultsOpen && findOpen}
          title={`查找「${findQuery}」`}
          hits={searchLineHits}
          activeLine={currentMatchLine}
          onJump={jumpToResultLine}
          onClose={() => setResultsOpen(false)}
        />
      )}

      {activeTab && (
        <StatusBar
          line={cursor.line}
          col={cursor.col}
          selected={cursor.selected}
          lines={lines}
          encoding={activeTab.encoding}
          bom={activeTab.bom}
          eol={activeTab.eol}
          language={lang.name}
          path={activeTab.path}
          zoom={editorSettings.zoom}
        />
      )}
        </div>
      </div>

      {/* 未保存确认弹窗 */}
      {confirmState && (
        <div className="modal-mask">
          <div className="modal">
            <p>
              「{tabs.find((t) => t.id === confirmState.tabId)?.name}」有未保存的更改，
              是否保存？
            </p>
            <div className="modal-actions">
              <button
                className="primary"
                onClick={async () => {
                  const tab = tabs.find((t) => t.id === confirmState.tabId);
                  setConfirmState(null);
                  if (tab) {
                    const ok = await saveTab(tab);
                    if (ok) confirmState.onDone();
                  }
                }}
              >
                保存
              </button>
              <button
                onClick={() => {
                  const done = confirmState.onDone;
                  setConfirmState(null);
                  done();
                }}
              >
                不保存
              </button>
              <button onClick={() => setConfirmState(null)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* 文件对比选择对话框 */}
      {diffDialog && (
        <DiffDialog
          tabs={tabs}
          defaultA={activeId}
          onConfirm={startDiff}
          onCancel={() => setDiffDialog(false)}
        />
      )}

      {/* 编辑器设置弹窗 */}
      {settingsOpen && (
        <SettingsDialog
          value={editorSettings}
          onChange={setEditorSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {/* 宏管理弹窗 */}
      <MacroDialog
        open={macroDialogOpen}
        macros={savedMacros}
        liveItems={macroRef.current}
        onClose={() => setMacroDialogOpen(false)}
        onSave={handleSaveMacro}
        onReplay={playItems}
        onDelete={handleDeleteMacro}
        onRename={handleRenameMacro}
        onImport={handleImportMacros}
        onExport={handleExportMacros}
        onImportTemplate={handleMacroTemplate}
      />

      {/* 插入表格 */}
      {tableOpen && (
        <InsertTableDialog onInsert={insertText} onClose={() => setTableOpen(false)} />
      )}

      {/* Markdown 预览 */}
      {previewOpen && activeTab && (
        <PreviewDialog
          title={activeTab.name}
          source={activeTab.content}
          fontSize={effectiveFontSize(editorSettings)}
          onExportHtml={exportPreviewHtml}
          onClose={() => setPreviewOpen(false)}
        />
      )}

      {/* AI 设置弹窗 */}
      {aiSettingsOpen && (
        <AiSettingsDialog
          config={aiConfig}
          onSave={(c) => {
            setAiConfig(c);
            setAiSettingsOpen(false);
          }}
          onClose={() => setAiSettingsOpen(false)}
        />
      )}

      {/* AI 自定义指令 */}
      {aiCustom && (
        <AiCustomDialog
          source={aiCustom.source}
          onClose={() => setAiCustom(null)}
          onSubmit={(instruction) => {
            const src = aiCustom.source;
            setAiCustom(null);
            void runAi("custom", src, instruction);
          }}
        />
      )}

      {/* 检查更新 */}
      {updateOpen && (
        <UpdateDialog
          checking={updateChecking}
          error={updateError}
          info={updateInfo}
          onCheck={() => void doCheckUpdate()}
          onClose={() => setUpdateOpen(false)}
        />
      )}

      {/* AI 结果 */}
      {aiJob && (
        <AiResultDialog
          title={aiJob.title}
          source={aiJob.source}
          loading={aiJob.loading}
          error={aiJob.error}
          result={aiJob.result}
          model={aiJob.model}
          tokens={aiJob.tokens}
          onReplace={(t) => writeAiText("ai-replace", t)}
          onInsert={(t) => writeAiText("ai-insert", t)}
          onClose={() => setAiJob(null)}
          onRetry={() => void runAi(aiJob.action, aiJob.source, aiJob.custom)}
        />
      )}

      {/* 外部修改提示 */}
      {reloadPrompt && (
        <div className="modal-mask">
          <div className="modal">
            <p>
              「{tabs.find((t) => t.id === reloadPrompt)?.name}」已在磁盘上被其他程序修改，
              你还有未保存的编辑。
            </p>
            <div className="modal-actions">
              <button className="primary" onClick={() => setReloadPrompt(null)}>
                保留我的版本
              </button>
              <button
                onClick={async () => {
                  const id = reloadPrompt;
                  setReloadPrompt(null);
                  const t = tabsRef.current.find((x) => x.id === id);
                  if (!t?.path) return;
                  try {
                    const res = await readTextFile(t.path);
                    updateTab(id, {
                      content: res.content,
                      encoding: res.encoding,
                      bom: res.bom,
                      eol: (["LF", "CRLF", "CR", "MIXED"].includes(res.eol) ? res.eol : "LF") as FileTab["eol"],
                      dirty: false,
                    });
                    // 重载后同步磁盘基线，避免后续节拍再次误判
                    const info = await fileInfo(t.path);
                    diskStamps.current.set(t.path, `${info.size}:${info.mtime}`);
                  } catch (e) {
                    alert(`重新加载失败：${e}`);
                  }
                }}
              >
                重新加载（放弃我的修改）
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 标签右键菜单（简化实现）：点击空白处自动关闭 */}
      <div id="tab-context-menu" className="context-menu">
        <button
          onClick={() => {
            const menu = document.getElementById("tab-context-menu");
            if (menu?.dataset.tabId) closeTab(menu.dataset.tabId);
            menu!.style.display = "none";
          }}
        >
          关闭标签
        </button>
        <button
          onClick={() => {
            const menu = document.getElementById("tab-context-menu");
            if (menu?.dataset.tabId) {
              tabs.filter((t) => t.id !== menu.dataset.tabId).forEach((t) => closeTab(t.id));
            }
            menu!.style.display = "none";
          }}
        >
          关闭其他
        </button>
      </div>
    </div>
  );
}
